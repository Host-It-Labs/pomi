package app.pomi.community.watch

import android.app.Activity
import android.content.Intent
import androidx.concurrent.futures.ResolvableFuture
import androidx.wear.protolayout.ActionBuilders.LoadAction
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.degrees as protoDegrees
import androidx.wear.protolayout.DimensionBuilders.dp as protoDp
import androidx.wear.protolayout.DimensionBuilders.expand as protoExpand
import androidx.wear.protolayout.DimensionBuilders.sp as protoSp
import androidx.wear.protolayout.DimensionBuilders.weight as protoWeight
import androidx.wear.protolayout.DimensionBuilders.wrap as protoWrap
import androidx.wear.protolayout.LayoutElementBuilders.ARC_ANCHOR_START
import androidx.wear.protolayout.LayoutElementBuilders.ARC_DIRECTION_CLOCKWISE
import androidx.wear.protolayout.LayoutElementBuilders.Arc
import androidx.wear.protolayout.LayoutElementBuilders.ArcLine
import androidx.wear.protolayout.LayoutElementBuilders.Box
import androidx.wear.protolayout.LayoutElementBuilders.Column
import androidx.wear.protolayout.LayoutElementBuilders.FONT_WEIGHT_BOLD
import androidx.wear.protolayout.LayoutElementBuilders.FONT_WEIGHT_NORMAL
import androidx.wear.protolayout.LayoutElementBuilders.FontStyle
import androidx.wear.protolayout.LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER
import androidx.wear.protolayout.LayoutElementBuilders.Image
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement
import androidx.wear.protolayout.LayoutElementBuilders.Row
import androidx.wear.protolayout.LayoutElementBuilders.Spacer
import androidx.wear.protolayout.LayoutElementBuilders.STROKE_CAP_ROUND
import androidx.wear.protolayout.LayoutElementBuilders.TEXT_ALIGN_CENTER
import androidx.wear.protolayout.LayoutElementBuilders.Text
import androidx.wear.protolayout.LayoutElementBuilders.VERTICAL_ALIGN_CENTER
import androidx.wear.protolayout.ModifiersBuilders.Background
import androidx.wear.protolayout.ModifiersBuilders.Clickable
import androidx.wear.protolayout.ModifiersBuilders.Corner
import androidx.wear.protolayout.ModifiersBuilders.Modifiers
import androidx.wear.protolayout.ModifiersBuilders.Padding
import androidx.wear.protolayout.ModifiersBuilders.Transformation
import androidx.wear.protolayout.ResourceBuilders.AndroidImageResourceByResId
import androidx.wear.protolayout.ResourceBuilders.ImageResource
import androidx.wear.protolayout.ResourceBuilders.Resources
import androidx.wear.protolayout.TimelineBuilders.Timeline
import androidx.wear.tiles.RequestBuilders.ResourcesRequest
import androidx.wear.tiles.RequestBuilders.TileRequest
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import androidx.wear.protolayout.TypeBuilders.StringLayoutConstraint
import androidx.wear.protolayout.TypeBuilders.StringProp
import androidx.wear.protolayout.DimensionBuilders.AngularLayoutConstraint
import androidx.wear.protolayout.LayoutElementBuilders.ANGULAR_ALIGNMENT_START
import androidx.wear.protolayout.DimensionBuilders.DegreesProp
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicInstant
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicInt32
import java.time.Instant
import java.util.concurrent.Executors

