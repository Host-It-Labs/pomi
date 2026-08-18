package app.pomi.community.watch

import kotlin.math.max
import android.content.Context

object WatchHomePresentation {
    const val TOP_ACTION_SIZE_DP = 38
    const val TOP_ACTION_ICON_SIZE_DP = 20
    const val INTENTIONS_WIDTH_DP = 138
    const val INTENTIONS_HEIGHT_DP = 32
    const val INTENTION_PAIR_SIZE_DP = 24
    const val INTENTION_PAIR_SPACING_DP = 4
    const val EMPTY_INTENTION_TEXT_SIZE_SP = 26
    const val TIMER_TEXT_SIZE_SP = 36

    fun intentionDisplay(intentions: List<WatchIntention>): WatchIntentionDisplay {
        val visibleCandidates = intentions.filter {
            !it.emoji.isNullOrBlank() || !it.subEmoji.isNullOrBlank()
        }
        val visible = if (visibleCandidates.size > 4) {
            visibleCandidates.take(3)
        } else {
            visibleCandidates.take(4)
        }
        return WatchIntentionDisplay(visible, visibleCandidates.size - visible.size)
    }
}

object WatchQueuePresentation {
    const val LOADER_DELAY_MS = 1_000L
    const val SPINNER_SIZE_DP = 20

    fun shouldShowLoader(startedAtMs: Long?, nowMs: Long): Boolean =
        startedAtMs != null && nowMs - startedAtMs >= LOADER_DELAY_MS

    fun shouldShowLoader(
        actionStartedAtMs: Long?,
        networkStartedAtMs: Long?,
        nowMs: Long
    ): Boolean {
        val earliestStart = listOfNotNull(actionStartedAtMs, networkStartedAtMs).minOrNull()
        return shouldShowLoader(earliestStart, nowMs)
    }

    fun badgeCount(active: Boolean, queued: Int): Int = queued + if (active) 1 else 0
}

object WatchAssistantPresentation {
    const val PRIMARY_HORIZONTAL_MARGIN_DP = 0
    const val PRIMARY_HEIGHT_DP = 60
    const val PRIMARY_BOTTOM_MARGIN_DP = -10
    const val CANCEL_WIDTH_DP = 88
    const val CANCEL_HEIGHT_DP = 30
    const val CANCEL_BOTTOM_MARGIN_DP = 70

    fun recordingLabel(elapsedSeconds: Long): String =
        "■  Stop  %02d:%02d".format(
            elapsedSeconds.coerceAtLeast(0) / 60,
            elapsedSeconds.coerceAtLeast(0) % 60
        )

    fun recordingLabel(context: Context, elapsedSeconds: Long): String =
        "■  ${context.getString(R.string.stop)}  %02d:%02d".format(
            elapsedSeconds.coerceAtLeast(0) / 60,
            elapsedSeconds.coerceAtLeast(0) % 60
        )
}

enum class WatchAssistantInterruption {
    STOP,
    CANCEL,
    MAXIMUM_DURATION,
    BACKGROUND,
    AUTHENTICATION_LOSS
}

enum class WatchAssistantInterruptionAction {
    SUBMIT,
    DISCARD
}

object WatchAssistantInterruptionPolicy {
    fun action(interruption: WatchAssistantInterruption): WatchAssistantInterruptionAction =
        when (interruption) {
            WatchAssistantInterruption.STOP,
            WatchAssistantInterruption.MAXIMUM_DURATION,
            WatchAssistantInterruption.BACKGROUND -> WatchAssistantInterruptionAction.SUBMIT
            WatchAssistantInterruption.CANCEL,
            WatchAssistantInterruption.AUTHENTICATION_LOSS -> WatchAssistantInterruptionAction.DISCARD
        }
}

enum class WatchControl {
    LONG_BREAK,
    ADD_FIVE,
    PLAY_PAUSE,
    RESET,
    SKIP
}

data class WatchControlPosition(
    val sizeDp: Int,
    val visualSizeDp: Int,
    val leftDp: Int,
    val topDp: Int
)

object WatchControlPresentation {
    const val CONTROL_RAIL_WIDTH_DP = 196
    const val FOUR_CONTROL_RAIL_HEIGHT_DP = 96
    const val FIVE_CONTROL_RAIL_HEIGHT_DP = 84
    const val SECONDARY_VISUAL_SIZE_DP = 40
    const val PRIMARY_VISUAL_SIZE_DP = 48
    const val MIN_TOUCH_SIZE_DP = 48
    const val LONG_BREAK_ICON_SIZE_DP = 20

    fun railHeight(canStartLongBreak: Boolean): Int =
        if (canStartLongBreak) FIVE_CONTROL_RAIL_HEIGHT_DP else FOUR_CONTROL_RAIL_HEIGHT_DP

    fun translation(position: WatchControlPosition, railHeightDp: Int): Pair<Int, Int> =
        Pair(
            position.leftDp + position.sizeDp / 2 - CONTROL_RAIL_WIDTH_DP / 2,
            position.topDp + position.sizeDp / 2 - railHeightDp / 2
        )

    fun order(canStartLongBreak: Boolean): List<WatchControl> = buildList {
        if (canStartLongBreak) add(WatchControl.LONG_BREAK)
        add(WatchControl.ADD_FIVE)
        add(WatchControl.PLAY_PAUSE)
        add(WatchControl.RESET)
        add(WatchControl.SKIP)
    }

