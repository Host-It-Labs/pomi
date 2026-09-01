import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  TIMER_STATUSES,
  Timer,
  TimerExtensionState,
  TimerTypes,
} from '@pomi/shared';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { StatisticHistorySnapshot } from '../statistics/statistics.service';
import type {
  TimerContinuationPlanV2,
  TimerStateMutation,
} from './timer-continuation-plan';
import {
  TIMER_CONTINUATION_PLAN_VERSION,
  parseTimerContinuationPlan,
} from './timer-continuation-plan';

export const TIMER_COMPLETION_SCHEDULE_KEY = 'pomi:timer-schedules:completion';
export const TIMER_COMPLETION_STREAM_KEY = 'pomi:timer-events:completion:v1';
export const TIMER_COMPLETION_STREAM_VERSION = '1';
export const TIMER_COMPLETION_MODE_KEY = 'pomi:timer-completion:mode';
export const TIMER_COMPLETION_SCHEDULER_LOCK_KEY =
  'pomi:timer-schedules:completion:leader';
export const TIMER_COMPLETION_SCHEDULE_READY_KEY =
  'pomi:timer-schedules:completion:ready:v1';
export const TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY =
  'pomi:timer-schedules:completion:quarantine:v1';
export const TIMER_SCHEDULE_WAKE_CHANNEL = 'pomi:timer-schedules:wake:v1';
export const TIMER_IDLE_SCHEDULE_KEY = 'pomi:timer-schedules:idle:v1';
export const TIMER_IDLE_SCHEDULE_READY_KEY =
  'pomi:timer-schedules:idle:ready:v1';
export const TIMER_IDLE_SCHEDULE_GENERATION_KEY =
  'pomi:timer-schedules:idle:generation:v1';
export const TIMER_IDLE_SCHEDULE_QUARANTINE_KEY =
  'pomi:timer-schedules:idle:quarantine:v1';
export const TIMER_IDLE_DETECTION_STREAM_KEY =
  'pomi:timer-events:idle-detection:v1';
export const TIMER_IDLE_DETECTION_STREAM_VERSION = '1';
export const TIMER_IDLE_DETECTION_MODE_KEY = 'pomi:timer-idle-detection:mode';
export type TimerCompletionMode = 'legacy' | 'stream';
export type TimerIdleDetectionMode = 'legacy' | 'durable';

export interface TimerCompletionClaim {
  timer: Timer;
  mode: TimerCompletionMode;
  eventId: string | null;
  completedAt: number;
  claimedAt: number;
}

export interface DueTimerCompletion {
  member: string;
  userId: string | null;
  deadline: number;
}

export interface DueIdleDetection {
  member: string;
  userId: string | null;
  deadline: number;
}

export interface IdleDetectionClaim {
  detectionId: string;
  longBreakTimer: Timer;
  replacementTimer: Timer;
  eventId: string;
  detectedAt: number;
}

export type ScheduledIdleDetectionResult =
  | { kind: 'claimed'; claim: IdleDetectionClaim }
  | {
      kind: 'lost-leader' | 'legacy' | 'stale' | 'early' | 'corrupt';
    };

interface IdleDetectionSchedulePayload {
  detectionId: string;
  checkAt: number;
  longBreakDuration: number;
  expectedLastCompletionTimestamp: number;
  expectedTimer: TimerVersion;
  expectedRuntimeRevision: string;
  longBreakTimerId: string;
  replacementTimer: Timer;
  replacementSessionState: TimerSessionState;
  userId: string;
}

export interface IdleDetectionSchedulePolicy {
  longBreakDuration: number;
  workTimerDuration: number;
  sessionPomodorosCount: number;
}

export type ScheduledTimerCompletionResult =
  | { kind: 'claimed'; claim: TimerCompletionClaim }
  | {
      kind:
        'lost-leader' | 'legacy' | 'stale' | 'repaired' | 'early' | 'corrupt';
    };

export type TimerScheduleReconcileResult =
  'scheduled' | 'removed' | 'lost-leader' | 'corrupt';

const TIMER_STREAM_PAYLOAD_FIELDS_VALIDATION_LUA = `
local function jsonContainerKind(value)
  if type(value) ~= 'table' then return nil end
  return string.sub(cjson.encode(value), 1, 1)
end
local function validOptionalString(value)
  return value == nil or type(value) == 'string'
end
local function validOptionalNonEmptyString(value)
  return value == nil or (type(value) == 'string' and string.find(value, '%S'))
end
local function validOptionalBoolean(value)
  return value == nil or type(value) == 'boolean'
end
local function validOptionalStringArray(value, requireNonEmptyItems)
  if value == nil then return true end
  if type(value) ~= 'table' or #value == 0 then return false end
  if jsonContainerKind(value) ~= '[' then return false end
  for _, item in ipairs(value) do
    if type(item) ~= 'string'
        or (requireNonEmptyItems and not string.find(item, '%S')) then
      return false
    end
  end
  return true
end
local function validOptionalStringRecord(value)
  if value == nil then return true end
  if jsonContainerKind(value) ~= '{' then return false end
  for key, item in pairs(value) do
    if type(key) ~= 'string' or type(item) ~= 'string' then return false end
  end
  return true
end
local function validOptionalSessionEmojiRecord(value)
  if value == nil then return true end
  if jsonContainerKind(value) ~= '{' then return false end
  for key, item in pairs(value) do
    if type(key) ~= 'string'
        or not string.find(key, '^[1-9]%d*$')
        or not safePositiveInteger(tonumber(key))
        or type(item) ~= 'string' then
      return false
    end
  end
  return true
end
local function validOptionalExtensionCandidate(value)
  if value == nil then return true end
  if type(value) ~= 'table'
      or type(value.originalTimerId) ~= 'string'
      or not string.find(value.originalTimerId, '%S')
      or type(value.originalDuration) ~= 'number'
      or value.originalDuration <= 0
      or value.originalDuration ~= math.floor(value.originalDuration)
      or (value.maxDuration ~= nil and (
        type(value.maxDuration) ~= 'number'
        or value.maxDuration <= 0
        or value.maxDuration ~= math.floor(value.maxDuration)
      )) then
    return false
  end
  if value.extensionNextTimerType ~= nil and
      value.extensionNextTimerType ~= 'work' and
      value.extensionNextTimerType ~= 'break' and
      value.extensionNextTimerType ~= 'longBreak' then
    return false
  end
  return true
end
local function validTimerPayloadFields(timer)
  return validOptionalBoolean(timer.hasNotifiedBeforeTimeNotification)
    and validOptionalBoolean(timer.hasNotifiedLongBreakDetection)
    and validOptionalBoolean(timer.hasNotifiedPausedTimerReminder)
    and validOptionalString(timer.intention)
    and validOptionalString(timer.intentionTitle)
    and validOptionalString(timer.intentionEmoji)
    and validOptionalString(timer.subIntention)
    and validOptionalString(timer.subIntentionTitle)
    and validOptionalString(timer.subIntentionEmoji)
    and validOptionalNonEmptyString(timer.extensionOriginalTimerId)
    and validOptionalStringArray(timer.intentionSlugs, false)
    and validOptionalStringArray(timer.focusedTaskIds, true)
    and validOptionalStringRecord(timer.subIntentions)
    and validOptionalStringRecord(timer.intentionEmojis)
    and validOptionalStringRecord(timer.subIntentionEmojis)
    and validOptionalSessionEmojiRecord(timer.sessionIntentionEmojis)
    and validOptionalBoolean(timer.isAutoStarted)
    and validOptionalBoolean(timer.hasConsumedFirstIntentionReset)
    and validOptionalExtensionCandidate(timer.extensionCandidate)
end
`;

export const CLAIM_SCHEDULED_TIMER_COMPLETION_SCRIPT = `
local function keyType(key)
  local result = redis.call('type', key)
  return type(result) == 'table' and result.ok or result
end
local function requireType(key, expected, label)
  local actual = keyType(key)
  if actual ~= 'none' and actual ~= expected then
    error(label .. ' key has an invalid type')
  end
end

requireType(KEYS[1], 'string', 'Current Timer')
requireType(KEYS[2], 'zset', 'Completion schedule')
requireType(KEYS[3], 'string', 'Runtime revision')
requireType(KEYS[4], 'stream', 'Completion stream')
requireType(KEYS[5], 'string', 'Completion mode')
requireType(KEYS[6], 'string', 'Scheduler lease')
requireType(KEYS[7], 'hash', 'Schedule quarantine')

if redis.call('get', KEYS[6]) ~= ARGV[8] then return {'lost-leader'} end
if redis.call('get', KEYS[5]) ~= 'stream' then return {'legacy'} end

local score = redis.call('zscore', KEYS[2], ARGV[1])
if not score or tonumber(score) ~= tonumber(ARGV[2]) then return {'stale'} end
local raw = redis.call('get', KEYS[1])
if not raw then
  redis.call('zrem', KEYS[2], ARGV[1])
  return {'stale'}
end
local function quarantine()
  redis.call('hset', KEYS[7], ARGV[1], raw)
  redis.call('zrem', KEYS[2], ARGV[1])
  return {'corrupt'}
end
local function safeNonNegativeInteger(value)
  return type(value) == 'number'
    and value >= 0
    and value <= 9007199254740991
    and value == math.floor(value)
end
local function validTimerType(value)
  return value == 'work' or value == 'break' or value == 'longBreak'
end
local decoded, timer = pcall(cjson.decode, raw)
if not decoded or type(timer) ~= 'table' then return quarantine() end
if timer.status ~= ARGV[3] then
  redis.call('zrem', KEYS[2], ARGV[1])
  return {'stale'}
end

local function safePositiveInteger(value)
  return safeNonNegativeInteger(value) and value > 0
end
${TIMER_STREAM_PAYLOAD_FIELDS_VALIDATION_LUA}
local function validOptionalPositiveInteger(value)
  return value == nil or safePositiveInteger(value)
end
if not validOptionalPositiveInteger(timer.sessionPosition)
    or not validOptionalPositiveInteger(timer.sessionTotal)
    or not validOptionalPositiveInteger(timer.stackedSessions)
    or not validOptionalPositiveInteger(timer.originalDuration)
    or not validOptionalPositiveInteger(timer.originalBreakDuration)
    or not validOptionalPositiveInteger(timer.extensionBaseDuration) then
  return quarantine()
end
local hasSessionPosition = timer.sessionPosition ~= nil
local hasSessionTotal = timer.sessionTotal ~= nil
if hasSessionPosition ~= hasSessionTotal then return quarantine() end
if hasSessionPosition and (
    timer.sessionPosition <= 0
    or timer.sessionTotal <= 0
    or timer.sessionPosition > timer.sessionTotal
  ) then
  return quarantine()
end
if type(timer.id) ~= 'string' or not string.find(timer.id, '%S')
    or type(timer.userId) ~= 'string' or timer.userId ~= ARGV[7]
    or not safeNonNegativeInteger(timer.startTime)
    or not safePositiveInteger(timer.duration)
    or not safeNonNegativeInteger(timer.remainingTime)
    or not validTimerType(timer.type)
    or not validTimerPayloadFields(timer)
    or (timer.isExtension ~= nil and type(timer.isExtension) ~= 'boolean')
    or (timer.extensionNextTimerType ~= nil and not validTimerType(timer.extensionNextTimerType))
    or timer.startTime + timer.duration > 9007199254740991 then
  return quarantine()
end

local deadline = timer.startTime + timer.duration
if deadline ~= tonumber(score) then
  redis.call('zadd', KEYS[2], deadline, ARGV[1])
  return {'repaired'}
end
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
if deadline > now then return {'early'} end

timer.remainingTime = 0
timer.status = ARGV[4]
timer.scheduleRevision = ARGV[5]
local updated = cjson.encode(timer)
local eventId = redis.call(
  'xadd',
  KEYS[4],
  '*',
  'schemaVersion',
  ARGV[6],
  'userId',
  ARGV[7],
  'timerId',
  timer.id,
  'scheduleRevision',
  timer.scheduleRevision,
  'completedAt',
  tostring(deadline),
  'claimedAt',
  tostring(now),
  'timer',
  updated
)
redis.call('set', KEYS[1], updated)
redis.call('zrem', KEYS[2], ARGV[1])
redis.call('set', KEYS[3], ARGV[5])
return {'claimed', updated, eventId, tostring(deadline), tostring(now)}
`;