class PomiTileService : TileService() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var sessionStore: WatchSessionStore
    private lateinit var apiClient: WatchApiClient
    private var removeQueueListener: (() -> Unit)? = null

    override fun onCreate() {
        super.onCreate()
        sessionStore = WatchSessionStore(this)
        apiClient = WatchApiClient(sessionStore)
        WatchActionCoordinator.configure(apiClient)
        removeQueueListener = WatchActionCoordinator.addListener {
            TileService.getUpdater(this).requestUpdate(PomiTileService::class.java)
        }
    }

    override fun onDestroy() {
        removeQueueListener?.invoke()
        worker.shutdown()
        super.onDestroy()
    }

    override fun onTileRequest(requestParams: TileRequest): ListenableFuture<Tile> {
        val future = ResolvableFuture.create<Tile>()
        worker.execute {
            try {
                future.set(buildRequestedTile(requestParams.currentState.lastClickableId))
            } catch (error: Exception) {
                if (error is WatchApiException && error.code == 401) {
                    WatchActionCoordinator.reportNetworkFailure(error)
                    sessionStore.clear()
                    future.set(tileFrom(buildLoggedOutLayout()))
                } else {
                    WatchActionCoordinator.reportNetworkFailure(error)
                    val cached = sessionStore.cachedStatus
                    future.set(
                        tileFrom(
                            when (classifyWatchFailure(error)) {
                                WatchFailureKind.TRANSIENT -> cached?.let {
                                    buildStatusLayout(it.status, it.savedAtMs)
                                } ?: buildReconnectingLayout()
                                else -> buildErrorLayout()
                            }
                        )
                    )
                }
            }
        }
        return future
    }

    override fun onTileResourcesRequest(requestParams: ResourcesRequest): ListenableFuture<Resources> {
        return ResolvableFuture.create<Resources>().apply {
            set(
                Resources.Builder()
                    .setVersion(RESOURCES_VERSION)
                    .addTileIcon(ICON_TASKS, R.drawable.ic_watch_tasks)
                    .addTileIcon(ICON_ASSISTANT, R.drawable.ic_watch_mic)
                    .addTileIcon(ICON_PLAY, R.drawable.ic_watch_play)
                    .addTileIcon(ICON_PAUSE, R.drawable.ic_watch_pause)
                    .addTileIcon(ICON_RESET, R.drawable.ic_watch_reset)
                    .addTileIcon(ICON_SKIP, R.drawable.ic_watch_skip)
                    .addTileIcon(ICON_LONG_BREAK, R.drawable.ic_watch_coffee)
                    .addTileIcon(ICON_IDLE, R.drawable.ic_watch_circle)
                    .build()
            )
        }
    }

    private fun buildRequestedTile(clickId: String): Tile {
        if (!sessionStore.isReady) {
            if (clickId.isNotBlank()) launchActivity(LoginActivity::class.java)
            return tileFrom(buildLoggedOutLayout())
        }

        if (handleNavigationClick(clickId)) {
            val cached = sessionStore.cachedStatus
            return tileFrom(
                cached?.let {
                    buildStatusLayout(it.status, it.savedAtMs)
                }
                    ?: buildOpeningLayout()
            )
        }

        val before = loadStatus()
        handleClick(clickId, before)
        return tileFrom(buildStatusLayout(before, System.currentTimeMillis()))
    }

    private fun loadStatus(): WatchStatus {
        val status = apiClient.getStatus(
            taskMode = "intention",
            limit = 4,
            readTimeoutMs = TILE_NETWORK_TIMEOUT_MS,
            connectTimeoutMs = TILE_NETWORK_TIMEOUT_MS
        )
        WatchActionCoordinator.reportNetworkSuccess(status)
        return status
    }

    private fun handleClick(clickId: String, status: WatchStatus): Boolean {
        val queueState = WatchActionCoordinator.snapshot()
        if (queueState.networkBlocked || queueState.authRequired) return false
        when (clickId) {
            CLICK_START_PAUSE -> {
                if (status.timerControls.requiresIntentionSelection) {
                    launchActivity(IntentionsActivity::class.java) {
                        putExtra(IntentionsActivity.EXTRA_START_ON_SELECT, true)
                    }
                    return false
                }
                if (!status.timerControls.canPause && !status.timerControls.canStartOrResume) {
                    return false
                }
                enqueueTimerAction(
                    if (status.timerControls.canPause) "pause" else "startOrResume",
                    status.timer?.type ?: "work",
                    null
                )
                return true
            }
            CLICK_ADD_FIVE -> {
                if (!status.timerControls.canAddFiveMinutes) return false
                enqueueTimerAction("addFiveMinutes", status.timer?.type ?: "work", null)
                return true
            }
            CLICK_RESET -> {
                if (!status.timerControls.canReset) return false
                enqueueTimerAction("reset", status.timer?.type ?: "work", null)
                return true
            }
            CLICK_SKIP -> {
                if (!status.timerControls.canSkip) return false
                if (status.timerControls.advancedSkip) {
                    launchActivity(SkipActivity::class.java)
                    return false
                }
                enqueueTimerAction("skip", status.timer?.type ?: "work", "none")
                return true
            }
            CLICK_LONG_BREAK -> {
                if (!status.timerControls.canStartLongBreak) return false
                WatchActionCoordinator.enqueue(
                    PendingWatchAction.timer("startOrResume", "longBreak", null)
                )
                return true
            }
        }
        return false
    }

    private fun handleNavigationClick(clickId: String): Boolean {
        when (clickId) {
            CLICK_OPEN_APP -> launchActivity(WatchFaceActivity::class.java)
            CLICK_TASKS -> launchActivity(TasksActivity::class.java)
            CLICK_ASSISTANT -> launchActivity(AssistantActivity::class.java) {
                putExtra(AssistantActivity.EXTRA_AUTO_START, true)
            }
            CLICK_INTENTIONS -> launchActivity(IntentionsActivity::class.java) {
                putExtra(IntentionsActivity.EXTRA_START_ON_SELECT, true)
            }
            else -> return false
        }
        return true
    }

    private fun enqueueTimerAction(
        action: String,
        timerType: String,
        skipLogMode: String?
    ) {
        WatchActionCoordinator.enqueue(PendingWatchAction.timer(action, timerType, skipLogMode))
    }

    private fun launchActivity(
        activityClass: Class<out Activity>,
        configure: Intent.() -> Unit = {}
    ) {
        val intent = Intent(this, activityClass).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.configure()
        startActivity(intent)
    }

    private fun buildStatusLayout(status: WatchStatus, receivedAtWallMs: Long): LayoutElement {
        val timer = status.timer
        val remainingTime = WatchTimerProjection.remainingAt(
            status,
            receivedAtWallMs,
            System.currentTimeMillis()
        )
        val progress = WatchRingPresentation.progress(timer, remainingTime)
        val accent = timerAccentColor(timer?.type)
        val activeAccent = if (timer?.status == "running") accent else WatchColors.Muted
        val dynamicRemainingSeconds = WatchTimerProjection.localEndsAt(status, receivedAtWallMs)
            ?.let { localEndsAtMs ->
                val seconds = DynamicInstant.platformTimeWithSecondsPrecision()
                    .durationUntil(DynamicInstant.withSecondsPrecision(Instant.ofEpochMilli(localEndsAtMs)))
                    .toIntSeconds()
                DynamicInt32.onCondition(seconds.gte(0)).use(seconds).elseUse(0)
            }

        val root = Box.Builder()
            .setWidth(protoExpand())
            .setHeight(protoExpand())
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .setModifiers(tileModifiers(backgroundColor = WatchColors.Background))

        root.addContent(timerArc(progress, activeAccent, dynamicRemainingSeconds, timer?.duration ?: 0L))
        root.addContent(
            Column.Builder()
                .setWidth(protoExpand())
                .setHeight(protoExpand())
                .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                .setModifiers(tileModifiers(padding = 10f))
                .addContent(sessionDots(status))
                .addContent(verticalSpacer(4f))
                .addContent(topActions(status, WatchActionCoordinator.snapshot()))
                .addContent(verticalSpacer(2f))
                .addContent(intentionsRow(timer))
                .addContent(timerText(status, remainingTime, accent, dynamicRemainingSeconds))
                .addContent(verticalSpacer(6f))
                .addContent(controlRail(status, accent))
                .build()
        )

        return root.build()
    }

    private fun buildLoggedOutLayout(): LayoutElement {
        return baseMessageLayout(
            title = localizedString(R.string.tile_login),
            body = localizedString(R.string.tile_open_app),
            clickId = CLICK_OPEN_APP
        )
    }

    private fun buildErrorLayout(): LayoutElement {
        return baseMessageLayout(
            title = localizedString(R.string.tile_sync_failed),
            body = localizedString(R.string.tile_open_app),
            clickId = CLICK_OPEN_APP
        )
    }

    private fun buildReconnectingLayout(): LayoutElement {
        return baseMessageLayout(
            title = localizedString(R.string.tile_connecting),
            body = localizedString(R.string.tile_open_app),
            clickId = CLICK_OPEN_APP
        )
    }

    private fun buildOpeningLayout(): LayoutElement {
        return baseMessageLayout(
            title = localizedString(R.string.tile_pomi),
            body = localizedString(R.string.tile_opening),
            clickId = CLICK_OPEN_APP
        )
    }

    private fun baseMessageLayout(title: String, body: String, clickId: String): LayoutElement {
        return Box.Builder()
            .setWidth(protoExpand())
            .setHeight(protoExpand())
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .setModifiers(tileModifiers(backgroundColor = WatchColors.Background, clickId = clickId, minClickSize = 120f))
            .addContent(
                Column.Builder()
                    .setWidth(protoWrap())
                    .setHeight(protoWrap())
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .addContent(text(title, 20f, WatchColors.Text, FONT_WEIGHT_BOLD))
                    .addContent(verticalSpacer(8f))
                    .addContent(text(body, 12f, WatchColors.Icon, FONT_WEIGHT_BOLD))
                    .build()
            )
            .build()
    }

    private fun timerArc(
        progress: Float,
        accent: Int,
        dynamicRemainingSeconds: DynamicInt32?,
        durationMs: Long
    ): Arc {
        val length = (360f * progress).coerceIn(0f, 360f)
        val dynamicLength = dynamicRemainingSeconds
            ?.asFloat()
            ?.div((durationMs / 1000f).coerceAtLeast(1f))
            ?.times(360f)
        return Arc.Builder()
            .setAnchorAngle(protoDegrees(0f))
            .setAnchorType(ARC_ANCHOR_START)
            .setArcDirection(ARC_DIRECTION_CLOCKWISE)
            .addContent(staticArcLine(360f, WatchColors.SurfaceStrong))
            .addContent(arcLine(length, accent, dynamicLength))
            .build()
    }

    private fun staticArcLine(length: Float, color: Int): ArcLine {
        return arcLine(length, color, null)
    }

    private fun arcLine(
        length: Float,
        color: Int,
        dynamicLength: androidx.wear.protolayout.expression.DynamicBuilders.DynamicFloat?
    ): ArcLine {
        val lengthProp = DegreesProp.Builder(length)
        if (dynamicLength != null) {
            lengthProp.setDynamicValue(dynamicLength)
        }
        val builder = ArcLine.Builder()
            .setLength(lengthProp.build())
            .setThickness(protoDp(5f))
            .setColor(argb(color))
            .setStrokeCap(STROKE_CAP_ROUND)
        if (dynamicLength != null) {
            builder.setLayoutConstraintsForDynamicLength(
                AngularLayoutConstraint.Builder(360f)
                    .setAngularAlignment(ANGULAR_ALIGNMENT_START)
                    .build()
            )
        }
        return builder.build()
    }

    private fun sessionDots(status: WatchStatus): Row {
        val timer = status.timer
        val position = timer?.sessionPosition
        val total = timer?.sessionTotal
        val row = Row.Builder()
            .setWidth(protoWrap())
            .setHeight(protoDp(12f))
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)

        if (
            !status.timerControls.sessionsEnabled ||
            timer?.type != "work" ||
            position == null ||
            total == null ||
            total <= 0
        ) {
            row.addContent(horizontalSpacer(1f))
            return row.build()
        }

        for (itemPosition in 1..total.coerceAtMost(10)) {
            row.addContent(sessionDot(itemPosition, position, timer))
            row.addContent(horizontalSpacer(4f))
        }
        return row.build()
    }

    private fun sessionDot(position: Int, currentPosition: Int, timer: WatchTimer): Box {
        val active = position == currentPosition
        val completed = position < currentPosition
        val stacked = active && (timer.stackedSessions ?: 1) > 1
        val color = when {
            stacked -> WatchColors.SessionStack
            active -> WatchColors.Work
            completed -> WatchColors.IconMuted
            else -> WatchColors.SurfaceStrong
        }
        val size = if (active) 8f else 6f
        return Box.Builder()
            .setWidth(protoDp(size))
            .setHeight(protoDp(size))
            .setModifiers(tileModifiers(backgroundColor = color, cornerRadius = size / 2f))
            .build()
    }

    private fun topActions(status: WatchStatus, queueState: WatchQueueState): Row {
        return Row.Builder()
            .setWidth(protoDp(134f))
            .setHeight(protoDp(WatchHomePresentation.TOP_ACTION_SIZE_DP.toFloat()))
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .addContent(iconButton(ICON_TASKS, CLICK_TASKS, WatchHomePresentation.TOP_ACTION_SIZE_DP.toFloat(), WatchHomePresentation.TOP_ACTION_ICON_SIZE_DP.toFloat(), WatchColors.Icon))
            .addContent(queueIndicator(queueState))
            .addContent(weightedHorizontalSpacer())
            .addContent(
                iconButton(
                    resourceId = ICON_ASSISTANT,
                    clickId = if (status.assistant.canRecord) CLICK_ASSISTANT else null,
                    size = WatchHomePresentation.TOP_ACTION_SIZE_DP.toFloat(),
                    iconSize = WatchHomePresentation.TOP_ACTION_ICON_SIZE_DP.toFloat(),
                    tint = if (status.assistant.canRecord) WatchColors.Icon else WatchColors.Muted
                )
            )
            .build()
    }

    private fun queueIndicator(queueState: WatchQueueState): LayoutElement {
        val visible = WatchQueuePresentation.shouldShowLoader(
            queueState.startedAtMs,
            queueState.networkStartedAtMs,
            System.currentTimeMillis()
        )
        if (!visible) return horizontalSpacer(24f)
        val box = Box.Builder()
            .setWidth(protoDp(24f))
            .setHeight(protoDp(WatchHomePresentation.TOP_ACTION_SIZE_DP.toFloat()))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .addContent(
                Arc.Builder()
                    .setAnchorAngle(protoDegrees(-90f))
                    .setAnchorType(ARC_ANCHOR_START)
                    .setArcDirection(ARC_DIRECTION_CLOCKWISE)
                    .addContent(arcLine(270f, WatchColors.White, null))
                    .build()
            )
        if (queueState.count > 1) {
            box.addContent(
                Box.Builder()
                    .setWidth(protoDp(14f))
                    .setHeight(protoDp(14f))
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
                    .setModifiers(tileModifiers(backgroundColor = WatchColors.Icon, cornerRadius = 7f))
                    .addContent(text(queueState.count.toString(), 8f, WatchColors.Background, FONT_WEIGHT_BOLD))
                    .build()
            )
        }
        return box.build()
    }

    private fun intentionsRow(timer: WatchTimer?): LayoutElement {
        val display = WatchHomePresentation.intentionDisplay(timer?.intentions.orEmpty())
        val row = Row.Builder()
            .setWidth(protoWrap())
            .setHeight(protoDp(28f))
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)

        if (display.visible.isEmpty()) {
            row.addContent(text("○", WatchHomePresentation.EMPTY_INTENTION_TEXT_SIZE_SP.toFloat(), WatchColors.Icon, FONT_WEIGHT_BOLD))
        } else {
            display.visible.forEach { intention ->
                row.addContent(intentionPair(intention))
                row.addContent(horizontalSpacer(4f))
            }
            if (display.overflowCount > 0) {
                row.addContent(text("+${display.overflowCount}", 10f, WatchColors.Icon, FONT_WEIGHT_BOLD))
            }
        }

        return Box.Builder()
            .setWidth(protoDp(WatchHomePresentation.INTENTIONS_WIDTH_DP.toFloat()))
            .setHeight(protoDp(WatchHomePresentation.INTENTIONS_HEIGHT_DP.toFloat()))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .setModifiers(tileModifiers(clickId = CLICK_INTENTIONS, minClickSize = 48f))
            .addContent(row.build())
            .build()
    }

    private fun intentionPair(intention: WatchIntention): Box {
        val parentEmoji = intention.emoji ?: intention.subEmoji ?: ""
        val box = Box.Builder()
            .setWidth(protoDp(WatchHomePresentation.INTENTION_PAIR_SIZE_DP.toFloat()))
            .setHeight(protoDp(WatchHomePresentation.INTENTION_PAIR_SIZE_DP.toFloat()))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .addContent(text(parentEmoji, 16f, WatchColors.Text, FONT_WEIGHT_NORMAL))

        if (!intention.subEmoji.isNullOrBlank() && !intention.emoji.isNullOrBlank()) {
            box.addContent(
                Text.Builder()
                    .setText(intention.subEmoji)
                    .setFontStyle(
                        FontStyle.Builder()
                            .setSize(protoSp(8f))
                            .setWeight(FONT_WEIGHT_BOLD)
                            .setColor(argb(WatchColors.Text))
                            .build()
                    )
                    .setModifiers(
                        Modifiers.Builder()
                            .setBackground(
                                Background.Builder()
                                    .setColor(argb(WatchColors.Background))
                                    .setCorner(Corner.Builder().setRadius(protoDp(7f)).build())
                                    .build()
                            )
                            .setTransformation(
                                Transformation.Builder()
                                    .setTranslationX(protoDp(7f))
                                    .setTranslationY(protoDp(-7f))
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
        }
        return box.build()
    }

    private fun timerText(
        status: WatchStatus,
        remainingTime: Long,
        accent: Int,
        dynamicRemainingSeconds: DynamicInt32?
    ): Text {
        val timer = status.timer
        val fallback = if (timer == null) "00:00" else formatTimerMillis(remainingTime)
        val builder = Text.Builder()
            .setFontStyle(
                FontStyle.Builder()
                    .setSize(protoSp(WatchHomePresentation.TIMER_TEXT_SIZE_SP.toFloat()))
                    .setWeight(FONT_WEIGHT_BOLD)
                    .setColor(argb(accent))
                    .build()
            )
            .setMaxLines(1)
            .setMultilineAlignment(TEXT_ALIGN_CENTER)

        if (dynamicRemainingSeconds != null) {
            val formatter = DynamicInt32.IntFormatter.Builder()
                .setMinIntegerDigits(2)
                .setGroupingUsed(false)
                .build()
            val dynamicText = dynamicRemainingSeconds.div(60).format(formatter)
                .concat(androidx.wear.protolayout.expression.DynamicBuilders.DynamicString.constant(":"))
                .concat(dynamicRemainingSeconds.rem(60).format(formatter))
            builder
                .setText(StringProp.Builder(fallback).setDynamicValue(dynamicText).build())
                .setLayoutConstraintsForDynamicText(StringLayoutConstraint.Builder("00:00").build())
        } else {
            builder.setText(fallback)
        }
        return builder.build()
    }

    private fun controlRail(status: WatchStatus, accent: Int): Box {
        val playClickId = if (
            status.timerControls.canPause ||
            status.timerControls.canStartOrResume ||
            status.timerControls.requiresIntentionSelection
        ) {
            CLICK_START_PAUSE
        } else {
            null
        }
        val playIcon = when {
            status.timerControls.canPause -> ICON_PAUSE
            status.timerControls.canStartOrResume || status.timerControls.requiresIntentionSelection -> ICON_PLAY
            else -> ICON_IDLE
        }
        val playFill = if (playClickId == null) WatchColors.SurfaceStrong else accent
        val canStartLongBreak = status.timerControls.canStartLongBreak
        val railHeight = WatchControlPresentation.railHeight(canStartLongBreak)
        val positions = WatchControlPresentation.positions(canStartLongBreak)
        val rail = Box.Builder()
            .setWidth(protoDp(WatchControlPresentation.CONTROL_RAIL_WIDTH_DP.toFloat()))
            .setHeight(protoDp(railHeight.toFloat()))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
        val controls = WatchControlPresentation.order(status.timerControls.canStartLongBreak)
        controls.forEach { control ->
            val position = positions.getValue(control)
            val translation = WatchControlPresentation.translation(position, railHeight)
            val controlElement = when (control) {
                    WatchControl.LONG_BREAK -> iconButton(
                        ICON_LONG_BREAK,
                        CLICK_LONG_BREAK,
                        position.sizeDp.toFloat(),
                        WatchControlPresentation.LONG_BREAK_ICON_SIZE_DP.toFloat(),
                        WatchColors.White
                    )
                    WatchControl.ADD_FIVE -> textButton(
                        label = "+5",
                        clickId = if (status.timerControls.canAddFiveMinutes) CLICK_ADD_FIVE else null,
                        size = position.sizeDp.toFloat(),
                        textSize = 12f,
                        tint = if (status.timerControls.canAddFiveMinutes) WatchColors.Icon else WatchColors.Muted
                    )
                    WatchControl.PLAY_PAUSE -> iconButton(
                        playIcon,
                        playClickId,
                        position.sizeDp.toFloat(),
                        22f,
                        WatchColors.Text,
                        playFill,
                        position.visualSizeDp / 2f
                    )
                    WatchControl.RESET -> iconButton(
                        resourceId = ICON_RESET,
                        clickId = if (status.timerControls.canReset) CLICK_RESET else null,
                        size = position.sizeDp.toFloat(),
                        iconSize = 18f,
                        tint = if (status.timerControls.canReset) WatchColors.Icon else WatchColors.Muted
                    )
                    WatchControl.SKIP -> iconButton(
                        resourceId = ICON_SKIP,
                        clickId = if (status.timerControls.canSkip) CLICK_SKIP else null,
                        size = position.sizeDp.toFloat(),
                        iconSize = 18f,
                        tint = if (status.timerControls.canSkip) WatchColors.Icon else WatchColors.Muted
                    )
                }
            rail.addContent(
                Box.Builder()
                    .setWidth(protoDp(position.sizeDp.toFloat()))
                    .setHeight(protoDp(position.sizeDp.toFloat()))
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
                    .setModifiers(
                        Modifiers.Builder()
                            .setTransformation(
                                Transformation.Builder()
                                    .setTranslationX(protoDp(translation.first.toFloat()))
                                    .setTranslationY(protoDp(translation.second.toFloat()))
                                    .build()
                            )
                            .build()
                    )
                    .addContent(controlElement)
                    .build()
            )
        }
        return rail.build()
    }

    private fun iconButton(
        resourceId: String,
        clickId: String?,
        size: Float,
        iconSize: Float,
        tint: Int,
        backgroundColor: Int? = null,
        cornerRadius: Float = size / 2f
    ): Box {
        return Box.Builder()
            .setWidth(protoDp(size))
            .setHeight(protoDp(size))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .setModifiers(
                tileModifiers(
                    backgroundColor = backgroundColor,
                    cornerRadius = cornerRadius,
                    clickId = clickId,
                    minClickSize = WatchControlPresentation.MIN_TOUCH_SIZE_DP.toFloat()
                )
            )
            .addContent(
                Image.Builder()
                    .setResourceId(resourceId)
                    .setWidth(protoDp(iconSize))
                    .setHeight(protoDp(iconSize))
                    .setColorFilter(
                        androidx.wear.protolayout.LayoutElementBuilders.ColorFilter.Builder()
                            .setTint(argb(tint))
                            .build()
                    )
                    .build()
            )
            .build()
    }

    private fun textButton(
        label: String,
        clickId: String?,
        size: Float,
        textSize: Float,
        tint: Int
    ): Box {
        return Box.Builder()
            .setWidth(protoDp(size))
            .setHeight(protoDp(size))
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .setModifiers(
                tileModifiers(
                    clickId = clickId,
                    minClickSize = WatchControlPresentation.MIN_TOUCH_SIZE_DP.toFloat()
                )
            )
            .addContent(text(label, textSize, tint, FONT_WEIGHT_BOLD))
            .build()
    }

    private fun text(value: String, sizeSp: Float, color: Int, weight: Int): Text {
        return Text.Builder()
            .setText(value)
            .setFontStyle(
                FontStyle.Builder()
                    .setSize(protoSp(sizeSp))
                    .setWeight(weight)
                    .setColor(argb(color))
                    .build()
            )
            .setMaxLines(1)
            .setMultilineAlignment(TEXT_ALIGN_CENTER)
            .build()
    }

    private fun verticalSpacer(height: Float): Spacer {
        return Spacer.Builder()
            .setWidth(protoDp(1f))
            .setHeight(protoDp(height))
            .build()
    }

    private fun horizontalSpacer(width: Float): Spacer {
        return Spacer.Builder()
            .setWidth(protoDp(width))
            .setHeight(protoDp(1f))
            .build()
    }

    private fun weightedHorizontalSpacer(): Spacer {
        return Spacer.Builder()
            .setWidth(protoWeight(1f))
            .setHeight(protoDp(1f))
            .build()
    }

    private fun tileModifiers(
        backgroundColor: Int? = null,
        cornerRadius: Float = 0f,
        clickId: String? = null,
        minClickSize: Float = 48f,
        padding: Float? = null
    ): Modifiers {
        val builder = Modifiers.Builder()
        if (backgroundColor != null) {
            builder.setBackground(
                Background.Builder()
                    .setColor(argb(backgroundColor))
                    .setCorner(Corner.Builder().setRadius(protoDp(cornerRadius)).build())
                    .build()
            )
        }
        if (clickId != null) {
            builder.setClickable(
                Clickable.Builder()
                    .setId(clickId)
                    .setOnClick(LoadAction.Builder().build())
                    .setMinimumClickableWidth(protoDp(minClickSize))
                    .setMinimumClickableHeight(protoDp(minClickSize))
                    .build()
            )
        }
        if (padding != null) {
            builder.setPadding(Padding.Builder().setAll(protoDp(padding)).build())
        }
        return builder.build()
    }

    private fun tileFrom(layout: LayoutElement): Tile {
        return Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setTileTimeline(Timeline.fromLayoutElement(layout))
            .setFreshnessIntervalMillis(TILE_FRESHNESS_MS)
            .build()
    }

    private fun localizedString(resourceId: Int): String =
        withWatchLanguage(sessionStore.languageTag).getString(resourceId)

    private fun Resources.Builder.addTileIcon(id: String, drawableId: Int): Resources.Builder {
        return addIdToImageMapping(
            id,
            ImageResource.Builder()
                .setAndroidResourceByResId(
                    AndroidImageResourceByResId.Builder()
                        .setResourceId(drawableId)
                        .build()
                )
                .build()
        )
    }

    companion object {
        private const val RESOURCES_VERSION = "pomi-tile-v2"
        private const val TILE_NETWORK_TIMEOUT_MS = 3000
        private const val TILE_FRESHNESS_MS = 15000L

        private const val CLICK_OPEN_APP = "open_app"
        private const val CLICK_TASKS = "tasks"
        private const val CLICK_ASSISTANT = "assistant"
        private const val CLICK_INTENTIONS = "intentions"
        private const val CLICK_START_PAUSE = "start_pause"
        private const val CLICK_ADD_FIVE = "add_five"
        private const val CLICK_RESET = "reset"
        private const val CLICK_SKIP = "skip"
        private const val CLICK_LONG_BREAK = "long_break"

        private const val ICON_TASKS = "icon_tasks"
        private const val ICON_ASSISTANT = "icon_assistant"
        private const val ICON_PLAY = "icon_play"
        private const val ICON_PAUSE = "icon_pause"
        private const val ICON_RESET = "icon_reset"
        private const val ICON_SKIP = "icon_skip"
        private const val ICON_LONG_BREAK = "icon_long_break"
        private const val ICON_IDLE = "icon_idle"
    }
}
