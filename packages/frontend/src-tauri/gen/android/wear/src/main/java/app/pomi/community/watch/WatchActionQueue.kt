package app.pomi.community.watch

import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

data class WatchAudioChunk(val filePath: String, val mimeType: String)

/** A mutation that can be submitted through the server-owned action gateway. */
data class PendingWatchAction(
    val id: String = UUID.randomUUID().toString(),
    val kind: String,
    val action: String? = null,
    val timerType: String? = null,
    val skipLogMode: String? = null,
    val position: Int? = null,
    val taskId: String? = null,
    val assistantAudioBase64: String? = null,
    val assistantAudioMimeType: String? = null,
    val assistantAudioChunks: List<WatchAudioChunk> = emptyList(),
    val assistantPreparedChunks: Boolean = false,
    val assistantTranscript: String? = null,
    val assistantTranscriptionCostUsd: Double? = null,
    val assistantDebugLogId: String? = null,
    val intentionSlugs: List<String> = emptyList(),
    val subIntentions: Map<String, String> = emptyMap(),
    val resetOnFirstIntention: Boolean? = null,
    val accountKey: String? = null
) {
    fun withoutAssistantInput(): PendingWatchAction = copy(
        assistantAudioBase64 = null,
        assistantAudioMimeType = null,
        assistantAudioChunks = emptyList(),
        assistantPreparedChunks = false,
        assistantTranscript = null,
        assistantTranscriptionCostUsd = null,
        assistantDebugLogId = null
    )

    fun publicSnapshot(): PendingWatchAction =
        if (kind == "assistantVoice") withoutAssistantInput() else this

    fun deleteAssistantChunkFiles() {
        assistantAudioChunks.forEach { java.io.File(it.filePath).delete() }
    }

    companion object {
        fun timer(action: String) = timer(action, null, null)

        fun timer(action: String, timerType: String?, skipLogMode: String?) =
            PendingWatchAction(
                kind = "timer",
                action = action,
                timerType = timerType,
                skipLogMode = skipLogMode
            )

        fun session(position: Int) = PendingWatchAction(
            kind = "session",
            position = position
        )

        fun intentions(
            action: String,
            intentionSlugs: List<String>,
            subIntentions: Map<String, String>,
            timerType: String?,
            resetOnFirstIntention: Boolean?
        ) = PendingWatchAction(
            kind = "intentions",
            action = action,
            timerType = timerType,
            intentionSlugs = intentionSlugs,
            subIntentions = subIntentions,
            resetOnFirstIntention = resetOnFirstIntention
        )

        fun completeTask(taskId: String) = PendingWatchAction(
            kind = "taskComplete",
            taskId = taskId
        )

        fun assistantVoice(audioBase64: String, mimeType: String) = PendingWatchAction(
            kind = "assistantVoice",
            assistantAudioBase64 = audioBase64,
            assistantAudioMimeType = mimeType
        )

        fun assistantVoiceChunks(chunks: List<WatchAudioChunk>) = PendingWatchAction(
            kind = "assistantVoice",
            assistantAudioChunks = chunks
        )

        fun assistantTranscript(
            transcript: String,
            transcriptionCostUsd: Double,
            debugLogId: String?
        ) = PendingWatchAction(
            kind = "assistantVoice",
            assistantTranscript = transcript,
            assistantTranscriptionCostUsd = transcriptionCostUsd,
            assistantDebugLogId = debugLogId
        )
    }
}

data class WatchQueueState(
    val active: PendingWatchAction? = null,
    val queued: List<PendingWatchAction> = emptyList(),
    val lifecycle: WatchActionLifecycle? = null,
    val assistantLifecycle: WatchActionLifecycle? = null,
    val assistantFinalizationPending: Boolean = false,
    val assistantResultUnconsumed: Boolean = false,
    val startedAtMs: Long? = null,
    val networkStartedAtMs: Long? = null,
    val networkBlocked: Boolean = false,
    val authRequired: Boolean = false,
    val terminalError: String? = null,
    val confirmedStatus: WatchStatus? = null
) {
    val count: Int
        get() = (if (active == null) 0 else 1) + queued.size

    val isBusy: Boolean
        get() = count > 0
}

/**
 * One FIFO processor for the whole Wear process.
 *
 * The queue deliberately lives only in memory. It never projects state locally and never
 * persists an unsent action. The gateway owns acceptance, ordering, retries, and terminal state;
 * this coordinator waits for terminal state, fetches confirmed status, then starts the next item.
 */
