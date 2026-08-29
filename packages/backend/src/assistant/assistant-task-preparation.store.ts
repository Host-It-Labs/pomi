import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  AssistantDebugModelCall,
  AssistantDebugTimings,
  AssistantVoiceCommandResult,
} from '@pomi/shared';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type {
  AssistantPreparedInterpretation,
  AssistantTaskDefaults,
  ParsedTaskDraft,
} from './assistant-input-types';

const PREPARATION_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_MS = 5 * 60 * 1000;
const LOCK_WAIT_MS = LOCK_TTL_MS + 30_000;
const LOCK_POLL_MS = 100;
const MAX_COMMIT_BYTES = 32 * 1024 * 1024;
const MAX_DEBUG_BYTES = 64 * 1024 * 1024;

export type PreparedAssistantTaskCapture = {
  normalizedText: string;
  /** Selected List context carried from preparation into the confirmed commit. */
  listId?: string | null;
  /** Detected source language for localized assistant confirmations. */
  responseLanguage?: string;
  debugLogId: string | null;
  taskDrafts: ParsedTaskDraft[];
  usedFallback: boolean;
  invalidParserOutput: string | null;
  interpretationError: string | null;
  resolutionNotes: string[];
  modelCalls: AssistantDebugModelCall[];
  timings: AssistantDebugTimings;
  preparationMs: number;
  costUsd: number;
};

export type PreparedAssistantVoiceCapture = {
  transcript: string;
  debugLogId: string | null;
  interpretation: AssistantPreparedInterpretation;
  transcriptionCostUsd: number;
  transcriptionModelCalls: AssistantDebugModelCall[];
  timings: AssistantDebugTimings;
  preparationMs: number;
};

export type PreparedVoiceChunkTranscription = {
  transcript: string;
  costUsd: number;
  debugLogId: string | null;
  modelCall?: AssistantDebugModelCall;
};

export type AssistantVoiceChunkManifest = {
  chunks: Array<{ audioSha256: string; mimeType: string }>;
  transcriptionModel: string;
};

export type AssistantVoiceCommitResult = Omit<
  AssistantVoiceCommandResult,
  'spokenAudioBase64' | 'spokenAudioMimeType'
> & {
  spokenAudioBase64: null;
  spokenAudioMimeType: null;
};

export type CommittedAssistantVoiceCapture = {
  version: 1;
  result: AssistantVoiceCommitResult;
  debugLogId: string | null;
  speechModel: string | null;
  speechVoice: string | null;
};

export type AssistantTaskPreparationInput = {
  text: string;
  listId?: string | null;
  defaults?: AssistantTaskDefaults;
  debugLogId?: string | null;
};

export type AssistantVoicePreparationInput =
  | {
      kind: 'audio';
      audioSha256: string;
      mimeType: string;
      debugLogId?: string | null;
    }
  | {
      kind: 'transcript';
      transcript: string;
      transcriptionCostUsd?: number;
      debugLogId?: string | null;
    };

type TaskCommitPreparation = Pick<
  PreparedAssistantTaskCapture,
  'taskDrafts' | 'listId' | 'usedFallback' | 'preparationMs' | 'costUsd'
>;
type TaskDebugPreparation = Omit<
  PreparedAssistantTaskCapture,
  keyof TaskCommitPreparation
>;

type VoiceInterpretationCommit = Omit<
  AssistantPreparedInterpretation,
  'modelCalls' | 'timings'
>;
type VoiceCommitPreparation = Pick<
  PreparedAssistantVoiceCapture,
  'transcript' | 'transcriptionCostUsd' | 'preparationMs'
> & { interpretation: VoiceInterpretationCommit };
type VoiceDebugPreparation = Pick<
  PreparedAssistantVoiceCapture,
  'debugLogId' | 'transcriptionModelCalls' | 'timings'
> & {
  interpretationModelCalls: AssistantDebugModelCall[];
  interpretationTimings: AssistantPreparedInterpretation['timings'];
};