export const CLAIM_RUNNING_TIMER_COMPLETION_BY_MODE_SCRIPT = `
local function keyType(key)
  local result = redis.call('type', key)
  return type(result) == 'table' and result.ok or result
end
local function safeNonNegativeInteger(value)
  return type(value) == 'number'
    and value >= 0
    and value <= 9007199254740991
    and value == math.floor(value)
end
local function safePositiveInteger(value)
  return safeNonNegativeInteger(value) and value > 0
end
${TIMER_STREAM_PAYLOAD_FIELDS_VALIDATION_LUA}
local function validOptionalPositiveInteger(value)
  return value == nil or safePositiveInteger(value)
end
local function validTimerType(value)
  return value == 'work' or value == 'break' or value == 'longBreak'
end
local scheduleType = keyType(KEYS[2])
if scheduleType ~= 'none' and scheduleType ~= 'zset' then
  return redis.error_reply('Completion schedule key has an invalid type')
end
local quarantineType = keyType(KEYS[6])
if quarantineType ~= 'none' and quarantineType ~= 'hash' then
  return redis.error_reply('Schedule quarantine key has an invalid type')
end
local raw = redis.call('get', KEYS[1])
if not raw then return nil end
local function quarantine()
  redis.call('hset', KEYS[6], ARGV[6], raw)
  redis.call('zrem', KEYS[2], ARGV[6])
  return nil
end
local decoded, timer = pcall(cjson.decode, raw)
if not decoded or type(timer) ~= 'table' then return quarantine() end
if timer.id ~= ARGV[1] or timer.status ~= ARGV[2] or tonumber(timer.startTime) ~= tonumber(ARGV[3]) then
  return nil
end
local hasSessionPosition = timer.sessionPosition ~= nil
local hasSessionTotal = timer.sessionTotal ~= nil
if type(timer.id) ~= 'string' or not string.find(timer.id, '%S')
    or type(timer.userId) ~= 'string' or timer.userId ~= ARGV[8]
    or not safeNonNegativeInteger(timer.startTime)
    or not safePositiveInteger(timer.duration)
    or not safeNonNegativeInteger(timer.remainingTime)
    or not validTimerType(timer.type)
    or not validTimerPayloadFields(timer)
    or not validOptionalPositiveInteger(timer.sessionPosition)
    or not validOptionalPositiveInteger(timer.sessionTotal)
    or not validOptionalPositiveInteger(timer.stackedSessions)
    or not validOptionalPositiveInteger(timer.originalDuration)
    or not validOptionalPositiveInteger(timer.originalBreakDuration)
    or not validOptionalPositiveInteger(timer.extensionBaseDuration)
    or hasSessionPosition ~= hasSessionTotal
    or (hasSessionPosition and (
      timer.sessionPosition <= 0
      or timer.sessionTotal <= 0
      or timer.sessionPosition > timer.sessionTotal
    ))
    or (timer.isExtension ~= nil and type(timer.isExtension) ~= 'boolean')
    or (timer.extensionNextTimerType ~= nil and not validTimerType(timer.extensionNextTimerType))
    or timer.startTime + timer.duration > 9007199254740991 then
  return quarantine()
end
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
if tonumber(timer.duration) - (now - tonumber(timer.startTime)) > 0 then return nil end
local mode = redis.call('get', KEYS[5]) or 'legacy'
if mode ~= 'stream' then mode = 'legacy' end
if mode == 'stream' then
  local streamType = redis.call('type', KEYS[4])
  streamType = type(streamType) == 'table' and streamType.ok or streamType
  if streamType ~= 'none' and streamType ~= 'stream' then
    return redis.error_reply('Completion stream key has an invalid type')
  end
end
timer.remainingTime = 0
timer.status = ARGV[4]
timer.scheduleRevision = ARGV[5]
local updated = cjson.encode(timer)
local completedAt = tonumber(timer.startTime) + tonumber(timer.duration)
local eventId = ''
if mode == 'stream' then
  eventId = redis.call(
    'xadd',
    KEYS[4],
    '*',
    'schemaVersion',
    ARGV[7],
    'userId',
    ARGV[8],
    'timerId',
    timer.id,
    'scheduleRevision',
    timer.scheduleRevision,
    'completedAt',
    tostring(completedAt),
    'claimedAt',
    tostring(now),
    'timer',
    updated
  )
end
redis.call('set', KEYS[1], updated)
redis.call('zrem', KEYS[2], ARGV[6])
redis.call('set', KEYS[3], ARGV[5])
return {updated, mode, eventId, tostring(completedAt), tostring(now)}
`;

export const CLAIM_SCHEDULED_IDLE_DETECTION_SCRIPT = `
local function keyType(key)
  local result = redis.call('type', key)
  return type(result) == 'table' and result.ok or result
end
local function requireType(key, expected, label)
  local actual = keyType(key)
  if actual ~= 'none' and actual ~= expected then
    error(label .. ' key has an invalid type')
  end
end
local function safeNonNegativeInteger(value)
  return type(value) == 'number'
    and value >= 0
    and value <= 9007199254740991
    and value == math.floor(value)
end
local function safePositiveInteger(value)
  return safeNonNegativeInteger(value) and value > 0
end
local function nonEmptyString(value)
  return type(value) == 'string' and string.find(value, '%S')
end

requireType(KEYS[1], 'string', 'Current Timer')
requireType(KEYS[2], 'zset', 'Idle schedule')
requireType(KEYS[3], 'string', 'Idle schedule payload')
requireType(KEYS[4], 'string', 'Last completion')
requireType(KEYS[5], 'string', 'Idle detection')
requireType(KEYS[6], 'string', 'Extension state')
requireType(KEYS[7], 'string', 'Session state')
requireType(KEYS[8], 'string', 'Runtime revision')
requireType(KEYS[9], 'stream', 'Idle detection stream')
requireType(KEYS[10], 'string', 'Scheduler lease')
requireType(KEYS[11], 'zset', 'Completion schedule')
requireType(KEYS[12], 'hash', 'Idle schedule quarantine')
requireType(KEYS[13], 'list', 'Undo history')
requireType(KEYS[14], 'list', 'Redo history')
requireType(KEYS[15], 'string', 'Idle detection mode')

if redis.call('get', KEYS[10]) ~= ARGV[7] then return {'lost-leader'} end
if redis.call('get', KEYS[15]) ~= 'durable' then return {'legacy'} end
local score = redis.call('zscore', KEYS[2], ARGV[1])
if not score or tonumber(score) ~= tonumber(ARGV[2]) then return {'stale'} end

local payloadRaw = redis.call('get', KEYS[3])
local function removeStale()
  redis.call('zrem', KEYS[2], ARGV[1])
  redis.call('del', KEYS[3])
  return {'stale'}
end
local function quarantine(reason, currentRaw)
  redis.call('hset', KEYS[12], ARGV[1], reason .. ':' .. (payloadRaw or '') .. ':' .. (currentRaw or ''))
  redis.call('zrem', KEYS[2], ARGV[1])
  redis.call('del', KEYS[3])
  return {'corrupt'}
end
if not payloadRaw then return removeStale() end
local decodedPayload, payload = pcall(cjson.decode, payloadRaw)
if not decodedPayload or type(payload) ~= 'table'
    or not nonEmptyString(payload.detectionId)
    or not safeNonNegativeInteger(payload.checkAt)
    or not safePositiveInteger(payload.longBreakDuration)
    or not safeNonNegativeInteger(payload.expectedLastCompletionTimestamp)
    or type(payload.expectedTimer) ~= 'table'
    or not nonEmptyString(payload.expectedTimer.timerId)
    or not nonEmptyString(payload.expectedTimer.scheduleRevision)
    or not nonEmptyString(payload.expectedRuntimeRevision)
    or not nonEmptyString(payload.longBreakTimerId)
    or type(payload.replacementTimer) ~= 'table'
    or not nonEmptyString(payload.replacementTimer.id)
    or not nonEmptyString(payload.replacementTimer.scheduleRevision)
    or payload.replacementTimer.userId ~= ARGV[6]
    or payload.replacementTimer.startTime ~= 0
    or not safePositiveInteger(payload.replacementTimer.duration)
    or payload.replacementTimer.remainingTime ~= payload.replacementTimer.duration
    or payload.replacementTimer.type ~= 'work'
    or payload.replacementTimer.status ~= 'paused'
    or not safePositiveInteger(payload.replacementTimer.sessionPosition)
    or not safePositiveInteger(payload.replacementTimer.sessionTotal)
    or payload.replacementTimer.sessionPosition ~= 1
    or payload.replacementTimer.sessionPosition > payload.replacementTimer.sessionTotal
    or type(payload.replacementSessionState) ~= 'table'
    or payload.replacementSessionState.currentPosition ~= payload.replacementTimer.sessionPosition
    or payload.replacementSessionState.totalPomodoros ~= payload.replacementTimer.sessionTotal
    or payload.userId ~= ARGV[6] then
  return quarantine('invalid-payload')
end

local lastCompletionRaw = redis.call('get', KEYS[4])
local lastCompletion = tonumber(lastCompletionRaw)
if not lastCompletionRaw or not safeNonNegativeInteger(lastCompletion)
    or lastCompletion ~= payload.expectedLastCompletionTimestamp then
  return removeStale()
end
if redis.call('exists', KEYS[5]) == 1 then return removeStale() end
local expectedCheckAt = lastCompletion + payload.longBreakDuration
if not safeNonNegativeInteger(expectedCheckAt)
    or payload.checkAt ~= expectedCheckAt
    or payload.checkAt ~= tonumber(score) then return quarantine('invalid-deadline') end

local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
if expectedCheckAt > now then return {'early'} end

local currentRaw = redis.call('get', KEYS[1])
if not currentRaw then return removeStale() end
local decodedCurrent, current = pcall(cjson.decode, currentRaw)
if not decodedCurrent or type(current) ~= 'table'
    or not nonEmptyString(current.id)
    or not nonEmptyString(current.scheduleRevision)
    or not safeNonNegativeInteger(current.remainingTime)
    or not safePositiveInteger(current.duration)
    or (current.status ~= 'running' and current.status ~= 'paused' and current.status ~= 'completed') then
  return quarantine('invalid-current-timer', currentRaw)
end
if current.id ~= payload.expectedTimer.timerId
    or current.scheduleRevision ~= payload.expectedTimer.scheduleRevision
    or redis.call('get', KEYS[8]) ~= payload.expectedRuntimeRevision
    or current.status == ARGV[3]
    or current.remainingTime ~= current.duration then return removeStale() end

local idleDuration = payload.longBreakDuration
if not safePositiveInteger(idleDuration) then return quarantine('invalid-duration') end
local timer = {
  id = payload.longBreakTimerId,
  scheduleRevision = payload.detectionId,
  userId = ARGV[6],
  startTime = lastCompletion,
  duration = idleDuration,
  remainingTime = 0,
  type = 'longBreak',
  status = ARGV[4],
  hasNotifiedLongBreakDetection = true
}
local updated = cjson.encode(timer)
local eventId = redis.call(
  'xadd',
  KEYS[9],
  '*',
  'schemaVersion',
  ARGV[5],
  'userId',
  ARGV[6],
  'detectionId',
  payload.detectionId,
  'detectedAt',
  tostring(now),
  'longBreakTimer',
  updated,
  'replacementTimer',
  cjson.encode(payload.replacementTimer)
)
redis.call('zrem', KEYS[11], ARGV[8])
redis.call('zrem', KEYS[2], ARGV[1])
redis.call('set', KEYS[1], cjson.encode(payload.replacementTimer))
redis.call('set', KEYS[7], cjson.encode(payload.replacementSessionState))
redis.call('del', KEYS[3], KEYS[4], KEYS[6], KEYS[13], KEYS[14])
redis.call('set', KEYS[5], 'true')
redis.call('set', KEYS[8], payload.replacementTimer.scheduleRevision)
return {'claimed', updated, cjson.encode(payload.replacementTimer), eventId, tostring(now), tostring(now), payload.detectionId}
`;