object WatchActionCoordinator {
    private val lock = Any()
    private val listeners = CopyOnWriteArraySet<(WatchQueueState) -> Unit>()
    private val worker = Executors.newSingleThreadExecutor()
    private val finalizationWorker = Executors.newSingleThreadExecutor()
    private val retryScheduler: ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor()
    private val queue = ArrayDeque<PendingWatchAction>()

    private var apiClient: WatchApiClient? = null
    private var active: PendingWatchAction? = null
    private var lifecycle: WatchActionLifecycle? = null
    private var assistantPhase: WatchAssistantPhase? = null
    private var assistantLifecycle: WatchActionLifecycle? = null
    private var assistantFinalizationPending = false
    private var assistantResultUnconsumed = false
    private var assistantAccountKey: String? = null
    private var operationGeneration = 0L
    private var credentialGeneration = 0L
    private var startedAtMs: Long? = null
    private var networkStartedAtMs: Long? = null
    private var networkBlocked = false
    private var authRequired = false
    private var terminalError: String? = null
    private var processing = false
    private var retryScheduled = false
    private var lastConfirmedStatus: WatchStatus? = null

    fun configure(client: WatchApiClient) {
        val shouldRetry = synchronized(lock) {
            apiClient = client
            (networkBlocked || (active == null && queue.isNotEmpty())) && !processing
        }
        if (shouldRetry) retryAfterReconnect()
    }

    /** Invalidate every operation before session credentials are replaced. */
    fun beginAccountChange() {
        synchronized(lock) {
            credentialGeneration += 1
            operationGeneration += 1
            active?.deleteAssistantChunkFiles()
            queue.forEach(PendingWatchAction::deleteAssistantChunkFiles)
            queue.clear()
            active = null
            lifecycle = null
            assistantPhase = null
            assistantLifecycle = null
            assistantFinalizationPending = false
            assistantResultUnconsumed = false
            assistantAccountKey = null
            startedAtMs = null
            networkStartedAtMs = null
            networkBlocked = false
            authRequired = false
            processing = false
        }
        publish()
    }

    /** Clear the auth gate after LoginActivity has stored a fresh session. */
    fun markAuthenticated() {
        val shouldRetry = synchronized(lock) {
            credentialGeneration += 1
            discardActionsForAccountChangeLocked(apiClient?.accountKey)
            authRequired = false
            if (active != null) {
                networkBlocked = true
                if (networkStartedAtMs == null) networkStartedAtMs = System.currentTimeMillis()
            }
            (networkBlocked || (active == null && queue.isNotEmpty())) && !processing
        }
        if (shouldRetry) retryAfterReconnect()
        publish()
    }

    private fun discardActionsForAccountChangeLocked(currentAccountKey: String?) {
        val activeAccountChanged =
            active != null && active?.accountKey != currentAccountKey
        val queuedBefore = queue.size
        queue.filter { it.accountKey != currentAccountKey }
            .forEach(PendingWatchAction::deleteAssistantChunkFiles)
        queue.removeAll { it.accountKey != currentAccountKey }
        if (assistantLifecycle != null && assistantAccountKey != currentAccountKey) {
            assistantLifecycle = null
            assistantFinalizationPending = false
            assistantResultUnconsumed = false
            assistantAccountKey = null
        }
        if (activeAccountChanged) {
            active?.deleteAssistantChunkFiles()
            operationGeneration += 1
            active = null
            lifecycle = null
            assistantPhase = null
            startedAtMs = null
            networkStartedAtMs = null
            networkBlocked = false
        }
        if (activeAccountChanged || queue.size != queuedBefore) {
            lastConfirmedStatus = null
            terminalError = WatchQueueMessages.ACCOUNT_CHANGED
        }
    }

    fun addListener(listener: (WatchQueueState) -> Unit): () -> Unit {
        listeners += listener
        listener(snapshot())
        return { listeners -= listener }
    }

    fun snapshot(): WatchQueueState = synchronized(lock) {
        WatchQueueState(
            active = active?.publicSnapshot(),
            queued = queue.map(PendingWatchAction::publicSnapshot),
            lifecycle = lifecycle,
            assistantLifecycle = assistantLifecycle,
            assistantFinalizationPending = assistantFinalizationPending,
            assistantResultUnconsumed = assistantResultUnconsumed,
            startedAtMs = startedAtMs,
            networkStartedAtMs = networkStartedAtMs,
            networkBlocked = networkBlocked,
            authRequired = authRequired,
            terminalError = terminalError,
            confirmedStatus = lastConfirmedStatus
        )
    }

