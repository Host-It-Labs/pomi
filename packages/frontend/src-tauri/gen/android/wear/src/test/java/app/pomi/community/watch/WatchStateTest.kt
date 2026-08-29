package app.pomi.community.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchStateTest {
    @Test
    fun advancedSkipStatusWinsOverOlderInflightStatusRequest() {
        val gate = WatchStatusRequestGate()
        val requestBeforeSkip = gate.beginRequest()
        val forcedRequestAfterSkip = gate.beginRequest()

        assertFalse(gate.accepts(requestBeforeSkip))
        assertTrue(gate.accepts(forcedRequestAfterSkip))
    }

    @Test
    fun projectsRunningTimerFromServerClockAcrossReopen() {
        val status = watchStatus(timer = watchTimer(remainingTime = 60_000L, endsAtMs = 160_000L))

        assertEquals(42_000L, WatchTimerProjection.remainingAt(status, 1_000_000L, 1_018_000L))
        assertEquals(1_060_000L, WatchTimerProjection.localEndsAt(status, 1_000_000L))
    }

    @Test
    fun pausedAndMissingTimersKeepTheirConfirmedSnapshot() {
        val missing = watchStatus(timer = null)
        assertEquals(null, WatchTimerProjection.localEndsAt(missing, 1_000_000L))
        assertEquals(0L, WatchTimerProjection.remainingAt(missing, 1_000_000L, 1_001_000L))

        val paused = watchStatus(timer = watchTimer(status = "paused", remainingTime = -1L, endsAtMs = null))
        assertEquals(null, WatchTimerProjection.localEndsAt(paused, 1_000_000L))
        assertEquals(0L, WatchTimerProjection.remainingAt(paused, 1_000_000L, 1_001_000L))

        val positivePaused = watchStatus(timer = watchTimer(status = "paused", remainingTime = 42_000L, endsAtMs = null))
        assertEquals(42_000L, WatchTimerProjection.remainingAt(positivePaused, 1_000_000L, 1_050_000L))
    }

    @Test
    fun runningProjectionFallsBackToConfirmedRemainingTimeWithoutTrustedServerEnd() {
        val withoutServerEnd = watchStatus(timer = watchTimer(remainingTime = 45_000L, endsAtMs = null))
        assertEquals(1_045_000L, WatchTimerProjection.localEndsAt(withoutServerEnd, 1_000_000L))

        val withoutServerClock = watchStatus(
            serverNowMs = 0L,
            timer = watchTimer(remainingTime = 30_000L, endsAtMs = 500_000L)
        )
        assertEquals(1_030_000L, WatchTimerProjection.localEndsAt(withoutServerClock, 1_000_000L))
    }

    @Test
    fun multiSelectAddsAndRemovesParentsWithoutOrphaningChildren() {
        val added = WatchIntentionSelectionReducer.toggleParent(
            listOf("deep-work"),
            mapOf("deep-work" to "pomi"),
            "admin",
            multiSelect = true,
            requireSelection = true
        )
        assertEquals(listOf("deep-work", "admin"), added.slugs)

        val removed = WatchIntentionSelectionReducer.toggleParent(
            added.slugs,
            added.subIntentions,
            "deep-work",
            multiSelect = true,
            requireSelection = true
        )
        assertEquals(listOf("admin"), removed.slugs)
        assertEquals(emptyMap<String, String>(), removed.subIntentions)
    }

    @Test
    fun requiredSelectionCannotRemoveLastParent() {
        val selection = WatchIntentionSelectionReducer.toggleParent(
            listOf("deep-work"),
            emptyMap(),
            "deep-work",
            multiSelect = true,
            requireSelection = true
        )

        assertEquals(listOf("deep-work"), selection.slugs)
    }

    @Test
    fun childSelectionKeepsParentPairInMultiSelect() {
        val added = WatchIntentionSelectionReducer.selectChild(
            listOf("admin"),
            emptyMap(),
            "deep-work",
            "pomi",
            multiSelect = true
        )
        assertEquals(listOf("admin", "deep-work"), added.slugs)
        assertEquals(mapOf("deep-work" to "pomi"), added.subIntentions)

        val retained = WatchIntentionSelectionReducer.selectChild(
            listOf("deep-work", "admin"),
            mapOf("admin" to "inbox"),
            "deep-work",
            "pomi",
            multiSelect = true
        )
        assertEquals(listOf("deep-work", "admin"), retained.slugs)
        assertEquals(mapOf("admin" to "inbox", "deep-work" to "pomi"), retained.subIntentions)
    }

    @Test
    fun singleSelectionReplacesOrClearsParentAndChildSelection() {
        val replaced = WatchIntentionSelectionReducer.toggleParent(
            listOf("admin"),
            mapOf("admin" to "inbox"),
            "deep-work",
            multiSelect = false,
            requireSelection = false
        )
        assertEquals(listOf("deep-work"), replaced.slugs)
        assertEquals(emptyMap<String, String>(), replaced.subIntentions)

        val cleared = WatchIntentionSelectionReducer.toggleParent(
            listOf("deep-work"),
            mapOf("deep-work" to "pomi"),
            "deep-work",
            multiSelect = false,
            requireSelection = false
        )
        assertEquals(emptyList<String>(), cleared.slugs)
        assertEquals(emptyMap<String, String>(), cleared.subIntentions)

        val retained = WatchIntentionSelectionReducer.toggleParent(
            listOf("deep-work"),
            emptyMap(),
            "deep-work",
            multiSelect = false,
            requireSelection = true
        )
        assertEquals(listOf("deep-work"), retained.slugs)

        val child = WatchIntentionSelectionReducer.selectChild(
            listOf("admin"),
            mapOf("admin" to "inbox"),
            "deep-work",
            "pomi",
            multiSelect = false
        )
        assertEquals(listOf("deep-work"), child.slugs)
        assertEquals(mapOf("deep-work" to "pomi"), child.subIntentions)
    }

    @Test
    fun intentionSelectionUsesTheMatchingBreakResetPreference() {
        val controls = watchStatus().timerControls

        assertFalse(controls.resetOnFirstIntentionFor("break") == true)
        assertFalse(controls.resetOnFirstIntentionFor("longBreak") == true)
        assertEquals(null, controls.resetOnFirstIntentionFor("work"))

        val shortBreakEnabled = controls.copy(resetBreakOnFirstIntention = true)
        assertTrue(shortBreakEnabled.resetOnFirstIntentionFor("break") == true)
        assertFalse(shortBreakEnabled.resetOnFirstIntentionFor("longBreak") == true)

        val longBreakEnabled = controls.copy(resetLongBreakOnFirstIntention = true)
        assertFalse(longBreakEnabled.resetOnFirstIntentionFor("break") == true)
        assertTrue(longBreakEnabled.resetOnFirstIntentionFor("longBreak") == true)
    }

    @Test
    fun intentionSelectionActionHonorsStartMode() {
        assertEquals("startOrResume", WatchIntentionSelectionAction.action(startOnSelect = true))
        assertEquals("setIntentions", WatchIntentionSelectionAction.action(startOnSelect = false))
    }

    @Test
    fun navigationGateRejectsOnlyClicksInsideDuplicateWindow() {
        val gate = WatchNavigationClickGate(duplicateWindowMs = 500L)

        assertTrue(gate.accept(1_000L))
        assertFalse(gate.accept(1_001L))
        assertFalse(gate.accept(1_499L))
        assertTrue(gate.accept(1_500L))
    }
}