export interface TimerVersion {
  timerId: string;
  scheduleRevision: string | null;
}

export type TimerWriteResult =
  | { kind: 'updated'; timer: Timer }
  | { kind: 'conflict'; current: Timer | null };

export type TimerContinuationApplyResult =
  | { kind: 'applied' | 'already-applied'; timer: Timer }
  | { kind: 'superseded'; current: Timer | null }
  | { kind: 'lost-lock' };

export const APPLY_TIMER_CONTINUATION_PLAN_SCRIPT = `
local function keyType(key)
  local result = redis.call('type', key)
  return type(result) == 'table' and result.ok or result
end
local function requireType(key, expected, label)
  local actual = keyType(key)
  if actual ~= 'none' and actual ~= expected then
    error(label .. ' key has an invalid type')
  end
end

requireType(KEYS[1], 'string', 'Current Timer')
requireType(KEYS[2], 'zset', 'Completion schedule')
requireType(KEYS[3], 'string', 'Runtime revision')
requireType(KEYS[4], 'string', 'Session state')
requireType(KEYS[5], 'string', 'Extension state')
requireType(KEYS[6], 'string', 'Last completion')
requireType(KEYS[7], 'string', 'Idle detection')
requireType(KEYS[8], 'list', 'Undo history')
requireType(KEYS[9], 'list', 'Redo history')
requireType(KEYS[10], 'string', 'Continuation lock')
requireType(KEYS[11], 'zset', 'Idle schedule')
requireType(KEYS[12], 'string', 'Idle schedule payload')

if ARGV[16] == '1' and redis.call('get', KEYS[10]) ~= ARGV[17] then
  return {-1, false}
end

local currentRaw = redis.call('get', KEYS[1])
if not currentRaw then return {0, false} end
local current = cjson.decode(currentRaw)
local currentRevision = current.scheduleRevision or ''
if current.id == ARGV[3] and currentRevision == ARGV[4] then
  if ARGV[19] ~= ''
      and redis.call('get', KEYS[3]) == ARGV[4]
      and ARGV[12] == 'set'
      and redis.call('get', KEYS[6]) == ARGV[13]
      and redis.call('exists', KEYS[7]) == 0 then
    redis.call('set', KEYS[12], ARGV[19])
    redis.call('zadd', KEYS[11], ARGV[20], ARGV[18])
  end
  return {2, currentRaw}
end
if current.id ~= ARGV[1] or currentRevision ~= ARGV[2] then
  return {0, currentRaw}
end

local nextTimer = cjson.decode(ARGV[5])
nextTimer.scheduleRevision = ARGV[4]
local updated = cjson.encode(nextTimer)
redis.call('zrem', KEYS[2], ARGV[6])
if nextTimer.status == ARGV[7] then
  redis.call('zadd', KEYS[2], tonumber(nextTimer.startTime) + tonumber(nextTimer.duration), ARGV[6])
end
redis.call('set', KEYS[1], updated)
if ARGV[8] == 'set' then
  redis.call('set', KEYS[4], ARGV[9])
elseif ARGV[8] == 'clear' then
  redis.call('del', KEYS[4])
end
if ARGV[10] == 'set' then
  redis.call('set', KEYS[5], ARGV[11])
elseif ARGV[10] == 'clear' then
  redis.call('del', KEYS[5])
end
if ARGV[12] == 'set' then
  redis.call('set', KEYS[6], ARGV[13])
elseif ARGV[12] == 'clear' then
  redis.call('del', KEYS[6])
end
if ARGV[14] == '1' then redis.call('del', KEYS[7]) end
if ARGV[15] == '1' then redis.call('del', KEYS[8], KEYS[9]) end
redis.call('zrem', KEYS[11], ARGV[18])
if ARGV[19] ~= '' then
  redis.call('set', KEYS[12], ARGV[19])
  redis.call('zadd', KEYS[11], ARGV[20], ARGV[18])
else
  redis.call('del', KEYS[12])
end
redis.call('set', KEYS[3], ARGV[4])
return {1, updated}
`;

export function timerVersion(timer: Timer): TimerVersion {
  return {
    timerId: timer.id,
    scheduleRevision: timer.scheduleRevision ?? null,
  };
}

export interface TimerSessionState {
  currentPosition: number;
  totalPomodoros: number;
  stackedSessions?: number;
  completedIntentionEmojis?: Record<number, string>;
}

export interface TimerWriteOptions {
  sessionState?: TimerSessionState | null;
  extensionState?: TimerExtensionState | null;
  expectedRuntimeRevision?: string | null;
  historyTransition?: {
    direction: 'undo' | 'redo';
    serializedEntry: string;
  };
}

export interface TimerHistoryCandidate {
  entry: TimerHistoryEntry;
  serializedEntry: string;
}

export interface TimerUndoState {
  timer: Timer | null;
  sessionState: TimerSessionState | null;
  lastCompletionTimestamp: number | null;
  idleDetected: boolean;
  capturedAt: number;
  extensionState?: TimerExtensionState | null;
  metadata?: {
    action:
      | 'skip'
      | 'addFiveMinutes'
      | 'reset'
      | 'longBreak'
      | 'validate'
      | 'resolveExtension';
    statisticTimerId?: string;
    statisticType?: TimerTypes;
    statisticIntention?: string;
    statisticIntentions?: string[];
    statisticSubIntentions?: Record<string, string>;
    statisticUndoMode?: 'remove' | 'restore';
    statisticOriginalDuration?: number;
    statisticOriginalCompletedAt?: number;
  };
}

export interface TimerRuntimeSnapshot {
  timer: Timer | null;
  sessionState: TimerSessionState | null;
  lastCompletionTimestamp: number | null;
  idleDetected: boolean;
  extensionState?: TimerExtensionState | null;
}

export interface TimerHistoryStatisticSnapshot {
  id: string;
  before: StatisticHistorySnapshot | null;
  after: StatisticHistorySnapshot | null;
}

export interface TimerHistoryEntry {
  before: TimerRuntimeSnapshot;
  after: TimerRuntimeSnapshot;
  capturedAt: number;
  label: string;
  logEffect?: 'added' | 'removed' | 'restored' | 'updated';
  statistics?: TimerHistoryStatisticSnapshot[];
}

export interface TimerUserDataSnapshot {
  currentTimer: Timer | null;
  sessionState: TimerSessionState | null;
  lastCompletionTimestamp: number | null;
  idleDetected: boolean;
  undoState: TimerUndoState | null;
  undoHistory: TimerHistoryEntry[];
  redoHistory: TimerHistoryEntry[];
  extensionState: TimerExtensionState | null;
}

