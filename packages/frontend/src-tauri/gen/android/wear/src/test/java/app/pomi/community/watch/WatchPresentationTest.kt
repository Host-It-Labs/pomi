package app.pomi.community.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchPresentationTest {
    @Test
    fun ringProgressMatchesRemainingTimeGeometry() {
        val timer = watchTimer()

        assertEquals(1f, WatchRingPresentation.progress(timer, 60_000L), 0.0001f)
        assertEquals(0.5f, WatchRingPresentation.progress(timer, 30_000L), 0.0001f)
        assertEquals(0.25f, WatchRingPresentation.progress(timer, 15_000L), 0.0001f)
        assertEquals(0f, WatchRingPresentation.progress(timer, 0L), 0.0001f)
        assertEquals(90f, WatchRingPresentation.sweepDegrees(0.25f), 0.0001f)
        assertEquals(0f, WatchRingPresentation.progress(null, 30_000L), 0.0001f)
        assertEquals(0f, WatchRingPresentation.progress(timer.copy(duration = 0L), 30_000L), 0.0001f)
        assertEquals(1f, WatchRingPresentation.progress(timer, 120_000L), 0.0001f)
        assertEquals(0f, WatchRingPresentation.progress(timer, -1L), 0.0001f)
        assertEquals(360f, WatchRingPresentation.sweepDegrees(2f), 0.0001f)
        assertEquals(0f, WatchRingPresentation.sweepDegrees(-1f), 0.0001f)
    }

    @Test
    fun backgroundRefreshDoesNotMuteRunningRing() {
        val timer = watchTimer(remainingTime = 30_000L, endsAtMs = 130_000L)

        assertTrue(WatchRingPresentation.isActive(timer, false, false))
        assertFalse(WatchRingPresentation.isActive(timer, true, false))
        assertFalse(WatchRingPresentation.isActive(null, false, false))
        assertFalse(WatchRingPresentation.isActive(timer, false, true))
        assertFalse(WatchRingPresentation.isActive(timer.copy(status = "paused"), false, false))
    }

    @Test
    fun queueLoaderAndBadgeFollowDelayedCombinedState() {
        assertFalse(WatchQueuePresentation.shouldShowLoader(1_000L, 1_999L))
        assertTrue(WatchQueuePresentation.shouldShowLoader(1_000L, 2_000L))
        assertFalse(WatchQueuePresentation.shouldShowLoader(null, 20_000L))
        assertFalse(WatchQueuePresentation.shouldShowLoader(5_000L, 8_500L, 5_999L))
        assertTrue(WatchQueuePresentation.shouldShowLoader(5_000L, 8_500L, 6_000L))
        assertTrue(WatchQueuePresentation.shouldShowLoader(null, 1_000L, 2_000L))
        assertEquals(0, WatchQueuePresentation.badgeCount(false, 0))
        assertEquals(1, WatchQueuePresentation.badgeCount(true, 0))
        assertEquals(3, WatchQueuePresentation.badgeCount(true, 2))
    }

    @Test
    fun intentionDisplayFiltersEmptyIconsAndSummarizesOverflow() {
        val compact = listOf(
            watchIntention("one", emoji = "1"),
            watchIntention("empty"),
            watchIntention("two", subEmoji = "2")
        )
        assertEquals(WatchIntentionDisplay(listOf(compact[0], compact[2]), 0), WatchHomePresentation.intentionDisplay(compact))

        val four = (1..4).map { watchIntention("item-$it", emoji = it.toString()) }
        assertEquals(WatchIntentionDisplay(four, 0), WatchHomePresentation.intentionDisplay(four))

        val crowded = (1..5).map { watchIntention("item-$it", emoji = it.toString()) }
        assertEquals(WatchIntentionDisplay(crowded.take(3), 2), WatchHomePresentation.intentionDisplay(crowded))
    }

    @Test
    fun assistantLayoutAndInterruptionPolicyCoverAllOutcomes() {
        assertEquals(0, WatchAssistantPresentation.PRIMARY_HORIZONTAL_MARGIN_DP)
        assertEquals(60, WatchAssistantPresentation.PRIMARY_HEIGHT_DP)
        assertEquals(-10, WatchAssistantPresentation.PRIMARY_BOTTOM_MARGIN_DP)
        assertEquals(70, WatchAssistantPresentation.CANCEL_BOTTOM_MARGIN_DP)
        assertEquals(30, WatchAssistantPresentation.CANCEL_HEIGHT_DP)
        assertEquals("■  Stop  00:00", WatchAssistantPresentation.recordingLabel(-1))
        assertEquals("■  Stop  01:05", WatchAssistantPresentation.recordingLabel(65))

        listOf(
            WatchAssistantInterruption.STOP,
            WatchAssistantInterruption.MAXIMUM_DURATION,
            WatchAssistantInterruption.BACKGROUND
        ).forEach { assertEquals(WatchAssistantInterruptionAction.SUBMIT, WatchAssistantInterruptionPolicy.action(it)) }
        listOf(
            WatchAssistantInterruption.CANCEL,
            WatchAssistantInterruption.AUTHENTICATION_LOSS
        ).forEach { assertEquals(WatchAssistantInterruptionAction.DISCARD, WatchAssistantInterruptionPolicy.action(it)) }
    }

    @Test
    fun controlsUseSharedAccessibleTokensAndStableOrdering() {
        assertEquals(26, WatchHomePresentation.EMPTY_INTENTION_TEXT_SIZE_SP)
        assertEquals(40, WatchControlPresentation.SECONDARY_VISUAL_SIZE_DP)
        assertEquals(48, WatchControlPresentation.PRIMARY_VISUAL_SIZE_DP)
        assertEquals(48, WatchControlPresentation.MIN_TOUCH_SIZE_DP)
        assertEquals(20, WatchControlPresentation.LONG_BREAK_ICON_SIZE_DP)
        assertTrue(WatchControlPresentation.LONG_BREAK_ICON_SIZE_DP < WatchControlPresentation.MIN_TOUCH_SIZE_DP)
        assertEquals(
            listOf(WatchControl.LONG_BREAK, WatchControl.ADD_FIVE, WatchControl.PLAY_PAUSE, WatchControl.RESET, WatchControl.SKIP),
            WatchControlPresentation.order(canStartLongBreak = true)
        )
        assertEquals(
            listOf(WatchControl.ADD_FIVE, WatchControl.PLAY_PAUSE, WatchControl.RESET, WatchControl.SKIP),
            WatchControlPresentation.order(canStartLongBreak = false)
        )
    }

    @Test
    fun fourAndFiveControlLayoutsStayInsideTheirRails() {
        val four = WatchControlPresentation.positions(canStartLongBreak = false)
        val fourPlay = four.getValue(WatchControl.PLAY_PAUSE)
        assertEquals(48, fourPlay.sizeDp)
        assertEquals(48, fourPlay.visualSizeDp)
        assertEquals(98, fourPlay.leftDp + fourPlay.sizeDp / 2)
        assertEquals(4, fourPlay.topDp)
        assertTrue(four.getValue(WatchControl.ADD_FIVE).leftDp < four.getValue(WatchControl.RESET).leftDp)
        assertTrue(four.getValue(WatchControl.RESET).leftDp < four.getValue(WatchControl.SKIP).leftDp)

        val five = WatchControlPresentation.positions(canStartLongBreak = true)
        assertEquals(WatchControlPosition(48, 40, 0, 4), five[WatchControl.LONG_BREAK])
        assertEquals(WatchControlPosition(48, 40, 36, 21), five[WatchControl.ADD_FIVE])
        assertEquals(WatchControlPosition(48, 48, 74, 32), five[WatchControl.PLAY_PAUSE])
        assertEquals(WatchControlPosition(48, 40, 112, 21), five[WatchControl.RESET])
        assertEquals(WatchControlPosition(48, 40, 148, 4), five[WatchControl.SKIP])

        listOf(false, true).forEach { canStartLongBreak ->
            val railHeight = WatchControlPresentation.railHeight(canStartLongBreak)
            WatchControlPresentation.positions(canStartLongBreak).values.forEach { position ->
                assertTrue(position.leftDp >= 0)
                assertTrue(position.topDp >= 0)
                assertTrue(position.leftDp + position.sizeDp <= WatchControlPresentation.CONTROL_RAIL_WIDTH_DP)
                assertTrue(position.topDp + position.sizeDp <= railHeight)
            }
        }
    }

    @Test
    fun curvedTranslationsMatchBothControlLayouts() {
        val fourHeight = WatchControlPresentation.railHeight(false)
        val four = WatchControlPresentation.positions(false).mapValues { WatchControlPresentation.translation(it.value, fourHeight) }
        assertEquals(Pair(-60, 4), four[WatchControl.ADD_FIVE])
        assertEquals(Pair(0, -20), four[WatchControl.PLAY_PAUSE])
        assertEquals(Pair(0, 24), four[WatchControl.RESET])
        assertEquals(Pair(60, 4), four[WatchControl.SKIP])

        val fiveHeight = WatchControlPresentation.railHeight(true)
        val five = WatchControlPresentation.positions(true).mapValues { WatchControlPresentation.translation(it.value, fiveHeight) }
        assertEquals(Pair(-74, -14), five[WatchControl.LONG_BREAK])
        assertEquals(Pair(-38, 3), five[WatchControl.ADD_FIVE])
        assertEquals(Pair(0, 14), five[WatchControl.PLAY_PAUSE])
        assertEquals(Pair(38, 3), five[WatchControl.RESET])
        assertEquals(Pair(74, -14), five[WatchControl.SKIP])
    }
}