type PreparationKind = 'task' | 'voice' | 'voice-chunk';
type PreparationEnvelope<T> = { inputHash: string; prepared: T };
type VersionedVoicePreparationEnvelope<T> = PreparationEnvelope<T> & {
  version: 1;
  kind: 'voice';
};
type PreparationCodec<TPrepared, TCommit, TDebug> = {
  kind: PreparationKind;
  split: (prepared: TPrepared) => { commit: TCommit; debug: TDebug };
  merge: (commit: TCommit, debug: TDebug) => TPrepared;
};

const TASK_CODEC: PreparationCodec<
  PreparedAssistantTaskCapture,
  TaskCommitPreparation,
  TaskDebugPreparation
> = {
  kind: 'task',
  split: prepared => {
    const {
      taskDrafts,
      listId,
      usedFallback,
      preparationMs,
      costUsd,
      ...debug
    } = prepared;
    return {
      commit: {
        taskDrafts,
        ...(listId !== undefined ? { listId } : {}),
        usedFallback,
        preparationMs,
        costUsd,
      },
      debug,
    };
  },
  merge: (commit, debug) => ({ ...commit, ...debug }),
};

const VOICE_CODEC: PreparationCodec<
  PreparedAssistantVoiceCapture,
  VoiceCommitPreparation,
  VoiceDebugPreparation
> = {
  kind: 'voice',
  split: prepared => {
    const {
      modelCalls,
      timings: interpretationTimings,
      ...interpretation
    } = prepared.interpretation;
    return {
      commit: {
        transcript: prepared.transcript,
        transcriptionCostUsd: prepared.transcriptionCostUsd,
        preparationMs: prepared.preparationMs,
        interpretation,
      },
      debug: {
        debugLogId: prepared.debugLogId,
        transcriptionModelCalls: sanitizeModelCalls(
          prepared.transcriptionModelCalls
        ),
        timings: prepared.timings,
        interpretationModelCalls: sanitizeModelCalls(modelCalls),
        interpretationTimings,
      },
    };
  },
  merge: (commit, debug) => ({
    transcript: commit.transcript,
    debugLogId: debug.debugLogId,
    interpretation: {
      ...commit.interpretation,
      modelCalls: debug.interpretationModelCalls,
      timings: debug.interpretationTimings,
    },
    transcriptionCostUsd: commit.transcriptionCostUsd,
    transcriptionModelCalls: debug.transcriptionModelCalls,
    timings: debug.timings,
    preparationMs: commit.preparationMs,
  }),
};

const VOICE_CHUNK_CODEC: PreparationCodec<
  PreparedVoiceChunkTranscription,
  Omit<PreparedVoiceChunkTranscription, 'modelCall'>,
  Pick<PreparedVoiceChunkTranscription, 'modelCall'>
> = {
  kind: 'voice-chunk',
  split: prepared => ({
    commit: {
      transcript: prepared.transcript,
      costUsd: prepared.costUsd,
      debugLogId: prepared.debugLogId,
    },
    debug: {
      modelCall: prepared.modelCall
        ? sanitizeModelCalls([prepared.modelCall])[0]
        : undefined,
    },
  }),
  merge: (commit, debug) => ({ ...commit, ...debug }),
};

function sanitizeModelCalls(
  calls: AssistantDebugModelCall[]
): AssistantDebugModelCall[] {
  return calls.map(call => ({
    provider: call.provider,
    endpoint: call.endpoint,
    stage: call.stage,
    request: { redacted: true },
    attempts: call.attempts.map(attempt => ({
      request: { redacted: true },
      status: attempt.status,
      error: attempt.error ? 'Provider request failed' : null,
    })),
    content: null,
    costUsd: call.costUsd,
    durationMs: call.durationMs,
  }));
}