@Injectable()
export class TimerStore {
  private readonly redis: Redis;
  private readonly currentTimerPattern = 'user:*:current_timer';
  private readonly lastCompletionPattern = 'user:*:last_timer_completion';
  private scheduleWakeSubscriber: Redis | null = null;
  private scheduleWakeListener: (() => void) | null = null;
  private scheduleWakeMessageHandler:
    ((channel: string, message: string) => void) | null = null;
  private scheduleWakeErrorHandler: (() => void) | null = null;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.redis = redis;
  }

  async startTimerScheduleWakeListener(onWake: () => void): Promise<void> {
    this.scheduleWakeListener = onWake;
    if (this.scheduleWakeSubscriber) return;

    const subscriber = this.redis.duplicate();
    const onMessage = (channel: string) => {
      if (channel === TIMER_SCHEDULE_WAKE_CHANNEL) {
        this.scheduleWakeListener?.();
      }
    };
    const onError = () => this.scheduleWakeListener?.();
    this.scheduleWakeSubscriber = subscriber;
    this.scheduleWakeMessageHandler = onMessage;
    this.scheduleWakeErrorHandler = onError;
    subscriber.on('message', onMessage);
    subscriber.on('error', onError);

    try {
      await subscriber.subscribe(TIMER_SCHEDULE_WAKE_CHANNEL);
    } catch (error) {
      subscriber.off('message', onMessage);
      subscriber.off('error', onError);
      this.scheduleWakeSubscriber = null;
      this.scheduleWakeMessageHandler = null;
      this.scheduleWakeErrorHandler = null;
      this.scheduleWakeListener = null;
      subscriber.disconnect();
      throw error;
    }
  }

  async stopTimerScheduleWakeListener(): Promise<void> {
    const subscriber = this.scheduleWakeSubscriber;
    if (!subscriber) {
      this.scheduleWakeListener = null;
      return;
    }

    const onMessage = this.scheduleWakeMessageHandler;
    const onError = this.scheduleWakeErrorHandler;
    this.scheduleWakeSubscriber = null;
    this.scheduleWakeMessageHandler = null;
    this.scheduleWakeErrorHandler = null;
    this.scheduleWakeListener = null;
    if (onMessage) subscriber.off('message', onMessage);
    if (onError) subscriber.off('error', onError);

    try {
      await subscriber.unsubscribe(TIMER_SCHEDULE_WAKE_CHANNEL);
    } catch {
      // Disconnect below also handles a subscriber whose Redis connection is down.
    }
    subscriber.disconnect();
  }

  async getCurrentTimer(userId: string): Promise<Timer | null> {
    const timerStr = await this.redis.get(this.currentTimerKey(userId));
    if (!timerStr) return null;
    return JSON.parse(timerStr) as Timer;
  }

  async replaceCurrentTimer(
    userId: string,
    expected: TimerVersion | null,
    timer: Timer,
    options?: TimerWriteOptions
  ): Promise<TimerWriteResult> {
    const nextRevision = randomUUID();
    const raw = (await this.redis.eval(
      `
      local currentRaw = redis.call('get', KEYS[1])
      local expectedId = ARGV[1]
      local expectedRevision = ARGV[2]
      if ARGV[10] == '1' and (redis.call('get', KEYS[4]) or '') ~= ARGV[11] then
        return {0, currentRaw or false}
      end
      if ARGV[12] == 'undo' and redis.call('lindex', KEYS[5], -1) ~= ARGV[13] then
        return {0, currentRaw or false}
      end
      if ARGV[12] == 'redo' and redis.call('lindex', KEYS[6], -1) ~= ARGV[13] then
        return {0, currentRaw or false}
      end

      if currentRaw then
        local current = cjson.decode(currentRaw)
        local currentRevision = current.scheduleRevision or ''
        if expectedId == '' or current.id ~= expectedId or currentRevision ~= expectedRevision then
          return {0, currentRaw}
        end
      elseif expectedId ~= '' then
        return {0, false}
      end

      local timer = cjson.decode(ARGV[3])
      timer.scheduleRevision = ARGV[4]
      local updated = cjson.encode(timer)
      redis.call('set', KEYS[1], updated)
      redis.call('zrem', KEYS[2], ARGV[5])
      if timer.status == ARGV[6] then
        redis.call('zadd', KEYS[2], tonumber(timer.startTime) + tonumber(timer.duration), ARGV[5])
      end
      if ARGV[7] == 'set' then
        redis.call('set', KEYS[3], ARGV[8])
      elseif ARGV[7] == 'clear' then
        redis.call('del', KEYS[3])
      end
      if ARGV[12] == 'undo' then
        redis.call('rpop', KEYS[5])
        redis.call('rpush', KEYS[6], ARGV[13])
      elseif ARGV[12] == 'redo' then
        redis.call('rpop', KEYS[6])
        redis.call('rpush', KEYS[5], ARGV[13])
      end
      if ARGV[14] == 'set' then
        redis.call('set', KEYS[7], ARGV[15])
      elseif ARGV[14] == 'clear' then
        redis.call('del', KEYS[7])
      end
      redis.call('set', KEYS[4], ARGV[9])
      return {1, updated}
      `,
      7,
      this.currentTimerKey(userId),
      TIMER_COMPLETION_SCHEDULE_KEY,
      this.sessionStateKey(userId),
      this.runtimeRevisionKey(userId),
      this.undoHistoryKey(userId),
      this.redoHistoryKey(userId),
      this.extensionStateKey(userId),
      expected?.timerId ?? '',
      expected?.scheduleRevision ?? '',
      JSON.stringify(timer),
      nextRevision,
      this.completionScheduleMember(userId),
      TIMER_STATUSES.RUNNING,
      options?.sessionState === undefined
        ? 'keep'
        : options.sessionState === null
          ? 'clear'
          : 'set',
      options?.sessionState ? JSON.stringify(options.sessionState) : '',
      nextRevision,
      options?.expectedRuntimeRevision === undefined ? '0' : '1',
      options?.expectedRuntimeRevision ?? '',
      options?.historyTransition?.direction ?? '',
      options?.historyTransition?.serializedEntry ?? '',
      options?.extensionState === undefined
        ? 'keep'
        : options.extensionState === null
          ? 'clear'
          : 'set',
      options?.extensionState ? JSON.stringify(options.extensionState) : ''
    )) as [number, string | null];

    if (raw[0] !== 1) {
      return {
        kind: 'conflict',
        current: raw[1] ? (JSON.parse(raw[1]) as Timer) : null,
      };
    }

    const committed = JSON.parse(raw[1] as string) as Timer;
    await this.notifyTimerScheduleWake();
    return { kind: 'updated', timer: committed };
  }

  async applyTimerContinuationPlan(
    userId: string,
    plan: TimerContinuationPlanV2,
    claimToken?: string
  ): Promise<TimerContinuationApplyResult> {
    const validatedPlan = parseTimerContinuationPlan(
      plan,
      TIMER_CONTINUATION_PLAN_VERSION
    );
    if (validatedPlan.nextTimer.userId !== userId) {
      throw new ConflictException('Timer continuation plan is invalid');
    }
    const idleDetectionPayload = validatedPlan.idleDetection
      ? this.idleDetectionPayload(
          userId,
          validatedPlan.lastCompletionTimestamp.kind === 'set'
            ? validatedPlan.lastCompletionTimestamp.value
            : null,
          validatedPlan.idleDetection
        )
      : null;
    const raw = (await this.redis.eval(
      APPLY_TIMER_CONTINUATION_PLAN_SCRIPT,
      12,
      this.currentTimerKey(userId),
      TIMER_COMPLETION_SCHEDULE_KEY,
      this.runtimeRevisionKey(userId),
      this.sessionStateKey(userId),
      this.extensionStateKey(userId),
      this.lastCompletionKey(userId),
      this.idleDetectedKey(userId),
      this.undoHistoryKey(userId),
      this.redoHistoryKey(userId),
      this.continuationLockKey(userId),
      TIMER_IDLE_SCHEDULE_KEY,
      this.idleSchedulePayloadKey(userId),
      validatedPlan.source.timerId,
      validatedPlan.source.scheduleRevision as string,
      validatedPlan.nextTimer.id,
      validatedPlan.nextTimer.scheduleRevision as string,
      JSON.stringify(validatedPlan.nextTimer),
      this.completionScheduleMember(userId),
      TIMER_STATUSES.RUNNING,
      validatedPlan.sessionState.kind,
      this.serializeMutation(validatedPlan.sessionState),
      validatedPlan.extensionState.kind,
      this.serializeMutation(validatedPlan.extensionState),
      validatedPlan.lastCompletionTimestamp.kind,
      this.serializeMutation(validatedPlan.lastCompletionTimestamp),
      validatedPlan.clearIdleDetected ? '1' : '0',
      validatedPlan.clearHistory ? '1' : '0',
      claimToken ? '1' : '0',
      claimToken ?? '',
      this.idleScheduleMember(userId),
      idleDetectionPayload ? JSON.stringify(idleDetectionPayload) : '',
      idleDetectionPayload?.checkAt.toString() ?? ''
    )) as [number, string | null];

    if (raw[0] === -1) return { kind: 'lost-lock' };
    if (raw[0] === 0) {
      return {
        kind: 'superseded',
        current: raw[1] ? (JSON.parse(raw[1]) as Timer) : null,
      };
    }
    if (raw[0] === 1) await this.notifyTimerScheduleWake();
    return {
      kind: raw[0] === 1 ? 'applied' : 'already-applied',
      timer: JSON.parse(raw[1] as string) as Timer,
    };
  }

  async claimTimerContinuationUserLock(
    userId: string,
    leaseMs: number
  ): Promise<string | null> {
    const claimToken = randomUUID();
    const claimed = await this.redis.set(
      this.continuationLockKey(userId),
      claimToken,
      'PX',
      leaseMs,
      'NX'
    );
    return claimed === 'OK' ? claimToken : null;
  }

  async releaseTimerContinuationUserLock(
    userId: string,
    claimToken: string
  ): Promise<boolean> {
    const released = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('del', KEYS[1])
        return 1
      `,
      1,
      this.continuationLockKey(userId),
      claimToken
    )) as number;
    return released === 1;
  }

  async renewTimerContinuationUserLock(
    userId: string,
    claimToken: string,
    leaseMs: number
  ): Promise<boolean> {
    const renewed = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('pexpire', KEYS[1], ARGV[2])
        return 1
      `,
      1,
      this.continuationLockKey(userId),
      claimToken,
      leaseMs
    )) as number;
    return renewed === 1;
  }

  async claimRunningTimerWarning(
    userId: string,
    timerId: string,
    startTime: number,
    notifyBeforeTime: number
  ): Promise<Timer | null> {
    const raw = (await this.redis.eval(
      `
      local raw = redis.call('get', KEYS[1])
      if not raw then return nil end
      local timer = cjson.decode(raw)
      if timer.id ~= ARGV[1] or timer.status ~= ARGV[2] or tonumber(timer.startTime) ~= tonumber(ARGV[3]) or timer.hasNotifiedBeforeTimeNotification == true then
        return nil
      end
      local redisTime = redis.call('TIME')
      local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
      local remainingTime = tonumber(timer.duration) - (now - tonumber(timer.startTime))
      if remainingTime > tonumber(ARGV[4]) then return nil end
      timer.remainingTime = math.max(0, remainingTime)
      timer.hasNotifiedBeforeTimeNotification = true
      timer.scheduleRevision = ARGV[5]
      local updated = cjson.encode(timer)
      redis.call('set', KEYS[1], updated)
      redis.call('zadd', KEYS[2], tonumber(timer.startTime) + tonumber(timer.duration), ARGV[6])
      redis.call('set', KEYS[3], ARGV[5])
      return updated
      `,
      3,
      this.currentTimerKey(userId),
      TIMER_COMPLETION_SCHEDULE_KEY,
      this.runtimeRevisionKey(userId),
      timerId,
      TIMER_STATUSES.RUNNING,
      startTime,
      notifyBeforeTime,
      randomUUID(),
      this.completionScheduleMember(userId)
    )) as string | null;
    if (raw) await this.notifyTimerScheduleWake();
    return raw ? (JSON.parse(raw) as Timer) : null;
  }

  async claimRunningTimerCompletionByMode(
    userId: string,
    timerId: string,
    startTime: number
  ): Promise<TimerCompletionClaim | null> {
    return this.claimRunningTimerCompletion(userId, timerId, startTime);
  }

  private async claimRunningTimerCompletion(
    userId: string,
    timerId: string,
    startTime: number
  ): Promise<TimerCompletionClaim | null> {
    const raw = (await this.redis.eval(
      CLAIM_RUNNING_TIMER_COMPLETION_BY_MODE_SCRIPT,
      6,
      this.currentTimerKey(userId),
      TIMER_COMPLETION_SCHEDULE_KEY,
      this.runtimeRevisionKey(userId),
      TIMER_COMPLETION_STREAM_KEY,
      TIMER_COMPLETION_MODE_KEY,
      TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
      timerId,
      TIMER_STATUSES.RUNNING,
      startTime,
      TIMER_STATUSES.COMPLETED,
      randomUUID(),
      this.completionScheduleMember(userId),
      TIMER_COMPLETION_STREAM_VERSION,
      userId
    )) as [string, TimerCompletionMode, string, string, string] | null;

    if (!raw) {
      return null;
    }
    await this.notifyTimerScheduleWake();
    return {
      timer: JSON.parse(raw[0]) as Timer,
      mode: raw[1],
      eventId: raw[2] || null,
      completedAt: Number(raw[3]),
      claimedAt: Number(raw[4]),
    };
  }

  async getTimerCompletionMode(): Promise<TimerCompletionMode> {
    return (await this.redis.get(TIMER_COMPLETION_MODE_KEY)) === 'stream'
      ? 'stream'
      : 'legacy';
  }

  async getIdleDetectionMode(): Promise<TimerIdleDetectionMode> {
    return (await this.redis.get(TIMER_IDLE_DETECTION_MODE_KEY)) === 'durable'
      ? 'durable'
      : 'legacy';
  }

  async enableDurableIdleDetection(
    leaderToken: string,
    expectedGeneration: number
  ): Promise<boolean> {
    if (
      !leaderToken ||
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0
    ) {
      throw new BadRequestException(
        'Durable idle detection transition is invalid'
      );
    }
    const enabled = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        if redis.call('get', KEYS[2]) ~= '1' then return 0 end
        if tonumber(redis.call('get', KEYS[3]) or '0') ~= tonumber(ARGV[2]) then return 0 end
        redis.call('set', KEYS[4], 'durable')
        return 1
      `,
      4,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_IDLE_SCHEDULE_READY_KEY,
      TIMER_IDLE_SCHEDULE_GENERATION_KEY,
      TIMER_IDLE_DETECTION_MODE_KEY,
      leaderToken,
      expectedGeneration
    )) as number;
    return enabled === 1;
  }

  async getRedisTimeMs(): Promise<number> {
    const [seconds, microseconds] = await this.redis.time();
    return Number(seconds) * 1_000 + Math.floor(Number(microseconds) / 1_000);
  }

  async getDueTimerCompletions(
    now: number,
    limit: number
  ): Promise<DueTimerCompletion[]> {
    if (!Number.isSafeInteger(now) || now < 0 || limit < 1 || limit > 1_000) {
      throw new BadRequestException(
        'Timer completion schedule bounds are invalid'
      );
    }
    const raw = await this.redis.zrangebyscore(
      TIMER_COMPLETION_SCHEDULE_KEY,
      0,
      now,
      'WITHSCORES',
      'LIMIT',
      0,
      limit
    );
    const due: DueTimerCompletion[] = [];
    for (let index = 0; index < raw.length; index += 2) {
      const member = raw[index];
      const userId = this.userIdFromCompletionScheduleMember(member);
      const deadline = Number(raw[index + 1]);
      if (Number.isSafeInteger(deadline) && deadline >= 0) {
        due.push({ member, userId, deadline });
      }
    }
    return due;
  }

  async getNextTimerCompletionDeadline(): Promise<number | null> {
    return this.getNextScheduleDeadline(TIMER_COMPLETION_SCHEDULE_KEY);
  }

  async getDueIdleDetections(
    now: number,
    limit: number
  ): Promise<DueIdleDetection[]> {
    if (!Number.isSafeInteger(now) || now < 0 || limit < 1 || limit > 1_000) {
      throw new BadRequestException(
        'Idle detection schedule bounds are invalid'
      );
    }
    const raw = await this.redis.zrangebyscore(
      TIMER_IDLE_SCHEDULE_KEY,
      0,
      now,
      'WITHSCORES',
      'LIMIT',
      0,
      limit
    );
    const due: DueIdleDetection[] = [];
    for (let index = 0; index < raw.length; index += 2) {
      const member = raw[index];
      const userId = this.userIdFromIdleScheduleMember(member);
      const deadline = Number(raw[index + 1]);
      if (Number.isSafeInteger(deadline) && deadline >= 0) {
        due.push({ member, userId, deadline });
      }
    }
    return due;
  }

  async getNextIdleDetectionDeadline(): Promise<number | null> {
    return this.getNextScheduleDeadline(TIMER_IDLE_SCHEDULE_KEY);
  }

  async scheduleIdleDetection(
    userId: string,
    policy: IdleDetectionSchedulePolicy,
    leaderToken?: string
  ): Promise<'scheduled' | 'stale' | 'lost-leader'> {
    if (
      !Number.isSafeInteger(policy.longBreakDuration) ||
      policy.longBreakDuration <= 0 ||
      !Number.isSafeInteger(policy.workTimerDuration) ||
      policy.workTimerDuration <= 0 ||
      !Number.isSafeInteger(policy.sessionPomodorosCount) ||
      policy.sessionPomodorosCount <= 0
    ) {
      throw new BadRequestException('Idle detection policy is invalid');
    }
    const [lastCompletion, currentTimer, runtimeRevision] = await Promise.all([
      this.getLastCompletionTimestamp(userId),
      this.getCurrentTimer(userId),
      this.getRuntimeRevision(userId),
    ]);
    if (
      lastCompletion === null ||
      !currentTimer?.scheduleRevision ||
      !runtimeRevision
    ) {
      await this.cancelIdleDetectionSchedule(userId, leaderToken);
      return 'stale';
    }
    const checkAt = lastCompletion + policy.longBreakDuration;
    if (!Number.isSafeInteger(checkAt)) {
      throw new BadRequestException('Idle detection deadline is invalid');
    }
    const payload: IdleDetectionSchedulePayload = {
      detectionId: randomUUID(),
      checkAt,
      longBreakDuration: policy.longBreakDuration,
      expectedLastCompletionTimestamp: lastCompletion,
      expectedTimer: timerVersion(currentTimer),
      expectedRuntimeRevision: runtimeRevision,
      longBreakTimerId: randomUUID(),
      replacementTimer: {
        id: randomUUID(),
        scheduleRevision: randomUUID(),
        userId,
        startTime: 0,
        duration: policy.workTimerDuration,
        remainingTime: policy.workTimerDuration,
        type: 'work',
        status: 'paused',
        sessionPosition: 1,
        sessionTotal: policy.sessionPomodorosCount,
        hasNotifiedPausedTimerReminder: false,
      },
      replacementSessionState: {
        currentPosition: 1,
        totalPomodoros: policy.sessionPomodorosCount,
      },
      userId,
    };
    const result = (await this.redis.eval(
      `
        if ARGV[1] == '1' and redis.call('get', KEYS[1]) ~= ARGV[2] then
          return 'lost-leader'
        end
        if redis.call('get', KEYS[2]) ~= ARGV[3]
            or redis.call('get', KEYS[6]) ~= ARGV[7]
            or redis.call('get', KEYS[7]) ~= ARGV[8] then return 'stale' end
        if redis.call('exists', KEYS[3]) == 1 then
          redis.call('zrem', KEYS[4], ARGV[4])
          redis.call('del', KEYS[5])
          return 'stale'
        end
        redis.call('set', KEYS[5], ARGV[5])
        redis.call('zadd', KEYS[4], ARGV[6], ARGV[4])
        return 'scheduled'
      `,
      7,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      this.lastCompletionKey(userId),
      this.idleDetectedKey(userId),
      TIMER_IDLE_SCHEDULE_KEY,
      this.idleSchedulePayloadKey(userId),
      this.currentTimerKey(userId),
      this.runtimeRevisionKey(userId),
      leaderToken ? '1' : '0',
      leaderToken ?? '',
      lastCompletion.toString(),
      this.idleScheduleMember(userId),
      JSON.stringify(payload),
      checkAt.toString(),
      JSON.stringify(currentTimer),
      runtimeRevision
    )) as 'scheduled' | 'stale' | 'lost-leader';
    if (result !== 'lost-leader') await this.notifyTimerScheduleWake();
    return result;
  }

  async cancelIdleDetectionSchedule(
    userId: string,
    leaderToken?: string
  ): Promise<boolean> {
    const removed = (await this.redis.eval(
      `
        if ARGV[1] == '1' and redis.call('get', KEYS[1]) ~= ARGV[2] then
          return -1
        end
        redis.call('del', KEYS[3])
        return redis.call('zrem', KEYS[2], ARGV[3])
      `,
      3,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_IDLE_SCHEDULE_KEY,
      this.idleSchedulePayloadKey(userId),
      leaderToken ? '1' : '0',
      leaderToken ?? '',
      this.idleScheduleMember(userId)
    )) as number;
    if (removed === -1) return false;
    await this.notifyTimerScheduleWake();
    return true;
  }

  async claimScheduledIdleDetection(
    userId: string,
    scheduled: DueIdleDetection,
    leaderToken: string
  ): Promise<ScheduledIdleDetectionResult> {
    if (
      scheduled.userId !== userId ||
      scheduled.member !== this.idleScheduleMember(userId)
    ) {
      throw new BadRequestException('Idle detection schedule is invalid');
    }
    const raw = (await this.redis.eval(
      CLAIM_SCHEDULED_IDLE_DETECTION_SCRIPT,
      15,
      this.currentTimerKey(userId),
      TIMER_IDLE_SCHEDULE_KEY,
      this.idleSchedulePayloadKey(userId),
      this.lastCompletionKey(userId),
      this.idleDetectedKey(userId),
      this.extensionStateKey(userId),
      this.sessionStateKey(userId),
      this.runtimeRevisionKey(userId),
      TIMER_IDLE_DETECTION_STREAM_KEY,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_COMPLETION_SCHEDULE_KEY,
      TIMER_IDLE_SCHEDULE_QUARANTINE_KEY,
      this.undoHistoryKey(userId),
      this.redoHistoryKey(userId),
      TIMER_IDLE_DETECTION_MODE_KEY,
      scheduled.member,
      scheduled.deadline,
      TIMER_STATUSES.RUNNING,
      TIMER_STATUSES.COMPLETED,
      TIMER_IDLE_DETECTION_STREAM_VERSION,
      userId,
      leaderToken,
      this.completionScheduleMember(userId)
    )) as string[];
    if (raw[0] !== 'lost-leader') await this.notifyTimerScheduleWake();
    if (raw[0] !== 'claimed') {
      return {
        kind: raw[0] as Exclude<
          ScheduledIdleDetectionResult['kind'],
          'claimed'
        >,
      };
    }
    return {
      kind: 'claimed',
      claim: {
        longBreakTimer: JSON.parse(raw[1]) as Timer,
        replacementTimer: JSON.parse(raw[2]) as Timer,
        eventId: raw[3],
        detectedAt: Number(raw[4]),
        detectionId: raw[6],
      },
    };
  }

  async claimLegacyIdleDetection(
    userId: string,
    expectedLastCompletionTimestamp: number,
    expectedTimer: TimerVersion
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(expectedLastCompletionTimestamp) ||
      expectedLastCompletionTimestamp < 0 ||
      !expectedTimer.timerId ||
      !expectedTimer.scheduleRevision
    ) {
      throw new BadRequestException('Legacy idle detection claim is invalid');
    }
    const claimed = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) == 'durable' then return 0 end
        if redis.call('exists', KEYS[2]) == 1 then return 0 end
        if redis.call('get', KEYS[3]) ~= ARGV[1] then return 0 end
        local currentRaw = redis.call('get', KEYS[4])
        if not currentRaw then return 0 end
        local decoded, current = pcall(cjson.decode, currentRaw)
        if not decoded or type(current) ~= 'table'
            or current.id ~= ARGV[2]
            or current.scheduleRevision ~= ARGV[3]
            or current.status == ARGV[4]
            or current.remainingTime ~= current.duration then return 0 end
        redis.call('set', KEYS[2], 'true')
        redis.call('zrem', KEYS[5], ARGV[5])
        redis.call('del', KEYS[6])
        redis.call('set', KEYS[7], ARGV[6])
        return 1
      `,
      7,
      TIMER_IDLE_DETECTION_MODE_KEY,
      this.idleDetectedKey(userId),
      this.lastCompletionKey(userId),
      this.currentTimerKey(userId),
      TIMER_IDLE_SCHEDULE_KEY,
      this.idleSchedulePayloadKey(userId),
      this.runtimeRevisionKey(userId),
      expectedLastCompletionTimestamp.toString(),
      expectedTimer.timerId,
      expectedTimer.scheduleRevision,
      TIMER_STATUSES.RUNNING,
      this.idleScheduleMember(userId),
      randomUUID()
    )) as number;
    if (claimed === 1) await this.notifyTimerScheduleWake();
    return claimed === 1;
  }

  async removeMalformedIdleDetection(
    member: string,
    expectedDeadline: number,
    leaderToken: string
  ): Promise<boolean> {
    const removed = (await this.redis.eval(
      `
        if redis.call('get', KEYS[2]) ~= ARGV[3] then return 0 end
        local score = redis.call('zscore', KEYS[1], ARGV[1])
        if not score or tonumber(score) ~= tonumber(ARGV[2]) then return 0 end
        redis.call('hset', KEYS[3], ARGV[1], 'malformed-schedule-member:' .. ARGV[2])
        return redis.call('zrem', KEYS[1], ARGV[1])
      `,
      3,
      TIMER_IDLE_SCHEDULE_KEY,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_IDLE_SCHEDULE_QUARANTINE_KEY,
      member,
      expectedDeadline,
      leaderToken
    )) as number;
    if (removed === 1) await this.notifyTimerScheduleWake();
    return removed === 1;
  }

  async scanCurrentTimerUsers(
    cursor: string,
    count: number
  ): Promise<{ cursor: string; userIds: string[] }> {
    if (!/^\d+$/.test(cursor) || count < 1 || count > 1_000) {
      throw new BadRequestException('Timer schedule scan bounds are invalid');
    }
    const [nextCursor, keys] = await this.redis.scan(
      cursor,
      'MATCH',
      this.currentTimerPattern,
      'COUNT',
      count
    );
    return {
      cursor: nextCursor,
      userIds: keys
        .map(key => this.userIdFromCurrentTimerKey(key))
        .filter((userId): userId is string => userId !== null),
    };
  }

  async scanLastCompletionUsers(
    cursor: string,
    count: number
  ): Promise<{ cursor: string; userIds: string[] }> {
    if (!/^\d+$/.test(cursor) || count < 1 || count > 1_000) {
      throw new BadRequestException('Idle schedule scan bounds are invalid');
    }
    const [nextCursor, keys] = await this.redis.scan(
      cursor,
      'MATCH',
      this.lastCompletionPattern,
      'COUNT',
      count
    );
    return {
      cursor: nextCursor,
      userIds: keys
        .map(key => this.userIdFromLastCompletionKey(key))
        .filter((userId): userId is string => userId !== null),
    };
  }

  async isTimerCompletionScheduleReady(): Promise<boolean> {
    return (await this.redis.get(TIMER_COMPLETION_SCHEDULE_READY_KEY)) === '1';
  }

  async markTimerCompletionScheduleReady(
    leaderToken: string
  ): Promise<boolean> {
    const marked = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('set', KEYS[2], '1')
        return 1
      `,
      2,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_COMPLETION_SCHEDULE_READY_KEY,
      leaderToken
    )) as number;
    return marked === 1;
  }

  async isIdleDetectionScheduleReady(): Promise<boolean> {
    return (await this.redis.get(TIMER_IDLE_SCHEDULE_READY_KEY)) === '1';
  }

  async getIdleDetectionScheduleGeneration(): Promise<number> {
    const raw = await this.redis.get(TIMER_IDLE_SCHEDULE_GENERATION_KEY);
    const generation = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new ConflictException('Idle schedule generation is invalid');
    }
    return generation;
  }

  async prepareIdleDetectionScheduleChange(): Promise<void> {
    await this.redis
      .multi()
      .del(TIMER_IDLE_SCHEDULE_READY_KEY)
      .incr(TIMER_IDLE_SCHEDULE_GENERATION_KEY)
      .exec();
    await this.notifyTimerScheduleWake();
  }

  async markIdleDetectionScheduleReady(
    leaderToken: string,
    expectedGeneration: number
  ): Promise<boolean> {
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) {
      throw new BadRequestException('Idle schedule generation is invalid');
    }
    const marked = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        if tonumber(redis.call('get', KEYS[3]) or '0') ~= tonumber(ARGV[2]) then return 0 end
        redis.call('set', KEYS[2], '1')
        return 1
      `,
      3,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_IDLE_SCHEDULE_READY_KEY,
      TIMER_IDLE_SCHEDULE_GENERATION_KEY,
      leaderToken,
      expectedGeneration
    )) as number;
    return marked === 1;
  }

  async reconcileTimerCompletionSchedule(
    userId: string,
    leaderToken: string
  ): Promise<TimerScheduleReconcileResult> {
    const raw = (await this.redis.eval(
      `
        local function quarantine(raw)
          redis.call('hset', KEYS[4], ARGV[1], raw)
          redis.call('zrem', KEYS[2], ARGV[1])
          return 'corrupt'
        end
        local function safeNonNegativeInteger(value)
          return type(value) == 'number'
            and value >= 0
            and value <= 9007199254740991
            and value == math.floor(value)
        end
        local function safePositiveInteger(value)
          return safeNonNegativeInteger(value) and value > 0
        end
        ${TIMER_STREAM_PAYLOAD_FIELDS_VALIDATION_LUA}
        local function validOptionalPositiveInteger(value)
          return value == nil or safePositiveInteger(value)
        end
        local function validTimerType(value)
          return value == 'work' or value == 'break' or value == 'longBreak'
        end
        if redis.call('get', KEYS[3]) ~= ARGV[2] then return 'lost-leader' end
        local currentRaw = redis.call('get', KEYS[1])
        if not currentRaw then
          redis.call('zrem', KEYS[2], ARGV[1])
          return 'removed'
        end
        local decoded, timer = pcall(cjson.decode, currentRaw)
        if not decoded or type(timer) ~= 'table' then return quarantine(currentRaw) end
        if timer.status ~= ARGV[3] then
          redis.call('zrem', KEYS[2], ARGV[1])
          return 'removed'
        end
        local hasSessionPosition = timer.sessionPosition ~= nil
        local hasSessionTotal = timer.sessionTotal ~= nil
        if type(timer.id) ~= 'string' or not string.find(timer.id, '%S')
            or type(timer.userId) ~= 'string' or timer.userId ~= ARGV[4]
            or not safeNonNegativeInteger(timer.startTime)
            or not safePositiveInteger(timer.duration)
            or not safeNonNegativeInteger(timer.remainingTime)
            or not validTimerType(timer.type)
            or not validTimerPayloadFields(timer)
            or not validOptionalPositiveInteger(timer.sessionPosition)
            or not validOptionalPositiveInteger(timer.sessionTotal)
            or not validOptionalPositiveInteger(timer.stackedSessions)
            or not validOptionalPositiveInteger(timer.originalDuration)
            or not validOptionalPositiveInteger(timer.originalBreakDuration)
            or not validOptionalPositiveInteger(timer.extensionBaseDuration)
            or hasSessionPosition ~= hasSessionTotal
            or (hasSessionPosition and (
              timer.sessionPosition <= 0
              or timer.sessionTotal <= 0
              or timer.sessionPosition > timer.sessionTotal
            ))
            or (timer.isExtension ~= nil and type(timer.isExtension) ~= 'boolean')
            or (timer.extensionNextTimerType ~= nil and not validTimerType(timer.extensionNextTimerType))
            or timer.startTime + timer.duration > 9007199254740991 then
          return quarantine(currentRaw)
        end
        local deadline = timer.startTime + timer.duration
        redis.call('zadd', KEYS[2], deadline, ARGV[1])
        return 'scheduled'
      `,
      4,
      this.currentTimerKey(userId),
      TIMER_COMPLETION_SCHEDULE_KEY,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
      this.completionScheduleMember(userId),
      leaderToken,
      TIMER_STATUSES.RUNNING,
      userId
    )) as TimerScheduleReconcileResult;
    if (raw !== 'lost-leader') await this.notifyTimerScheduleWake();
    return raw;
  }

  async removeMalformedTimerCompletion(
    member: string,
    expectedDeadline: number,
    leaderToken: string
  ): Promise<boolean> {
    const removed = (await this.redis.eval(
      `
        if redis.call('get', KEYS[2]) ~= ARGV[3] then return 0 end
        if redis.call('get', KEYS[3]) ~= 'stream' then return 0 end
        local score = redis.call('zscore', KEYS[1], ARGV[1])
        if not score or tonumber(score) ~= tonumber(ARGV[2]) then return 0 end
        redis.call('hset', KEYS[4], ARGV[1], 'malformed-schedule-member:' .. ARGV[2])
        return redis.call('zrem', KEYS[1], ARGV[1])
      `,
      4,
      TIMER_COMPLETION_SCHEDULE_KEY,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_COMPLETION_MODE_KEY,
      TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
      member,
      expectedDeadline,
      leaderToken
    )) as number;
    if (removed === 1) await this.notifyTimerScheduleWake();
    return removed === 1;
  }

  async claimScheduledTimerCompletion(
    userId: string,
    scheduled: DueTimerCompletion,
    leaderToken: string
  ): Promise<ScheduledTimerCompletionResult> {
    if (
      scheduled.userId !== userId ||
      scheduled.member !== this.completionScheduleMember(userId)
    ) {
      throw new BadRequestException(
        'Timer completion schedule member is invalid'
      );
    }
    const raw = (await this.redis.eval(
      CLAIM_SCHEDULED_TIMER_COMPLETION_SCRIPT,
      7,
      this.currentTimerKey(userId),
      TIMER_COMPLETION_SCHEDULE_KEY,
      this.runtimeRevisionKey(userId),
      TIMER_COMPLETION_STREAM_KEY,
      TIMER_COMPLETION_MODE_KEY,
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      TIMER_COMPLETION_SCHEDULE_QUARANTINE_KEY,
      scheduled.member,
      scheduled.deadline,
      TIMER_STATUSES.RUNNING,
      TIMER_STATUSES.COMPLETED,
      randomUUID(),
      TIMER_COMPLETION_STREAM_VERSION,
      userId,
      leaderToken
    )) as string[];
    if (raw[0] !== 'lost-leader') await this.notifyTimerScheduleWake();
    if (raw[0] !== 'claimed') {
      return {
        kind: raw[0] as Exclude<
          ScheduledTimerCompletionResult['kind'],
          'claimed'
        >,
      };
    }
    return {
      kind: 'claimed',
      claim: {
        timer: JSON.parse(raw[1]) as Timer,
        mode: 'stream',
        eventId: raw[2],
        completedAt: Number(raw[3]),
        claimedAt: Number(raw[4]),
      },
    };
  }

  async claimTimerCompletionScheduler(leaseMs: number): Promise<string | null> {
    this.requireSchedulerLease(leaseMs);
    const claimToken = randomUUID();
    const claimed = await this.redis.set(
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      claimToken,
      'PX',
      leaseMs,
      'NX'
    );
    return claimed === 'OK' ? claimToken : null;
  }

  async renewTimerCompletionScheduler(
    claimToken: string,
    leaseMs: number
  ): Promise<boolean> {
    this.requireSchedulerLease(leaseMs);
    return this.compareAndExpire(
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      claimToken,
      leaseMs
    );
  }

  async releaseTimerCompletionScheduler(claimToken: string): Promise<boolean> {
    return this.compareAndDelete(
      TIMER_COMPLETION_SCHEDULER_LOCK_KEY,
      claimToken
    );
  }

  async getAllCurrentTimerKeys(): Promise<string[]> {
    return this.scanKeys(this.currentTimerPattern);
  }

  async getRuntimeRevision(userId: string): Promise<string | null> {
    return this.redis.get(this.runtimeRevisionKey(userId));
  }

  async exportUserData(userId: string): Promise<TimerUserDataSnapshot> {
    const [
      currentTimer,
      sessionState,
      lastCompletionTimestamp,
      idleDetected,
      undoState,
      undoHistory,
      redoHistory,
      extensionState,
    ] = await Promise.all([
      this.getCurrentTimer(userId),
      this.getSessionState(userId),
      this.getLastCompletionTimestamp(userId),
      this.isIdleDetected(userId),
      this.getUndoState(userId),
      this.getTimerHistory(this.undoHistoryKey(userId)),
      this.getTimerHistory(this.redoHistoryKey(userId)),
      this.getExtensionState(userId),
    ]);

    return {
      currentTimer,
      sessionState,
      lastCompletionTimestamp,
      idleDetected,
      undoState,
      undoHistory,
      redoHistory,
      extensionState,
    };
  }

  private async exportStableUserData(userId: string): Promise<{
    snapshot: TimerUserDataSnapshot;
    runtimeRevision: string | null;
  }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.redis.get(this.runtimeRevisionKey(userId));
      const snapshot = await this.exportUserData(userId);
      const after = await this.redis.get(this.runtimeRevisionKey(userId));
      if (before === after) return { snapshot, runtimeRevision: after };
    }
    throw new ConflictException('Timer state kept changing during export');
  }

  async importUserData(
    userId: string,
    snapshot: TimerUserDataSnapshot
  ): Promise<void> {
    const multi = this.redis.multi();
    const importedTimer = snapshot.currentTimer
      ? { ...snapshot.currentTimer, scheduleRevision: randomUUID() }
      : null;
    multi.del(
      this.currentTimerKey(userId),
      this.sessionStateKey(userId),
      this.lastCompletionKey(userId),
      this.idleDetectedKey(userId),
      this.undoStateKey(userId),
      this.undoHistoryKey(userId),
      this.redoHistoryKey(userId),
      this.extensionStateKey(userId),
      this.idleSchedulePayloadKey(userId),
      TIMER_IDLE_SCHEDULE_READY_KEY
    );
    multi.zrem(
      TIMER_COMPLETION_SCHEDULE_KEY,
      this.completionScheduleMember(userId)
    );
    multi.zrem(TIMER_IDLE_SCHEDULE_KEY, this.idleScheduleMember(userId));
    multi.incr(TIMER_IDLE_SCHEDULE_GENERATION_KEY);

    if (importedTimer) {
      multi.set(this.currentTimerKey(userId), JSON.stringify(importedTimer));
      if (importedTimer.status === TIMER_STATUSES.RUNNING) {
        multi.zadd(
          TIMER_COMPLETION_SCHEDULE_KEY,
          importedTimer.startTime + importedTimer.duration,
          this.completionScheduleMember(userId)
        );
      }
    }
    if (snapshot.sessionState) {
      multi.set(
        this.sessionStateKey(userId),
        JSON.stringify(snapshot.sessionState)
      );
    }
    if (snapshot.lastCompletionTimestamp !== null) {
      multi.set(
        this.lastCompletionKey(userId),
        snapshot.lastCompletionTimestamp.toString()
      );
    }
    if (snapshot.idleDetected) {
      multi.set(this.idleDetectedKey(userId), 'true');
    }
    if (snapshot.undoState) {
      multi.set(this.undoStateKey(userId), JSON.stringify(snapshot.undoState));
    }
    for (const entry of snapshot.undoHistory) {
      multi.rpush(this.undoHistoryKey(userId), JSON.stringify(entry));
    }
    for (const entry of snapshot.redoHistory) {
      multi.rpush(this.redoHistoryKey(userId), JSON.stringify(entry));
    }
    if (snapshot.extensionState) {
      multi.set(
        this.extensionStateKey(userId),
        JSON.stringify(snapshot.extensionState)
      );
    }
    multi.set(this.runtimeRevisionKey(userId), randomUUID());

    await multi.exec();
    await this.notifyTimerScheduleWake();
  }

  private async importUserDataIfCurrentTimerMatches(
    userId: string,
    snapshot: TimerUserDataSnapshot,
    expected: TimerVersion | null,
    expectedRuntimeRevision: string | null
  ): Promise<boolean> {
    const importedTimer = snapshot.currentTimer
      ? { ...snapshot.currentTimer, scheduleRevision: randomUUID() }
      : null;
    const result = (await this.redis.eval(
      `
      local currentRaw = redis.call('get', KEYS[1])
      local expectedId = ARGV[1]
      local expectedRevision = ARGV[2]
      if currentRaw then
        local current = cjson.decode(currentRaw)
        if expectedId == '' or current.id ~= expectedId or (current.scheduleRevision or '') ~= expectedRevision then
          return 0
        end
      elseif expectedId ~= '' then
        return 0
      end
      if (redis.call('get', KEYS[10]) or '') ~= ARGV[13] then return 0 end

      redis.call('del', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7], KEYS[8])
      redis.call('zrem', KEYS[9], ARGV[3])
      if ARGV[5] ~= '' then
        local timer = cjson.decode(ARGV[5])
        redis.call('set', KEYS[1], ARGV[5])
        if timer.status == ARGV[4] then
          redis.call('zadd', KEYS[9], tonumber(timer.startTime) + tonumber(timer.duration), ARGV[3])
        end
      end
      if ARGV[6] ~= '' then redis.call('set', KEYS[2], ARGV[6]) end
      if ARGV[7] ~= '' then redis.call('set', KEYS[3], ARGV[7]) end
      if ARGV[8] == '1' then redis.call('set', KEYS[4], 'true') end
      if ARGV[9] ~= '' then redis.call('set', KEYS[5], ARGV[9]) end
      local undoHistory = cjson.decode(ARGV[10])
      for _, entry in ipairs(undoHistory) do
        redis.call('rpush', KEYS[6], cjson.encode(entry))
      end
      local redoHistory = cjson.decode(ARGV[11])
      for _, entry in ipairs(redoHistory) do
        redis.call('rpush', KEYS[7], cjson.encode(entry))
      end
      if ARGV[12] ~= '' then redis.call('set', KEYS[8], ARGV[12]) end
      redis.call('set', KEYS[10], ARGV[14])
      return 1
      `,
      10,
      this.currentTimerKey(userId),
      this.sessionStateKey(userId),
      this.lastCompletionKey(userId),
      this.idleDetectedKey(userId),
      this.undoStateKey(userId),
      this.undoHistoryKey(userId),
      this.redoHistoryKey(userId),
      this.extensionStateKey(userId),
      TIMER_COMPLETION_SCHEDULE_KEY,
      this.runtimeRevisionKey(userId),
      expected?.timerId ?? '',
      expected?.scheduleRevision ?? '',
      this.completionScheduleMember(userId),
      TIMER_STATUSES.RUNNING,
      importedTimer ? JSON.stringify(importedTimer) : '',
      snapshot.sessionState ? JSON.stringify(snapshot.sessionState) : '',
      snapshot.lastCompletionTimestamp?.toString() ?? '',
      snapshot.idleDetected ? '1' : '0',
      snapshot.undoState ? JSON.stringify(snapshot.undoState) : '',
      JSON.stringify(snapshot.undoHistory),
      JSON.stringify(snapshot.redoHistory),
      snapshot.extensionState ? JSON.stringify(snapshot.extensionState) : '',
      expectedRuntimeRevision ?? '',
      randomUUID()
    )) as number;
    if (result === 1) {
      await Promise.all([
        this.cancelIdleDetectionSchedule(userId),
        this.prepareIdleDetectionScheduleChange(),
      ]);
    }
    return result === 1;
  }

  async renameIntentionSlug(
    userId: string,
    timerType: TimerTypes,
    previousSlug: string,
    nextSlug: string
  ): Promise<void> {
    const { snapshot, runtimeRevision } =
      await this.exportStableUserData(userId);
    const renameTimer = (timer: Timer | null) =>
      timer?.type === timerType
        ? renameExactSlugValues(timer, previousSlug, nextSlug)
        : timer;
    const renameRuntime = (runtime: TimerRuntimeSnapshot) => ({
      ...runtime,
      timer: renameTimer(runtime.timer),
      extensionState:
        runtime.timer?.type === timerType && runtime.extensionState
          ? renameExactSlugValues(
              runtime.extensionState,
              previousSlug,
              nextSlug
            )
          : runtime.extensionState,
    });
    const renamedSnapshot: TimerUserDataSnapshot = {
      ...snapshot,
      currentTimer: renameTimer(snapshot.currentTimer),
      extensionState:
        snapshot.currentTimer?.type === timerType && snapshot.extensionState
          ? renameExactSlugValues(
              snapshot.extensionState,
              previousSlug,
              nextSlug
            )
          : snapshot.extensionState,
      undoState: snapshot.undoState
        ? {
            ...snapshot.undoState,
            timer: renameTimer(snapshot.undoState.timer),
            extensionState:
              snapshot.undoState.timer?.type === timerType &&
              snapshot.undoState.extensionState
                ? renameExactSlugValues(
                    snapshot.undoState.extensionState,
                    previousSlug,
                    nextSlug
                  )
                : snapshot.undoState.extensionState,
            metadata:
              snapshot.undoState.metadata?.statisticType === timerType
                ? renameExactSlugValues(
                    snapshot.undoState.metadata,
                    previousSlug,
                    nextSlug
                  )
                : snapshot.undoState.metadata,
          }
        : null,
      undoHistory: snapshot.undoHistory.map(entry => ({
        ...entry,
        before: renameRuntime(entry.before),
        after: renameRuntime(entry.after),
        statistics: renameTypedStatisticSnapshots(
          entry.statistics,
          timerType,
          previousSlug,
          nextSlug
        ),
      })),
      redoHistory: snapshot.redoHistory.map(entry => ({
        ...entry,
        before: renameRuntime(entry.before),
        after: renameRuntime(entry.after),
        statistics: renameTypedStatisticSnapshots(
          entry.statistics,
          timerType,
          previousSlug,
          nextSlug
        ),
      })),
    };
    const expected = snapshot.currentTimer
      ? timerVersion(snapshot.currentTimer)
      : null;
    if (
      !(await this.importUserDataIfCurrentTimerMatches(
        userId,
        renamedSnapshot,
        expected,
        runtimeRevision
      ))
    ) {
      throw new ConflictException(
        'Timer changed while intention rename was processing'
      );
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys = new Set<string>();
    let cursor = '0';

    do {
      const [nextCursor, scanKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );

      cursor = nextCursor;
      for (const key of scanKeys) {
        keys.add(key);
      }
    } while (cursor !== '0');

    return Array.from(keys);
  }

  private async getNextScheduleDeadline(key: string): Promise<number | null> {
    const raw = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
    const deadline = Number(raw[1]);
    return Number.isSafeInteger(deadline) && deadline >= 0 ? deadline : null;
  }

  private async notifyTimerScheduleWake(): Promise<void> {
    try {
      await this.redis.publish(TIMER_SCHEDULE_WAKE_CHANNEL, 'changed');
    } catch {
      // The scheduler's bounded fallback scan keeps a lost wakeup safe.
    }
  }

  private async getTimerHistory(key: string): Promise<TimerHistoryEntry[]> {
    const entries = await this.redis.lrange(key, 0, -1);
    return entries.map(entry => JSON.parse(entry) as TimerHistoryEntry);
  }

  private serializeMutation<T>(mutation: TimerStateMutation<T>): string {
    return mutation.kind === 'set' ? JSON.stringify(mutation.value) : '';
  }

  private idleDetectionPayload(
    userId: string,
    lastCompletionTimestamp: number | null,
    detection: NonNullable<TimerContinuationPlanV2['idleDetection']>
  ): IdleDetectionSchedulePayload {
    if (
      lastCompletionTimestamp === null ||
      detection.expectedLastCompletionTimestamp !== lastCompletionTimestamp ||
      detection.replacementTimer.userId !== userId
    ) {
      throw new ConflictException('Timer idle detection plan is invalid');
    }
    return { ...detection, userId };
  }

  async getSessionState(userId: string): Promise<TimerSessionState | null> {
    const stateStr = await this.redis.get(this.sessionStateKey(userId));
    if (!stateStr) return null;
    return JSON.parse(stateStr) as TimerSessionState;
  }

  async setSessionState(
    userId: string,
    state: TimerSessionState
  ): Promise<void> {
    await this.redis
      .multi()
      .set(this.sessionStateKey(userId), JSON.stringify(state))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async clearSessionState(userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.sessionStateKey(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async getLastCompletionTimestamp(userId: string): Promise<number | null> {
    const value = await this.redis.get(this.lastCompletionKey(userId));
    if (!value) return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async setLastCompletionTimestamp(
    userId: string,
    timestamp: number
  ): Promise<void> {
    await this.redis
      .multi()
      .set(this.lastCompletionKey(userId), timestamp.toString())
      .del(TIMER_IDLE_SCHEDULE_READY_KEY)
      .incr(TIMER_IDLE_SCHEDULE_GENERATION_KEY)
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
    await this.notifyTimerScheduleWake();
  }

  async clearLastCompletionTimestamp(userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.lastCompletionKey(userId), this.idleSchedulePayloadKey(userId))
      .zrem(TIMER_IDLE_SCHEDULE_KEY, this.idleScheduleMember(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
    await this.notifyTimerScheduleWake();
  }

  async isIdleDetected(userId: string): Promise<boolean> {
    const value = await this.redis.get(this.idleDetectedKey(userId));
    return Boolean(value);
  }

  async setIdleDetected(userId: string): Promise<void> {
    await this.redis
      .multi()
      .set(this.idleDetectedKey(userId), 'true')
      .del(this.idleSchedulePayloadKey(userId))
      .zrem(TIMER_IDLE_SCHEDULE_KEY, this.idleScheduleMember(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
    await this.notifyTimerScheduleWake();
  }

  async clearIdleDetected(userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.idleDetectedKey(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async getUndoState(userId: string): Promise<TimerUndoState | null> {
    const undoStr = await this.redis.get(this.undoStateKey(userId));
    if (!undoStr) return null;
    return JSON.parse(undoStr) as TimerUndoState;
  }

  async setUndoState(
    userId: string,
    state: TimerUndoState,
    ttlMs: number
  ): Promise<void> {
    await this.redis
      .multi()
      .set(this.undoStateKey(userId), JSON.stringify(state), 'PX', ttlMs)
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async clearUndoState(userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.undoStateKey(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async pushUndoHistory(
    userId: string,
    entry: TimerHistoryEntry
  ): Promise<void> {
    await this.redis
      .multi()
      .rpush(this.undoHistoryKey(userId), JSON.stringify(entry))
      .del(this.redoHistoryKey(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async peekUndoHistoryCandidate(
    userId: string
  ): Promise<TimerHistoryCandidate | null> {
    const serializedEntry = await this.redis.lindex(
      this.undoHistoryKey(userId),
      -1
    );
    return serializedEntry
      ? {
          entry: JSON.parse(serializedEntry) as TimerHistoryEntry,
          serializedEntry,
        }
      : null;
  }

  async peekRedoHistoryCandidate(
    userId: string
  ): Promise<TimerHistoryCandidate | null> {
    const serializedEntry = await this.redis.lindex(
      this.redoHistoryKey(userId),
      -1
    );
    return serializedEntry
      ? {
          entry: JSON.parse(serializedEntry) as TimerHistoryEntry,
          serializedEntry,
        }
      : null;
  }

  async clearTimerHistory(userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.undoHistoryKey(userId), this.redoHistoryKey(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async getTimerHistoryStatus(
    userId: string
  ): Promise<{ canUndo: boolean; canRedo: boolean }> {
    const [undoCount, redoCount] = await Promise.all([
      this.redis.llen(this.undoHistoryKey(userId)),
      this.redis.llen(this.redoHistoryKey(userId)),
    ]);
    return {
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
    };
  }

  async getExtensionState(userId: string): Promise<TimerExtensionState | null> {
    const stateStr = await this.redis.get(this.extensionStateKey(userId));
    if (!stateStr) return null;
    return JSON.parse(stateStr) as TimerExtensionState;
  }

  async setExtensionState(
    userId: string,
    state: TimerExtensionState
  ): Promise<void> {
    await this.redis
      .multi()
      .set(this.extensionStateKey(userId), JSON.stringify(state))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  async clearExtensionState(userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.extensionStateKey(userId))
      .set(this.runtimeRevisionKey(userId), randomUUID())
      .exec();
  }

  private userIdFromCompletionScheduleMember(member: string): string | null {
    const prefix = 'completion:';
    if (!member.startsWith(prefix)) return null;
    const userId = member.slice(prefix.length);
    return userId.length > 0 ? userId : null;
  }

  private userIdFromIdleScheduleMember(member: string): string | null {
    const prefix = 'idle:';
    if (!member.startsWith(prefix)) return null;
    const userId = member.slice(prefix.length);
    return userId.length > 0 ? userId : null;
  }

  private userIdFromCurrentTimerKey(key: string): string | null {
    const prefix = 'user:';
    const suffix = ':current_timer';
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
    const userId = key.slice(prefix.length, -suffix.length);
    return userId.length > 0 ? userId : null;
  }

  private userIdFromLastCompletionKey(key: string): string | null {
    const prefix = 'user:';
    const suffix = ':last_timer_completion';
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
    const userId = key.slice(prefix.length, -suffix.length);
    return userId.length > 0 ? userId : null;
  }

  private requireSchedulerLease(leaseMs: number): void {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 60_000) {
      throw new BadRequestException('Timer scheduler lease is invalid');
    }
  }

  private async compareAndExpire(
    key: string,
    claimToken: string,
    leaseMs: number
  ): Promise<boolean> {
    const renewed = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('pexpire', KEYS[1], ARGV[2])
        return 1
      `,
      1,
      key,
      claimToken,
      leaseMs
    )) as number;
    return renewed === 1;
  }

  private async compareAndDelete(
    key: string,
    claimToken: string
  ): Promise<boolean> {
    const released = (await this.redis.eval(
      `
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('del', KEYS[1])
        return 1
      `,
      1,
      key,
      claimToken
    )) as number;
    return released === 1;
  }

  private currentTimerKey(userId: string): string {
    return `user:${userId}:current_timer`;
  }

  private completionScheduleMember(userId: string): string {
    return `completion:${userId}`;
  }

  private idleScheduleMember(userId: string): string {
    return `idle:${userId}`;
  }

  private idleSchedulePayloadKey(userId: string): string {
    return `user:${userId}:idle_detection_schedule:v1`;
  }

  private runtimeRevisionKey(userId: string): string {
    return `user:${userId}:timer_runtime_revision`;
  }

  private sessionStateKey(userId: string): string {
    return `user:${userId}:session_state`;
  }

  private lastCompletionKey(userId: string): string {
    return `user:${userId}:last_timer_completion`;
  }

  private idleDetectedKey(userId: string): string {
    return `user:${userId}:idle_detected`;
  }

  private undoStateKey(userId: string): string {
    return `user:${userId}:timer_undo_state`;
  }

  private undoHistoryKey(userId: string): string {
    return `user:${userId}:timer_undo_history`;
  }

  private redoHistoryKey(userId: string): string {
    return `user:${userId}:timer_redo_history`;
  }

  private extensionStateKey(userId: string): string {
    return `user:${userId}:timer_extension_state`;
  }

  private continuationLockKey(userId: string): string {
    return `user:${userId}:timer_continuation_lock`;
  }
}

function renameExactSlugValues<T>(
  value: T,
  previousSlug: string,
  nextSlug: string
): T {
  if (typeof value === 'string') {
    return (value === previousSlug ? nextSlug : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item =>
      renameExactSlugValues(item, previousSlug, nextSlug)
    ) as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key === previousSlug ? nextSlug : key,
      renameExactSlugValues(item, previousSlug, nextSlug),
    ])
  ) as T;
}

function renameTypedStatisticSnapshots(
  statistics: TimerHistoryStatisticSnapshot[] | undefined,
  timerType: TimerTypes,
  previousSlug: string,
  nextSlug: string
) {
  return statistics?.map(snapshot => ({
    ...snapshot,
    before:
      snapshot.before?.type === timerType
        ? renameExactSlugValues(snapshot.before, previousSlug, nextSlug)
        : snapshot.before,
    after:
      snapshot.after?.type === timerType
        ? renameExactSlugValues(snapshot.after, previousSlug, nextSlug)
        : snapshot.after,
  }));
}