    fun referencedAssistantChunkPaths(): Set<String> = synchronized(lock) {
        buildSet {
            active?.assistantAudioChunks?.forEach { add(it.filePath) }
            queue.forEach { action ->
                action.assistantAudioChunks.forEach { add(it.filePath) }
            }
        }
    }

    fun enqueue(action: PendingWatchAction) {
        synchronized(lock) {
            queue.addLast(
                action.copy(accountKey = action.accountKey ?: apiClient?.accountKey)
            )
            terminalError = null
            if (!processing && !networkBlocked && !authRequired) {
                processing = true
                worker.execute { processLoop() }
            }
            if (networkBlocked) scheduleRetryLocked()
        }
        publish()
    }

    /** Remove only actions that have not become the gateway's active action. */
    fun clearQueuedActions() {
        synchronized(lock) {
            queue.forEach(PendingWatchAction::deleteAssistantChunkFiles)
            queue.clear()
        }
        publish()
    }

    fun cancelPreparingAssistant(actionId: String?) {
        if (actionId == null) return
        val cancelled = synchronized(lock) {
            queue.filter { it.id == actionId && it.kind == "assistantVoice" }
                .forEach(PendingWatchAction::deleteAssistantChunkFiles)
            val removedQueued = queue.removeAll {
                it.id == actionId && it.kind == "assistantVoice"
            }
            if (
                active?.id != actionId ||
                assistantPhase != WatchAssistantPhase.PREPARING
            ) {
                removedQueued
            } else {
                active?.deleteAssistantChunkFiles()
                operationGeneration += 1
                active = null
                lifecycle = null
                assistantPhase = null
                startedAtMs = null
                networkStartedAtMs = null
                networkBlocked = false
                true
            }
        }
        if (cancelled) publish()
    }

    fun consumeAssistantResult(actionId: String) {
        val consumed = synchronized(lock) {
            if (
                assistantLifecycle?.id != actionId ||
                assistantFinalizationPending ||
                !assistantResultUnconsumed
            ) {
                false
            } else {
                assistantResultUnconsumed = false
                true
            }
        }
        if (consumed) publish()
    }

    private fun processLoop() {
        while (true) {
            var action = synchronized(lock) {
                if (active == null) {
                    active = queue.removeFirstOrNull()
                    active?.also {
                        lifecycle = null
                        assistantPhase = if (it.kind == "assistantVoice") {
                            WatchAssistantPhase.PREPARING
                        } else {
                            null
                        }
                        startedAtMs = System.currentTimeMillis()
                    }
                }
                active
            } ?: break
            publish()

            val client = synchronized(lock) { apiClient }
            if (client == null) {
                markNetworkBlocked()
                break
            }
            val operationVersion = synchronized(lock) { operationGeneration }
            val credentialVersion = synchronized(lock) { credentialGeneration }

            try {
                if (synchronized(lock) { assistantPhase } == WatchAssistantPhase.PREPARING) {
                    val preparationAction = if (action.assistantAudioChunks.isNotEmpty()) {
                        client.transcribeVoiceChunks(action) {
                            ensureCurrent(action, operationVersion)
                        }
                    } else {
                        action
                    }
                    client.prepareVoiceCommand(preparationAction)
                    ensureCurrent(action, operationVersion)
                    action.deleteAssistantChunkFiles()
                    action = preparationAction.withoutAssistantInput()
                    synchronized(lock) {
                        active = action
                        assistantPhase = WatchAssistantPhase.COMMITTING
                        networkBlocked = false
                        networkStartedAtMs = null
                    }
                    publish()
                }

                var status = synchronized(lock) { lifecycle }
                if (status == null) {
                    // Only a fresh queue head is submitted here. If the response is lost,
                    // reconnect reconciliation queries this ID and never blindly sends the
                    // mutation again.
                    status = client.submitUserAction(action)
                    ensureCurrent(action, operationVersion)
                    synchronized(lock) {
                        lifecycle = status
                        networkBlocked = false
                        networkStartedAtMs = null
                    }
                    publish()
                }

                // A receipt can be returned before the worker starts. Long-poll until the
                // gateway reports a terminal state. A reconnect only re-submits after a 404
                // status lookup, using the same idempotency key.
                var currentStatus = requireNotNull(status)
                while (!currentStatus.isTerminal) {
                    currentStatus = fetchActionStatusOrResubmit(
                        action,
                        client,
                        operationVersion
                    )
                    synchronized(lock) {
                        lifecycle = currentStatus
                        networkBlocked = false
                        networkStartedAtMs = null
                    }
                    publish()
                }

                if (synchronized(lock) { assistantPhase } == WatchAssistantPhase.COMMITTING) {
                    val shouldFinalize = currentStatus.status.lowercase() in
                        setOf("succeeded", "success", "completed")
                    replaceAssistantLifecycle(action, currentStatus, shouldFinalize)
                    if (shouldFinalize) scheduleAssistantFinalization(action, currentStatus)
                }

                if (!completeActive(client, currentStatus)) break
            } catch (error: Exception) {
                if (error is StaleWatchOperationException) continue
                when (classifyWatchFailure(error)) {
                    WatchFailureKind.AUTH -> {
                        if (credentialVersion != synchronized(lock) { credentialGeneration }) {
                            continue
                        }
                        markAuthRequired(error.message)
                        break
                    }
                    WatchFailureKind.TERMINAL -> {
                        action.deleteAssistantChunkFiles()
                        val failed = WatchActionLifecycle(action.id, "failed", error.message)
                        if (action.kind == "assistantVoice") {
                            replaceAssistantLifecycle(action, failed, false)
                        }
                        synchronized(lock) {
                            if (action.kind == "assistantVoice") {
                                active = action.withoutAssistantInput()
                            }
                            lifecycle = failed
                            assistantPhase = null
                        }
                        if (!completeActive(client, failed)) break
                        continue
                    }
                    WatchFailureKind.TRANSIENT -> {
                        // Keep the active ID and lifecycle. Reconnection first asks the
                        // gateway for its status, so an accepted/running mutation cannot be
                        // executed twice.
                        markNetworkBlocked()
                        break
                    }
                }
            }
        }
        synchronized(lock) { processing = false }
        // An enqueue can race with the final state publication. Start another loop if needed.
        synchronized(lock) {
            if (active == null && queue.isNotEmpty() && !processing && !networkBlocked && !authRequired) {
                processing = true
                worker.execute { processLoop() }
            }
        }
    }