    fun positions(canStartLongBreak: Boolean): Map<WatchControl, WatchControlPosition> {
        return if (canStartLongBreak) {
            mapOf(
                WatchControl.LONG_BREAK to WatchControlPosition(MIN_TOUCH_SIZE_DP, SECONDARY_VISUAL_SIZE_DP, 0, 4),
                WatchControl.ADD_FIVE to WatchControlPosition(MIN_TOUCH_SIZE_DP, SECONDARY_VISUAL_SIZE_DP, 36, 21),
                WatchControl.PLAY_PAUSE to WatchControlPosition(MIN_TOUCH_SIZE_DP, PRIMARY_VISUAL_SIZE_DP, 74, 32),
                WatchControl.RESET to WatchControlPosition(MIN_TOUCH_SIZE_DP, SECONDARY_VISUAL_SIZE_DP, 112, 21),
                WatchControl.SKIP to WatchControlPosition(MIN_TOUCH_SIZE_DP, SECONDARY_VISUAL_SIZE_DP, 148, 4)
            )
        } else {
            mapOf(
                WatchControl.ADD_FIVE to WatchControlPosition(MIN_TOUCH_SIZE_DP, SECONDARY_VISUAL_SIZE_DP, 14, 28),
                WatchControl.PLAY_PAUSE to WatchControlPosition(MIN_TOUCH_SIZE_DP, PRIMARY_VISUAL_SIZE_DP, 74, 4),
                WatchControl.RESET to WatchControlPosition(MIN_TOUCH_SIZE_DP, SECONDARY_VISUAL_SIZE_DP, 74, 48),
                WatchControl.SKIP to WatchControlPosition(MIN_TOUCH_SIZE_DP, SECONDARY_VISUAL_SIZE_DP, 134, 28)
            )
        }
    }
}

class WatchNavigationClickGate(
    private val duplicateWindowMs: Long
) {
    private var lastAcceptedAtMs: Long? = null

    fun accept(nowMs: Long): Boolean {
        val previous = lastAcceptedAtMs
        if (previous != null && nowMs - previous < duplicateWindowMs) return false
        lastAcceptedAtMs = nowMs
        return true
    }
}

data class WatchIntentionDisplay(
    val visible: List<WatchIntention>,
    val overflowCount: Int
)

class WatchStatusRequestGate {
    private var generation = 0

    fun beginRequest(): Int {
        generation += 1
        return generation
    }

    fun accepts(requestGeneration: Int): Boolean = requestGeneration == generation
}

object WatchTimerProjection {
    fun localEndsAt(status: WatchStatus, receivedAtWallMs: Long): Long? {
        val timer = status.timer ?: return null
        if (timer.status != "running") return null
        val serverEndsAt = timer.endsAtMs
        return if (serverEndsAt == null || status.serverNowMs <= 0L) {
            receivedAtWallMs + timer.remainingTime.coerceAtLeast(0L)
        } else {
            receivedAtWallMs + (serverEndsAt - status.serverNowMs)
        }
    }

    fun remainingAt(
        status: WatchStatus,
        receivedAtWallMs: Long,
        nowWallMs: Long
    ): Long {
        val timer = status.timer ?: return 0L
        if (timer.status != "running") return timer.remainingTime.coerceAtLeast(0L)
        val localEndsAt = localEndsAt(status, receivedAtWallMs) ?: return timer.remainingTime.coerceAtLeast(0L)
        return max(0L, localEndsAt - nowWallMs)
    }
}

object WatchRingPresentation {
    fun progress(timer: WatchTimer?, remainingTime: Long): Float {
        if (timer == null || timer.duration <= 0L) return 0f
        return (remainingTime.toFloat() / timer.duration.toFloat()).coerceIn(0f, 1f)
    }

    fun sweepDegrees(progress: Float): Float = 360f * progress.coerceIn(0f, 1f)

    fun isActive(
        timer: WatchTimer?,
        isInitialLoading: Boolean,
        hasFailure: Boolean
    ): Boolean = timer?.status == "running" && !isInitialLoading && !hasFailure
}

data class WatchIntentionSelection(
    val slugs: List<String>,
    val subIntentions: Map<String, String>
)

object WatchIntentionSelectionAction {
    fun action(startOnSelect: Boolean): String =
        if (startOnSelect) "startOrResume" else "setIntentions"
}

object WatchIntentionSelectionReducer {
    fun toggleParent(
        selectedSlugs: List<String>,
        selectedSubIntentions: Map<String, String>,
        slug: String,
        multiSelect: Boolean,
        requireSelection: Boolean
    ): WatchIntentionSelection {
        val nextSlugs = when {
            !multiSelect -> {
                if (selectedSlugs == listOf(slug) && !requireSelection) emptyList() else listOf(slug)
            }
            selectedSlugs.contains(slug) -> {
                if (requireSelection && selectedSlugs.size == 1) selectedSlugs
                else selectedSlugs.filterNot { it == slug }
            }
            else -> selectedSlugs + slug
        }
        return WatchIntentionSelection(
            slugs = nextSlugs,
            subIntentions = selectedSubIntentions.filterKeys(nextSlugs::contains)
        )
    }

    fun selectChild(
        selectedSlugs: List<String>,
        selectedSubIntentions: Map<String, String>,
        parentSlug: String,
        childSlug: String,
        multiSelect: Boolean
    ): WatchIntentionSelection {
        val nextSlugs = if (multiSelect) {
            if (selectedSlugs.contains(parentSlug)) selectedSlugs else selectedSlugs + parentSlug
        } else {
            listOf(parentSlug)
        }
        return WatchIntentionSelection(
            slugs = nextSlugs,
            subIntentions = selectedSubIntentions
                .filterKeys(nextSlugs::contains)
                .plus(parentSlug to childSlug)
        )
    }
}