@Injectable()
export class AssistantPreparationStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  getOrCreateTask(
    userId: string,
    preparationId: string,
    input: AssistantTaskPreparationInput,
    create: () => Promise<PreparedAssistantTaskCapture>
  ): Promise<PreparedAssistantTaskCapture> {
    return this.getOrCreatePrepared(
      userId,
      preparationId,
      input,
      create,
      TASK_CODEC
    );
  }

  getOrCreateVoice(
    userId: string,
    preparationId: string,
    input: AssistantVoicePreparationInput,
    create: () => Promise<PreparedAssistantVoiceCapture>
  ): Promise<PreparedAssistantVoiceCapture> {
    return this.getOrCreatePrepared(
      userId,
      preparationId,
      input,
      create,
      VOICE_CODEC
    );
  }

  getOrCreateVoiceChunk(
    userId: string,
    preparationId: string,
    index: number,
    input: {
      audioSha256: string;
      mimeType: string;
      transcriptionModel: string | null;
      debugLogId?: string | null;
    },
    create: () => Promise<PreparedVoiceChunkTranscription>
  ): Promise<PreparedVoiceChunkTranscription> {
    return this.getOrCreatePrepared(
      userId,
      `${preparationId}:${index}`,
      input,
      create,
      VOICE_CHUNK_CODEC
    );
  }

  async registerVoiceChunkManifest(
    userId: string,
    preparationId: string,
    manifest: AssistantVoiceChunkManifest
  ): Promise<AssistantVoiceChunkManifest> {
    const serialized = this.serializeBounded(
      manifest,
      MAX_COMMIT_BYTES,
      'Assistant voice chunk manifest is too large'
    );
    const key = this.voiceChunkManifestKey(userId, preparationId);
    const stored = await this.redis.set(
      key,
      serialized,
      'EX',
      PREPARATION_TTL_SECONDS,
      'NX'
    );
    if (stored === 'OK') return manifest;
    const existing = await this.getVoiceChunkManifest(userId, preparationId);
    if (
      !existing ||
      JSON.stringify(existing.chunks) !== JSON.stringify(manifest.chunks)
    ) {
      throw new ConflictException(
        'Assistant voice preparation ID was already used for different chunks'
      );
    }
    return existing;
  }

  async getVoiceChunkManifest(
    userId: string,
    preparationId: string
  ): Promise<AssistantVoiceChunkManifest | null> {
    const raw = await this.redis.get(
      this.voiceChunkManifestKey(userId, preparationId)
    );
    if (!raw) return null;
    const manifest = this.parseRecord<AssistantVoiceChunkManifest>(
      raw,
      'Assistant voice chunk manifest is corrupt'
    );
    if (!Array.isArray(manifest.chunks) || !manifest.transcriptionModel) {
      throw new ServiceUnavailableException(
        'Assistant voice chunk manifest has an unsupported format'
      );
    }
    return manifest;
  }

  async requireVoiceChunkManifest(
    userId: string,
    preparationId: string
  ): Promise<AssistantVoiceChunkManifest> {
    const manifest = await this.getVoiceChunkManifest(userId, preparationId);
    if (!manifest) {
      throw new NotFoundException('Assistant voice chunk manifest not found');
    }
    return manifest;
  }

  requireVoiceChunk(
    userId: string,
    preparationId: string,
    index: number
  ): Promise<PreparedVoiceChunkTranscription> {
    return this.requirePrepared(
      userId,
      `${preparationId}:${index}`,
      VOICE_CHUNK_CODEC
    );
  }

  requireTask(
    userId: string,
    preparationId: string
  ): Promise<PreparedAssistantTaskCapture> {
    return this.requirePrepared(userId, preparationId, TASK_CODEC);
  }

  requireVoice(
    userId: string,
    preparationId: string
  ): Promise<PreparedAssistantVoiceCapture> {
    return this.requirePrepared(userId, preparationId, VOICE_CODEC);
  }

  async putVoiceCommitResult(
    userId: string,
    preparationId: string,
    committed: CommittedAssistantVoiceCapture
  ): Promise<CommittedAssistantVoiceCapture> {
    const serialized = this.serializeBounded(
      committed,
      MAX_COMMIT_BYTES,
      'Assistant voice commit result is too large to cache safely'
    );
    const key = this.voiceCommitKey(userId, preparationId);
    const stored = await this.redis.eval(
      `local current = redis.call('get', KEYS[1]); if not current then redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]); return 1 end; if current == ARGV[1] then return 0 end; return -1`,
      1,
      key,
      serialized,
      PREPARATION_TTL_SECONDS
    );
    if (stored === -1) {
      throw new ConflictException(
        'Assistant voice preparation was already committed with a different result'
      );
    }
    return committed;
  }

  async requireVoiceCommitResult(
    userId: string,
    preparationId: string
  ): Promise<CommittedAssistantVoiceCapture> {
    const committed = await this.getVoiceCommitResult(userId, preparationId);
    if (!committed) {
      throw new NotFoundException('Assistant voice commit result not found');
    }
    return committed;
  }

  async getVoiceCommitResult(
    userId: string,
    preparationId: string
  ): Promise<CommittedAssistantVoiceCapture | null> {
    const raw = await this.redis.get(
      this.voiceCommitKey(userId, preparationId)
    );
    if (!raw) return null;
    const committed = this.parseRecord<CommittedAssistantVoiceCapture>(
      raw,
      'Assistant voice commit result is corrupt'
    );
    if (committed.version !== 1 || !this.isRecord(committed.result)) {
      throw new ServiceUnavailableException(
        'Assistant voice commit result has an unsupported format'
      );
    }
    return committed;
  }

  private async getOrCreatePrepared<TPrepared, TCommit, TDebug>(
    userId: string,
    preparationId: string,
    input: unknown,
    create: () => Promise<TPrepared>,
    codec: PreparationCodec<TPrepared, TCommit, TDebug>
  ): Promise<TPrepared> {
    const inputHash = this.hashInput(input);
    const cached = await this.readPrepared(userId, preparationId, codec);
    if (cached !== null) return this.verifyInput(cached, inputHash, codec.kind);

    const lockKey = this.lockKey(codec.kind, userId, preparationId);
    const lockToken = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const acquired =
        (await this.redis.set(lockKey, lockToken, 'PX', LOCK_TTL_MS, 'NX')) ===
        'OK';
      if (acquired) {
        const heartbeat = setInterval(
          () => {
            void this.renewLock(lockKey, lockToken).catch(() => undefined);
          },
          Math.floor(LOCK_TTL_MS / 3)
        );
        try {
          const doubleChecked = await this.readPrepared(
            userId,
            preparationId,
            codec
          );
          if (doubleChecked !== null) {
            return this.verifyInput(doubleChecked, inputHash, codec.kind);
          }
          const prepared = await create();
          const { commit, debug } = codec.split(prepared);
          const serializedCommit = JSON.stringify(
            codec.kind === 'voice'
              ? { version: 1, kind: 'voice', inputHash, prepared: commit }
              : { inputHash, prepared: commit }
          );
          const serializedDebug = JSON.stringify(debug);
          if (Buffer.byteLength(serializedCommit) > MAX_COMMIT_BYTES) {
            throw new ServiceUnavailableException(
              `Assistant ${codec.kind} preparation is too large to cache safely`
            );
          }
          if (Buffer.byteLength(serializedDebug) > MAX_DEBUG_BYTES) {
            throw new ServiceUnavailableException(
              `Assistant ${codec.kind} debug trace is too large to cache safely`
            );
          }
          const stored = await this.redis.eval(
            `if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[4]); redis.call('set', KEYS[3], ARGV[3], 'EX', ARGV[4]); return 1 end return 0`,
            3,
            lockKey,
            this.resultKey(codec.kind, userId, preparationId),
            this.debugKey(codec.kind, userId, preparationId),
            lockToken,
            serializedCommit,
            serializedDebug,
            PREPARATION_TTL_SECONDS
          );
          if (stored !== 1) {
            throw new ServiceUnavailableException(
              `Assistant ${codec.kind} preparation ownership was lost`
            );
          }
          return codec.merge(commit, debug);
        } finally {
          clearInterval(heartbeat);
          await this.releaseLock(lockKey, lockToken).catch(() => undefined);
        }
      }

      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException(
          `Assistant ${codec.kind} preparation is still running`
        );
      }
      await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS));
      const completed = await this.readPrepared(userId, preparationId, codec);
      if (completed !== null) {
        return this.verifyInput(completed, inputHash, codec.kind);
      }
    }
  }

  private async requirePrepared<TPrepared, TCommit, TDebug>(
    userId: string,
    preparationId: string,
    codec: PreparationCodec<TPrepared, TCommit, TDebug>
  ): Promise<TPrepared> {
    const prepared = await this.readPrepared(userId, preparationId, codec);
    if (prepared === null) {
      throw new NotFoundException(
        `Assistant ${codec.kind} preparation not found`
      );
    }
    return prepared.prepared;
  }

  private async readPrepared<TPrepared, TCommit, TDebug>(
    userId: string,
    preparationId: string,
    codec: PreparationCodec<TPrepared, TCommit, TDebug>
  ): Promise<{ inputHash: string; prepared: TPrepared } | null> {
    const [rawCommit, rawDebug] = await Promise.all([
      this.redis.get(this.resultKey(codec.kind, userId, preparationId)),
      this.redis.get(this.debugKey(codec.kind, userId, preparationId)),
    ]);
    if (!rawCommit || !rawDebug) return null;
    const envelope = this.parseEnvelope<TCommit>(rawCommit, codec.kind);
    const debug = this.parseDebug<TDebug>(rawDebug, codec.kind);
    return {
      inputHash: envelope.inputHash,
      prepared: codec.merge(envelope.prepared, debug),
    };
  }

  private verifyInput<TPrepared>(
    envelope: { inputHash: string; prepared: TPrepared },
    inputHash: string,
    kind: PreparationKind
  ): TPrepared {
    if (envelope.inputHash !== inputHash) {
      throw new ConflictException(
        `Assistant ${kind} preparation ID was already used for different input`
      );
    }
    return envelope.prepared;
  }

  private parseEnvelope<TCommit>(
    raw: string,
    kind: PreparationKind
  ): PreparationEnvelope<TCommit> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException(
        `Assistant ${kind} preparation is corrupt`
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new ServiceUnavailableException(
        `Assistant ${kind} preparation is corrupt`
      );
    }
    const envelope = parsed as Partial<
      VersionedVoicePreparationEnvelope<TCommit>
    >;
    if (
      typeof envelope.inputHash !== 'string' ||
      !this.isRecord(envelope.prepared) ||
      (kind === 'voice' &&
        (envelope.version !== 1 || envelope.kind !== 'voice'))
    ) {
      throw new ServiceUnavailableException(
        `Assistant ${kind} preparation has an unsupported format`
      );
    }
    return {
      inputHash: envelope.inputHash,
      prepared: envelope.prepared as TCommit,
    };
  }

  private parseDebug<TDebug>(raw: string, kind: PreparationKind): TDebug {
    try {
      const parsed = JSON.parse(raw);
      if (!this.isRecord(parsed)) throw new Error('invalid');
      return parsed as TDebug;
    } catch {
      throw new ServiceUnavailableException(
        `Assistant ${kind} preparation debug trace is corrupt`
      );
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private hashInput(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private serializeBounded(
    value: unknown,
    maxBytes: number,
    message: string
  ): string {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > maxBytes) {
      throw new ServiceUnavailableException(message);
    }
    return serialized;
  }

  private parseRecord<T>(raw: string, message: string): T {
    try {
      const parsed = JSON.parse(raw);
      if (!this.isRecord(parsed)) throw new Error('invalid');
      return parsed as T;
    } catch {
      throw new ServiceUnavailableException(message);
    }
  }

  private renewLock(key: string, token: string): Promise<unknown> {
    return this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0`,
      1,
      key,
      token,
      LOCK_TTL_MS
    );
  }

  private releaseLock(key: string, token: string): Promise<unknown> {
    return this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`,
      1,
      key,
      token
    );
  }

  private resultKey(
    kind: PreparationKind,
    userId: string,
    preparationId: string
  ): string {
    return `pomi:assistant-${kind}-preparation:{${userId}}:${preparationId}`;
  }

  private lockKey(
    kind: PreparationKind,
    userId: string,
    preparationId: string
  ): string {
    return `pomi:assistant-${kind}-preparation-lock:{${userId}}:${preparationId}`;
  }

  private debugKey(
    kind: PreparationKind,
    userId: string,
    preparationId: string
  ): string {
    return `pomi:assistant-${kind}-preparation-debug:{${userId}}:${preparationId}`;
  }

  private voiceCommitKey(userId: string, preparationId: string): string {
    return `pomi:assistant-voice-commit:{${userId}}:${preparationId}`;
  }

  private voiceChunkManifestKey(userId: string, preparationId: string): string {
    return `pomi:assistant-voice-chunk-manifest:{${userId}}:${preparationId}`;
  }
}