    fun retryAfterReconnect() {
        synchronized(lock) {
            if (authRequired || processing) return
            if (!networkBlocked && active == null && queue.isEmpty()) return
            processing = true
            if (active != null || queue.isNotEmpty()) {
                worker.execute { processLoop() }
            } else {
                worker.execute { probeNetwork() }
            }
        }
        if (snapshot().networkBlocked) publish()
    }

    /**
     * A request can time out after the client sent it but before the gateway persisted its
     * receipt. In that window the status endpoint returns 404 even though the mutation was
     * never accepted. Re-submit the same idempotency key instead of silently failing the
     * action. If the gateway did persist it, the same key returns its existing lifecycle.
     */
    private fun fetchActionStatusOrResubmit(
        action: PendingWatchAction,
        client: WatchApiClient,
        operationVersion: Long
    ): WatchActionLifecycle {
        return try {
            client.getUserActionStatus(action.id, waitMs = STATUS_WAIT_MS).also {
                ensureCurrent(action, operationVersion)
            }
        } catch (error: WatchApiException) {
            if (error.code != 404) throw error
            val receipt = client.submitUserAction(action)
            ensureCurrent(action, operationVersion)
            synchronized(lock) {
                lifecycle = receipt
                networkBlocked = false
                networkStartedAtMs = null
            }
            publish()
            receipt
        }
    }

    /** Report a failed background/status request without dropping the last confirmed state. */
    fun reportNetworkFailure(error: Exception? = null) {
        when (error?.let(::classifyWatchFailure)) {
            WatchFailureKind.AUTH -> markAuthRequired(error.message)
            WatchFailureKind.TERMINAL -> markTerminalError(error.message)
            WatchFailureKind.TRANSIENT, null -> markNetworkBlocked()
        }
    }

    fun reportNetworkSuccess(status: WatchStatus? = null) {
        synchronized(lock) {
            networkBlocked = false
            networkStartedAtMs = null
            terminalError = null
            if (status != null) lastConfirmedStatus = status
        }
        publish()
        synchronized(lock) {
            if (!processing && !authRequired && (active != null || queue.isNotEmpty())) {
                processing = true
                worker.execute {
                    processLoop()
                }
            }
        }
    }

