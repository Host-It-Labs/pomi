package app.pomi.community.watch

fun watchStatus(
    serverNowMs: Long = 100_000L,
    timer: WatchTimer? = watchTimer()
) = WatchStatus(
    serverNowMs = serverNowMs,
    taskMode = "intention",
    language = "en",
    timer = timer,
    assistant = WatchAssistant(false, false, false, null, 10),
    timerControls = WatchTimerControls(
        canStartOrResume = false,
        canPause = true,
        canAddFiveMinutes = true,
        canReset = true,
        canSkip = true,
        canStartLongBreak = false,
        requiresIntentionSelection = false,
        intentionRequireSelection = true,
        intentionMultiSelect = true,
        advancedSkip = false,
        sessionsEnabled = false
    ),
    tasks = emptyList(),
    totalVisibleTasks = 0,
    totalActiveTasks = 0
)

fun watchTimer(
    status: String = "running",
    remainingTime: Long = 60_000L,
    endsAtMs: Long? = 160_000L,
    duration: Long = 60_000L
) = WatchTimer(
    id = "timer",
    type = "work",
    status = status,
    duration = duration,
    remainingTime = remainingTime,
    endsAtMs = endsAtMs,
    progress = 0f,
    intentions = emptyList(),
    sessionPosition = null,
    sessionTotal = null,
    stackedSessions = null,
    isExtension = false
)

fun watchIntention(
    slug: String,
    emoji: String? = null,
    subEmoji: String? = null
) = WatchIntention(
    slug = slug,
    title = slug,
    emoji = emoji,
    subSlug = null,
    subTitle = null,
    subEmoji = subEmoji
)
