package app.pomi.community.watch

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.wear.tiles.TileService
import java.util.concurrent.Executors

class WatchFaceActivity : WatchActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var sessionStore: WatchSessionStore
    private lateinit var apiClient: WatchApiClient
    private lateinit var remainingText: TextView
    private lateinit var statusText: TextView
    private lateinit var timerButton: ImageButton
    private lateinit var assistantButton: ImageButton
    private lateinit var tasksButton: ImageButton
    private lateinit var intentionsButton: TextView
    private lateinit var addFiveButton: TextView
    private lateinit var longBreakButton: ImageButton
    private lateinit var resetButton: ImageButton
    private lateinit var skipButton: ImageButton
    private lateinit var sessionsRow: LinearLayout
    private lateinit var intentionsRow: LinearLayout
    private lateinit var timerRing: TimerRingView
    private lateinit var controlRail: FrameLayout
    private lateinit var queueIndicator: FrameLayout
    private lateinit var queueBadge: TextView
    private var currentStatus: WatchStatus? = null
    private var localTimer: WatchTimer? = null
    private var localTimerSyncedAtElapsedMs = 0L
    private var localTickerRunning = false
    private var isLoading = false
    private var isRefreshing = false
    private var hasFailure = false
    private var isResumed = false
    private val statusRequestGate = WatchStatusRequestGate()
    private val intentionsNavigationClickGate = WatchNavigationClickGate(duplicateWindowMs = 500L)
    private var removeQueueListener: (() -> Unit)? = null

    private val localTicker = object : Runnable {
        override fun run() {
            updateLocalTimer()
            if (localTickerRunning) {
                mainHandler.postDelayed(this, 1000)
            }
        }
    }

    private val passiveRefresh = object : Runnable {
        override fun run() {
            if (!isResumed) return
            refreshStatus()
            mainHandler.postDelayed(this, STATUS_RECONCILE_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionStore = WatchSessionStore(this)
        apiClient = WatchApiClient(sessionStore)
        WatchActionCoordinator.configure(apiClient)
        if (!ensureSession()) return
        buildView()
        sessionStore.cachedStatus?.let { cached ->
            currentStatus = cached.status
            renderStatus(cached.status, cached.savedAtMs)
        }
        removeQueueListener = WatchActionCoordinator.addListener { state ->
            runOnUiThread { renderQueueState(state) }
        }
    }

    override fun onResume() {
        super.onResume()
        isResumed = true
        if (!sessionStore.isReady) {
            openLogin()
            return
        }
        WatchActionCoordinator.retryAfterReconnect()
        refreshStatus(force = true)
        mainHandler.removeCallbacks(passiveRefresh)
        mainHandler.postDelayed(passiveRefresh, STATUS_RECONCILE_MS)
    }

    override fun onPause() {
        isResumed = false
        stopLocalTicker()
        mainHandler.removeCallbacks(passiveRefresh)
        super.onPause()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (sessionStore.isReady) refreshStatus()
    }

    override fun onDestroy() {
        stopLocalTicker()
        mainHandler.removeCallbacks(passiveRefresh)
        removeQueueListener?.invoke()
        worker.shutdown()
        super.onDestroy()
    }

    private fun ensureSession(): Boolean {
        if (sessionStore.isReady) return true
        openLogin()
        return false
    }

    private fun buildView() {
        val root = watchRoot()

        sessionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        root.addView(sessionsRow, FrameLayout.LayoutParams(dp(118), dp(20), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
            topMargin = dp(24)
        })

        statusText = TextView(this).apply {
            text = ""
            watchText(9f, WatchColors.Muted)
            maxLines = 1
            visibleWhen(false)
        }
        root.addView(statusText, FrameLayout.LayoutParams(dp(116), dp(16), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
            topMargin = dp(48)
        })

        timerRing = TimerRingView(this)
        root.addView(timerRing, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        ))

        tasksButton = plainIconButton(R.drawable.ic_watch_tasks, getString(R.string.tasks)).apply {
            setOnClickListener { startActivity(Intent(this@WatchFaceActivity, TasksActivity::class.java)) }
        }
        root.addView(tasksButton, FrameLayout.LayoutParams(dp(WatchHomePresentation.TOP_ACTION_SIZE_DP), dp(WatchHomePresentation.TOP_ACTION_SIZE_DP), Gravity.START or Gravity.TOP).apply {
            leftMargin = dp(40)
            topMargin = dp(64)
        })

        assistantButton = plainIconButton(R.drawable.ic_watch_mic, getString(R.string.assistant)).apply {
            setOnClickListener {
                val intent = Intent(this@WatchFaceActivity, AssistantActivity::class.java)
                    .putExtra(AssistantActivity.EXTRA_AUTO_START, true)
                startActivity(intent)
            }
        }
        root.addView(assistantButton, FrameLayout.LayoutParams(dp(WatchHomePresentation.TOP_ACTION_SIZE_DP), dp(WatchHomePresentation.TOP_ACTION_SIZE_DP), Gravity.END or Gravity.TOP).apply {
            rightMargin = dp(40)
            topMargin = dp(64)
        })

        queueIndicator = FrameLayout(this).apply {
            contentDescription = getString(R.string.pending_actions)
            visibleWhen(false)
        }
        queueIndicator.addView(ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(WatchColors.White)
        }, FrameLayout.LayoutParams(dp(WatchQueuePresentation.SPINNER_SIZE_DP), dp(WatchQueuePresentation.SPINNER_SIZE_DP), Gravity.CENTER))
        queueBadge = TextView(this).apply {
            watchText(8f, WatchColors.Background, Typeface.BOLD)
            gravity = Gravity.CENTER
            background = roundedBackground(WatchColors.Icon, dp(7).toFloat())
            visibleWhen(false)
        }
        queueIndicator.addView(queueBadge, FrameLayout.LayoutParams(dp(14), dp(14), Gravity.TOP or Gravity.END))
        root.addView(queueIndicator, FrameLayout.LayoutParams(dp(WatchHomePresentation.TOP_ACTION_SIZE_DP), dp(WatchHomePresentation.TOP_ACTION_SIZE_DP), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
            topMargin = dp(64)
        })

        intentionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            contentDescription = getString(R.string.intentions)
            isClickable = true
            isFocusable = true
            setOnClickListener { openIntentionsPicker(startOnSelect = true) }
        }
        root.addView(intentionsRow, FrameLayout.LayoutParams(dp(WatchHomePresentation.INTENTIONS_WIDTH_DP), dp(WatchHomePresentation.INTENTIONS_HEIGHT_DP), Gravity.CENTER).apply {
            bottomMargin = dp(58)
        })

        intentionsButton = textActionButton("○", WatchColors.Icon, 20f).apply {
            contentDescription = getString(R.string.intentions)
            setOnClickListener { openIntentionsPicker(startOnSelect = true) }
        }
        intentionsRow.addView(intentionsButton, LinearLayout.LayoutParams(dp(32), dp(32)))

        remainingText = TextView(this).apply {
            text = "00:00"
            watchText(WatchHomePresentation.TIMER_TEXT_SIZE_SP.toFloat(), WatchColors.Work, Typeface.BOLD)
            maxLines = 1
        }
        root.addView(remainingText, FrameLayout.LayoutParams(dp(150), dp(46), Gravity.CENTER).apply {
            bottomMargin = dp(1)
        })

        controlRail = FrameLayout(this).apply {
            clipChildren = false
            clipToPadding = false
        }
        root.addView(controlRail, FrameLayout.LayoutParams(dp(WatchControlPresentation.CONTROL_RAIL_WIDTH_DP), dp(WatchControlPresentation.FOUR_CONTROL_RAIL_HEIGHT_DP), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = dp(6)
        })

        longBreakButton = plainIconButton(R.drawable.ic_watch_coffee, getString(R.string.start_long_break), WatchColors.White).apply {
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            val iconPadding = (WatchControlPresentation.MIN_TOUCH_SIZE_DP - WatchControlPresentation.LONG_BREAK_ICON_SIZE_DP) / 2
            setPadding(dp(iconPadding), dp(iconPadding), dp(iconPadding), dp(iconPadding))
            setOnClickListener { submitLongBreakAction() }
        }
        controlRail.addView(longBreakButton)

        addFiveButton = textActionButton("+5", WatchColors.Icon, 12f).apply {
            setOnClickListener {
                submitControlAction("addFiveMinutes", currentStatus?.timer?.type ?: "work")
            }
        }
        controlRail.addView(addFiveButton)

        timerButton = circleIconButton(R.drawable.ic_watch_play, WatchColors.Work, getString(R.string.start_timer)).apply {
            setOnClickListener { submitTimerAction() }
        }
        controlRail.addView(timerButton)

        resetButton = plainIconButton(R.drawable.ic_watch_reset, getString(R.string.reset)).apply {
            setOnClickListener {
                submitControlAction("reset", currentStatus?.timer?.type ?: "work")
            }
        }
        controlRail.addView(resetButton)

        skipButton = plainIconButton(R.drawable.ic_watch_skip, getString(R.string.skip)).apply {
            setOnClickListener { submitSkip() }
        }
        controlRail.addView(skipButton)

        setContentView(root)
    }

    private fun positionControl(button: View, position: WatchControlPosition) {
        button.layoutParams = FrameLayout.LayoutParams(dp(position.sizeDp), dp(position.sizeDp)).apply {
            leftMargin = dp(position.leftDp)
            topMargin = dp(position.topDp)
        }
    }

    private fun refreshStatus(force: Boolean = false) {
        if (isRefreshing && !force) return
        val generation = statusRequestGate.beginRequest()
        isRefreshing = true
        if (currentStatus == null) setLoading(true, getString(R.string.syncing))
        worker.execute {
            try {
                val status = apiClient.getStatus(taskMode = "intention", limit = 12)
                runOnUiThread {
                    if (!statusRequestGate.accepts(generation)) return@runOnUiThread
                    isRefreshing = false
                    currentStatus = status
                    renderStatus(status, System.currentTimeMillis())
                    WatchActionCoordinator.reportNetworkSuccess(status)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (!statusRequestGate.accepts(generation)) return@runOnUiThread
                    isRefreshing = false
                    handleError(error)
                }
            }
        }
    }

    private fun renderStatus(status: WatchStatus, receivedAtWallMs: Long) {
        hasFailure = false
        val timer = status.timer?.let {
            it.copy(
                remainingTime = WatchTimerProjection.remainingAt(
                    status,
                    receivedAtWallMs,
                    System.currentTimeMillis()
                )
            )
        }
        localTimer = timer
        localTimerSyncedAtElapsedMs = SystemClock.elapsedRealtime()

        if (timer == null) {
            stopLocalTicker()
            renderTimerSnapshot(null, 0L)
        } else {
            renderTimerSnapshot(timer, timer.remainingTime)
            if (timer.status == "running") startLocalTicker() else stopLocalTicker()
        }

        renderControls(status)
        renderSessions(status)
        setLoading(false, "")
        TileService.getUpdater(this).requestUpdate(PomiTileService::class.java)
    }

    private fun renderControls(status: WatchStatus) {
        assistantButton.isEnabled = status.assistant.canRecord
        assistantButton.alpha = if (status.assistant.canRecord) 1f else 0.45f
        intentionsRow.isEnabled = true
        intentionsButton.isEnabled = true
        intentionsButton.alpha =
            if (status.timerControls.canStartOrResume || status.timerControls.requiresIntentionSelection) 1f else 0.65f
        renderTimerButton(status)
        renderControlButton(addFiveButton, status.timerControls.canAddFiveMinutes)
        renderControlButton(resetButton, status.timerControls.canReset)
        renderControlButton(skipButton, status.timerControls.canSkip)
        longBreakButton.visibleWhen(status.timerControls.canStartLongBreak)
        renderControlButton(longBreakButton, status.timerControls.canStartLongBreak)
        val railHeight = WatchControlPresentation.railHeight(
            status.timerControls.canStartLongBreak
        )
        (controlRail.layoutParams as FrameLayout.LayoutParams).let { params ->
            val height = dp(railHeight)
            if (params.height != height) {
                params.height = height
                controlRail.layoutParams = params
            }
        }
        val positions = WatchControlPresentation.positions(
            status.timerControls.canStartLongBreak
        )
        val controlViews = mapOf(
            WatchControl.LONG_BREAK to longBreakButton,
            WatchControl.ADD_FIVE to addFiveButton,
            WatchControl.PLAY_PAUSE to timerButton,
            WatchControl.RESET to resetButton,
            WatchControl.SKIP to skipButton
        )
        WatchControlPresentation.order(status.timerControls.canStartLongBreak).forEach { control ->
            positionControl(controlViews.getValue(control), positions.getValue(control))
        }
    }

    private fun renderTimerSnapshot(timer: WatchTimer?, remainingTime: Long) {
        val accent = if (isLoading) WatchColors.Muted else timerAccentColor(timer?.type)
        remainingText.setTextColor(accent)
        remainingText.text = if (timer == null) "00:00" else formatTimerMillis(remainingTime)
        timerRing.accentColor = accent
        timerRing.active = WatchRingPresentation.isActive(
            timer,
            isInitialLoading = isLoading,
            hasFailure = hasFailure
        )
        timerRing.progress = WatchRingPresentation.progress(timer, remainingTime)
        renderSelectedIntentions(timer)
        if (!isLoading) {
            currentStatus?.let { renderTimerButton(it) }
        }
    }

    private fun renderSelectedIntentions(timer: WatchTimer?) {
        intentionsRow.removeAllViews()
        val display = WatchHomePresentation.intentionDisplay(timer?.intentions.orEmpty())
        intentionsRow.visibleWhen(true)

        if (display.visible.isEmpty()) {
            renderIntentionButton(null)
            intentionsRow.addView(intentionsButton, LinearLayout.LayoutParams(dp(32), dp(32)))
        } else {
            display.visible.forEach { intention ->
                intentionsRow.addView(intentionEmojiPair(intention), LinearLayout.LayoutParams(dp(WatchHomePresentation.INTENTION_PAIR_SIZE_DP), dp(WatchHomePresentation.INTENTION_PAIR_SIZE_DP)).apply {
                    rightMargin = dp(WatchHomePresentation.INTENTION_PAIR_SPACING_DP)
                })
            }
            if (display.overflowCount > 0) {
                intentionsRow.addView(TextView(this).apply {
                    text = "+${display.overflowCount}"
                    watchText(10f, WatchColors.Icon, Typeface.BOLD)
                }, LinearLayout.LayoutParams(dp(25), dp(24)))
            }
        }
    }

    private fun renderIntentionButton(intention: WatchIntention?) {
        val emoji = intention?.subEmoji ?: intention?.emoji
        if (emoji.isNullOrBlank()) {
            intentionsButton.text = "○"
            intentionsButton.textSize = WatchHomePresentation.EMPTY_INTENTION_TEXT_SIZE_SP.toFloat()
            intentionsButton.setTextColor(WatchColors.Icon)
            return
        }

        intentionsButton.text = emoji
        intentionsButton.textSize = 15f
        intentionsButton.setTextColor(WatchColors.Text)
    }

    private fun intentionEmojiPair(intention: WatchIntention): FrameLayout {
        return FrameLayout(this).apply {
            val parent = intention.emoji ?: intention.subEmoji ?: ""
            addView(TextView(this@WatchFaceActivity).apply {
                text = parent
                watchText(16f, WatchColors.Text)
            }, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))

            if (!intention.subEmoji.isNullOrBlank() && intention.emoji != null) {
                addView(TextView(this@WatchFaceActivity).apply {
                    text = intention.subEmoji
                    watchText(8f, WatchColors.Text, Typeface.BOLD)
                    background = roundedBackground(WatchColors.Background, dp(7).toFloat())
                }, FrameLayout.LayoutParams(dp(14), dp(14), Gravity.TOP or Gravity.END))
            }
        }
    }

    private fun renderSessions(status: WatchStatus) {
        sessionsRow.removeAllViews()
        val timer = status.timer
        val position = timer?.sessionPosition
        val total = timer?.sessionTotal
        if (
            !status.timerControls.sessionsEnabled ||
            timer?.type != "work" ||
            position == null ||
            total == null ||
            total <= 0
        ) {
            sessionsRow.visibleWhen(false)
            return
        }

        sessionsRow.visibleWhen(true)
        val count = total.coerceAtMost(10)
        for (itemPosition in 1..count) {
            sessionsRow.addView(sessionDot(itemPosition, position, timer), LinearLayout.LayoutParams(dp(18), dp(18)))
        }
    }

    private fun sessionDot(position: Int, currentPosition: Int, timer: WatchTimer): FrameLayout {
        val active = position == currentPosition
        val completed = position < currentPosition
        val stacked = active && (timer.stackedSessions ?: 1) > 1
        val color = when {
            stacked -> WatchColors.SessionStack
            active -> WatchColors.Work
            completed -> Color.rgb(129, 140, 248)
            else -> WatchColors.SurfaceStrong
        }
        val dotSize = if (active) dp(10) else dp(7)

        return FrameLayout(this).apply {
            isClickable = !active && !timer.isExtension
            isFocusable = !active && !timer.isExtension
            alpha = if (timer.isExtension && !active) 0.45f else 1f
            if (!active && !timer.isExtension) {
                setOnClickListener { submitSessionPosition(position) }
            }
            addView(View(this@WatchFaceActivity).apply {
                background = roundedBackground(color, dotSize / 2f)
            }, FrameLayout.LayoutParams(dotSize, dotSize, Gravity.CENTER))
        }
    }

    private fun renderControlButton(button: View, enabled: Boolean) {
        button.isEnabled = enabled
        button.alpha = if (enabled) 1f else 0.35f
    }

    private fun renderQueueState(state: WatchQueueState) {
        val show = WatchQueuePresentation.shouldShowLoader(
            state.startedAtMs,
            state.networkStartedAtMs,
            System.currentTimeMillis()
        )
        queueIndicator.visibleWhen(show)
        queueBadge.visibleWhen(show && state.count > 1)
        queueBadge.text = state.count.toString()
        queueIndicator.contentDescription = if (state.authRequired) {
            getString(R.string.login_required)
        } else if (state.networkBlocked) {
            getString(R.string.reconnecting)
        } else {
            resources.getQuantityString(R.plurals.syncing_actions, state.count, state.count)
        }
        if (state.authRequired) {
            if (sessionStore.isReady && !isFinishing && !isDestroyed) {
                sessionStore.clear()
                openLogin()
            }
            return
        }
        if (state.networkBlocked) {
            disableControlsForFailure()
            statusText.visibleWhen(show)
            if (show) {
                statusText.text = getString(R.string.reconnecting)
                statusText.setTextColor(WatchColors.Muted)
            }
        } else if (!isLoading && !hasFailure) {
            currentStatus?.let { renderControls(it) }
            if (show) {
                statusText.visibleWhen(true)
                statusText.text = getString(R.string.syncing)
                statusText.setTextColor(WatchColors.Muted)
            } else if ((state.lifecycle?.status?.lowercase() == "failed" || state.terminalError != null) && state.count == 0) {
                statusText.visibleWhen(true)
                statusText.text = localizedWatchMessage(state.terminalError) ?: getString(R.string.sync_failed)
                statusText.setTextColor(WatchColors.Error)
            } else if (state.count == 0) {
                statusText.visibleWhen(false)
            }
        }
        state.confirmedStatus?.let { status ->
            currentStatus = status
            renderStatus(status, System.currentTimeMillis())
        }
        if ((state.isBusy || state.networkBlocked) && !show) {
            mainHandler.postDelayed({ renderQueueState(WatchActionCoordinator.snapshot()) }, WatchQueuePresentation.LOADER_DELAY_MS)
        }
        TileService.getUpdater(this).requestUpdate(PomiTileService::class.java)
    }

    private fun renderTimerButton(status: WatchStatus) {
        val accent = timerAccentColor(status.timer?.type)
        val canChooseIntention = status.timerControls.requiresIntentionSelection
        timerButton.background = roundedBackground(
            if (status.timerControls.canStartOrResume || status.timerControls.canPause || canChooseIntention) accent else WatchColors.SurfaceStrong,
            dp(26).toFloat()
        )
        when {
            status.timerControls.canPause -> {
                timerButton.setImageResource(R.drawable.ic_watch_pause)
                timerButton.contentDescription = getString(R.string.pause_timer)
                timerButton.isEnabled = true
                timerButton.alpha = 1f
            }
            status.timerControls.canStartOrResume || canChooseIntention -> {
                timerButton.setImageResource(R.drawable.ic_watch_play)
                timerButton.contentDescription = if (canChooseIntention) getString(R.string.choose_intention) else getString(R.string.start_timer)
                timerButton.isEnabled = true
                timerButton.alpha = 1f
            }
            else -> {
                timerButton.setImageResource(R.drawable.ic_watch_circle)
                timerButton.contentDescription = getString(R.string.timer_unavailable)
                timerButton.isEnabled = false
                timerButton.alpha = 0.45f
            }
        }
        timerButton.setColorFilter(WatchColors.Text)
    }

    private fun updateLocalTimer() {
        val timer = localTimer ?: return
        if (timer.status != "running") return
        val elapsedSinceSync = SystemClock.elapsedRealtime() - localTimerSyncedAtElapsedMs
        if (
            elapsedSinceSync > STATUS_RECONCILE_MS &&
            isResumed &&
            !isLoading &&
            !isRefreshing
        ) {
            refreshStatus()
        }
        val remaining = (timer.remainingTime - elapsedSinceSync).coerceAtLeast(0L)
        renderTimerSnapshot(timer, remaining)
        if (remaining == 0L) {
            stopLocalTicker()
            refreshStatus()
        }
    }

    private fun startLocalTicker() {
        localTickerRunning = true
        mainHandler.removeCallbacks(localTicker)
        mainHandler.postDelayed(localTicker, 1000)
    }

    private fun stopLocalTicker() {
        localTickerRunning = false
        mainHandler.removeCallbacks(localTicker)
    }

    private fun submitTimerAction() {
        val status = currentStatus ?: return
        if (status.timerControls.requiresIntentionSelection) {
            openIntentionsPicker(startOnSelect = true)
            return
        }
        if (!status.timerControls.canPause && !status.timerControls.canStartOrResume) return
        submitControlAction(
            if (status.timerControls.canPause) "pause" else "startOrResume",
            status.timer?.type ?: "work"
        )
    }

    private fun submitControlAction(
        action: String,
        timerType: String,
        skipLogMode: String? = null
    ) {
        enqueueAction(PendingWatchAction.timer(action, timerType, skipLogMode))
    }

    private fun submitLongBreakAction() {
        enqueueAction(PendingWatchAction.timer("startOrResume", "longBreak", null))
    }

    private fun enqueueAction(action: PendingWatchAction) {
        WatchActionCoordinator.enqueue(action)
        statusText.visibleWhen(false)
    }

    private fun submitSessionPosition(position: Int) {
        enqueueAction(PendingWatchAction.session(position))
    }

    private fun submitSkip() {
        val status = currentStatus ?: return
        if (!status.timerControls.canSkip) return
        if (status.timerControls.advancedSkip) {
            startActivityForResult(Intent(this, SkipActivity::class.java), ADVANCED_SKIP_REQUEST)
            return
        }
        submitControlAction("skip", status.timer?.type ?: "work", "none")
    }

    private fun setLoading(loading: Boolean, message: String) {
        isLoading = loading
        statusText.visibleWhen(message.isNotBlank())
        statusText.text = message
        statusText.setTextColor(WatchColors.Muted)
        val enabled = !loading
        listOf<View>(
            timerButton,
            addFiveButton,
            resetButton,
            skipButton,
            longBreakButton,
            tasksButton,
            assistantButton
        ).forEach {
            it.isEnabled = enabled
        }
        listOf<View>(
            sessionsRow,
            timerRing,
            tasksButton,
            assistantButton,
            intentionsRow,
            remainingText,
            controlRail
        ).forEach {
            it.alpha = if (loading) 0.48f else 1f
        }
        localTimer?.let { renderTimerSnapshot(it, currentRemainingTime(it)) }
        if (!loading) {
            currentStatus?.let { renderControls(it) }
        }
    }

    private fun currentRemainingTime(timer: WatchTimer): Long {
        if (timer.status != "running") return timer.remainingTime
        val elapsed = SystemClock.elapsedRealtime() - localTimerSyncedAtElapsedMs
        return (timer.remainingTime - elapsed).coerceAtLeast(0L)
    }

    private fun disableControlsForFailure() {
        listOf<View>(timerButton, addFiveButton, resetButton, skipButton, longBreakButton).forEach {
            it.isEnabled = false
            it.alpha = 0.5f
        }
    }

    private fun openIntentionsPicker(startOnSelect: Boolean) {
        if (!intentionsNavigationClickGate.accept(SystemClock.elapsedRealtime())) return
        if (!sessionStore.isReady) {
            openLogin()
            return
        }
        val intent = Intent(this, IntentionsActivity::class.java)
            .putExtra(IntentionsActivity.EXTRA_START_ON_SELECT, startOnSelect)
        startActivity(intent)
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != ADVANCED_SKIP_REQUEST || resultCode != RESULT_OK) return
        sessionStore.cachedStatus?.let { cached ->
            currentStatus = cached.status
            renderStatus(cached.status, cached.savedAtMs)
        }
        refreshStatus(force = true)
    }

    private fun handleError(error: Exception) {
        when (classifyWatchFailure(error)) {
            WatchFailureKind.AUTH -> {
                WatchActionCoordinator.reportNetworkFailure(error)
            }
            WatchFailureKind.TRANSIENT -> {
                // Keep the last confirmed snapshot visible while the coordinator probes and
                // retries. Timer mutations are disabled by renderQueueState; navigation and
                // Assistant stay usable.
                WatchActionCoordinator.reportNetworkFailure(error)
                isLoading = false
                hasFailure = false
                statusText.visibleWhen(false)
                sessionStore.cachedStatus?.let { cached ->
                    currentStatus = cached.status
                    renderStatus(cached.status, cached.savedAtMs)
                }
                if (currentStatus == null) {
                    disableControlsForFailure()
                    tasksButton.isEnabled = true
                    assistantButton.isEnabled = true
                } else {
                    disableControlsForFailure()
                    tasksButton.isEnabled = true
                    assistantButton.isEnabled = true
                }
            }
            WatchFailureKind.TERMINAL -> {
                WatchActionCoordinator.reportNetworkFailure(error)
                isLoading = false
                hasFailure = true
                statusText.visibleWhen(true)
                statusText.text = localizedWatchMessage(error.message) ?: getString(R.string.sync_failed)
                statusText.setTextColor(WatchColors.Error)
                currentStatus?.let {
                    renderControls(it)
                    localTimer?.let { timer -> renderTimerSnapshot(timer, currentRemainingTime(timer)) }
                    if (it.timer?.status == "running") startLocalTicker()
                } ?: disableControlsForFailure()
            }
        }
    }

    private fun openLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    companion object {
        private const val STATUS_RECONCILE_MS = 30_000L
        private const val ADVANCED_SKIP_REQUEST = 301
    }
}