    private fun probeNetwork() {
        val client = synchronized(lock) { apiClient }
        if (client == null) {
            synchronized(lock) { processing = false }
            markNetworkBlocked()
            return
        }
        try {
            val status = client.getStatus(
                taskMode = "intention",
                limit = CONFIRMED_STATUS_LIMIT,
                readTimeoutMs = STATUS_READ_TIMEOUT_MS,
                connectTimeoutMs = STATUS_CONNECT_TIMEOUT_MS
            )
            synchronized(lock) {
                processing = false
                networkBlocked = false
                networkStartedAtMs = null
                terminalError = null
                lastConfirmedStatus = status
            }
            publish()
            synchronized(lock) {
                if (!processing && queue.isNotEmpty() && !authRequired) {
                    processing = true
                    worker.execute { processLoop() }
                }
            }
        } catch (error: Exception) {
            synchronized(lock) { processing = false }
            when (classifyWatchFailure(error)) {
                WatchFailureKind.AUTH -> markAuthRequired(error.message)
                WatchFailureKind.TERMINAL -> markTerminalError(error.message)
                WatchFailureKind.TRANSIENT -> markNetworkBlocked()
            }
        }
    }

    private fun completeActive(
        client: WatchApiClient,
        terminal: WatchActionLifecycle
    ): Boolean {
        val confirmed = try {
            client.getStatus(
                taskMode = "intention",
                limit = CONFIRMED_STATUS_LIMIT,
                readTimeoutMs = STATUS_READ_TIMEOUT_MS,
                connectTimeoutMs = STATUS_CONNECT_TIMEOUT_MS
            )
        } catch (error: Exception) {
            when (classifyWatchFailure(error)) {
                WatchFailureKind.AUTH -> markAuthRequired(error.message)
                WatchFailureKind.TERMINAL -> {
                    // The gateway already reached a terminal lifecycle. If the follow-up
                    // status read is rejected, clear this action without replaying it and
                    // retain the last confirmed snapshot.
                    finishActiveWithoutRefresh(terminal, error.message)
                    return true
                }
                WatchFailureKind.TRANSIENT -> markNetworkBlocked()
            }
            return false
        }
        synchronized(lock) {
            lastConfirmedStatus = confirmed
            lifecycle = terminal
            active = null
            assistantPhase = null
            startedAtMs = null
            networkStartedAtMs = null
            networkBlocked = false
            terminalError = if (terminal.status == "failed") terminal.message else null
        }
        publish()
        return true
    }

    private fun finishActiveWithoutRefresh(
        terminal: WatchActionLifecycle,
        message: String?
    ) {
        synchronized(lock) {
            lastConfirmedStatus = null
            lifecycle = terminal.copy(message = message ?: terminal.message)
            active = null
            assistantPhase = null
            startedAtMs = null
            networkStartedAtMs = null
            networkBlocked = false
            terminalError = message
        }
        publish()
    }

    private fun markNetworkBlocked() {
        synchronized(lock) {
            networkBlocked = true
            authRequired = false
            if (networkStartedAtMs == null) networkStartedAtMs = System.currentTimeMillis()
            scheduleRetryLocked()
        }
        publish()
        synchronized(lock) { processing = false }
    }

    private fun markAuthRequired(message: String?) {
        synchronized(lock) {
            queue.filter { it.kind == "assistantVoice" }
                .forEach(PendingWatchAction::deleteAssistantChunkFiles)
            queue.removeAll { it.kind == "assistantVoice" }
            if (assistantPhase == WatchAssistantPhase.PREPARING) {
                active?.deleteAssistantChunkFiles()
                operationGeneration += 1
                active = null
                lifecycle = null
                assistantPhase = null
                startedAtMs = null
                networkStartedAtMs = null
            }
            authRequired = true
            networkBlocked = false
            terminalError = message
            processing = false
        }
        publish()
    }

    private fun markTerminalError(message: String?) {
        synchronized(lock) {
            terminalError = message
            networkBlocked = false
            processing = false
        }
        publish()
    }

    private fun ensureCurrent(action: PendingWatchAction, generation: Long) {
        val current = synchronized(lock) {
            operationGeneration == generation &&
                active?.id == action.id &&
                active?.accountKey == action.accountKey
        }
        if (!current) throw StaleWatchOperationException()
    }

    private fun replaceAssistantLifecycle(
        action: PendingWatchAction,
        terminal: WatchActionLifecycle,
        finalizationPending: Boolean
    ) {
        val superseded = synchronized(lock) {
            if (
                assistantFinalizationPending &&
                assistantLifecycle?.id != terminal.id
            ) {
                assistantFinalizationPending = false
                true
            } else {
                false
            }
        }
        if (superseded) publish()
        synchronized(lock) {
            assistantPhase = null
            assistantLifecycle = terminal
            assistantFinalizationPending = finalizationPending
            assistantResultUnconsumed = true
            assistantAccountKey = action.accountKey
        }
        publish()
    }

    private fun scheduleAssistantFinalization(
        action: PendingWatchAction,
        committed: WatchActionLifecycle
    ) {
        finalizationWorker.execute {
            var retryDelayMs = 500L
            while (true) {
                val state = synchronized(lock) {
                    Triple(apiClient, credentialGeneration, authRequired)
                }
                val current = synchronized(lock) {
                    assistantFinalizationPending &&
                        assistantLifecycle?.id == committed.id &&
                        assistantAccountKey == action.accountKey &&
                        apiClient?.accountKey == action.accountKey
                }
                if (!current) return@execute
                if (state.third || state.first == null) {
                    Thread.sleep(retryDelayMs)
                    retryDelayMs = (retryDelayMs * 2).coerceAtMost(5_000L)
                    continue
                }
                try {
                    val result = requireNotNull(state.first)
                        .finalizeVoiceCommand(committed.id)
                        .toJSONObject()
                    val updated = synchronized(lock) {
                        if (
                            assistantFinalizationPending &&
                            assistantLifecycle?.id == committed.id &&
                            assistantAccountKey == action.accountKey &&
                            apiClient?.accountKey == action.accountKey &&
                            credentialGeneration == state.second
                        ) {
                            assistantLifecycle = committed.copy(result = result)
                            assistantFinalizationPending = false
                            true
                        } else {
                            false
                        }
                    }
                    if (updated) {
                        publish()
                        return@execute
                    }
                } catch (error: Exception) {
                    when (classifyWatchFailure(error)) {
                        WatchFailureKind.TERMINAL -> {
                            val updated = synchronized(lock) {
                                if (
                                    assistantFinalizationPending &&
                                    assistantLifecycle?.id == committed.id &&
                                    assistantAccountKey == action.accountKey &&
                                    credentialGeneration == state.second
                                ) {
                                    assistantFinalizationPending = false
                                    true
                                } else {
                                    false
                                }
                            }
                            if (updated) publish()
                            return@execute
                        }
                        WatchFailureKind.AUTH -> {
                            if (state.second == synchronized(lock) { credentialGeneration }) {
                                markAuthRequired(error.message)
                            }
                        }
                        WatchFailureKind.TRANSIENT -> Unit
                    }
                    Thread.sleep(retryDelayMs)
                    retryDelayMs = (retryDelayMs * 2).coerceAtMost(5_000L)
                }
            }
        }
    }

    private fun scheduleRetryLocked() {
        if (retryScheduled || authRequired) return
        retryScheduled = true
        retryScheduler.schedule(
            {
                synchronized(lock) { retryScheduled = false }
                retryAfterReconnect()
            },
            RETRY_DELAY_MS,
            TimeUnit.MILLISECONDS
        )
    }

    private fun publish() {
        val value = snapshot()
        listeners.forEach { listener ->
            try {
                listener(value)
            } catch (_: Exception) {
                // A screen may be in the middle of teardown; listeners are best effort.
            }
        }
        synchronized(lock) {
            // Confirmed status is an edge-triggered publication. The cache remains available
            // through WatchSessionStore for screens created after this callback.
            lastConfirmedStatus = null
        }
    }

    private const val STATUS_WAIT_MS = 25_000
    private const val STATUS_READ_TIMEOUT_MS = 30_000
    private const val STATUS_CONNECT_TIMEOUT_MS = 5_000
    private const val CONFIRMED_STATUS_LIMIT = 12
    private const val RETRY_DELAY_MS = 2_000L
}

enum class WatchAssistantPhase {
    PREPARING,
    COMMITTING
}

private class StaleWatchOperationException : Exception()

enum class WatchFailureKind {
    AUTH,
    TRANSIENT,
    TERMINAL
}

fun classifyWatchFailure(error: Exception): WatchFailureKind {
    if (error !is WatchApiException) return WatchFailureKind.TRANSIENT
    return when {
        error.code == 401 -> WatchFailureKind.AUTH
        error.code == 408 || error.code == 425 || error.code == 429 -> WatchFailureKind.TRANSIENT
        error.code in 500..599 -> WatchFailureKind.TRANSIENT
        else -> WatchFailureKind.TERMINAL
    }
}
