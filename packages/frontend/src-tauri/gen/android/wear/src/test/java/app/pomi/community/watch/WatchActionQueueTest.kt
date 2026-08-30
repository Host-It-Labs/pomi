package app.pomi.community.watch

import java.io.IOException
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchActionQueueTest {
    @Test
    fun staleRecordingCleanupPreservesFilesReferencedByQueuedActions() {
        val recording = File.createTempFile("assistant-", ".m4a")
        try {
            recording.setLastModified(1L)
            assertFalse(
                shouldDeleteAssistantRecording(
                    recording,
                    cutoff = 2L,
                    referencedPaths = setOf(recording.absolutePath)
                )
            )
            assertTrue(
                shouldDeleteAssistantRecording(
                    recording,
                    cutoff = 2L,
                    referencedPaths = emptySet()
                )
            )
        } finally {
            recording.delete()
        }
    }

    @Test
    fun actionFactoriesPreserveEveryGatewayInput() {
        val timer = PendingWatchAction.timer("skip", "longBreak", "record")
        assertEquals("timer", timer.kind)
        assertEquals("skip", timer.action)
        assertEquals("longBreak", timer.timerType)
        assertEquals("record", timer.skipLogMode)

        val session = PendingWatchAction.session(3)
        assertEquals("session", session.kind)
        assertEquals(3, session.position)

        val intentions = PendingWatchAction.intentions("setIntentions", listOf("focus"), mapOf("focus" to "code"), "work", null)
        assertEquals(listOf("focus"), intentions.intentionSlugs)
        assertEquals(mapOf("focus" to "code"), intentions.subIntentions)

        assertEquals("task-1", PendingWatchAction.completeTask("task-1").taskId)
        assertEquals("audio", PendingWatchAction.assistantVoice("audio", "audio/webm").assistantAudioBase64)
        val chunks = PendingWatchAction.assistantVoiceChunks(
            listOf(
                WatchAudioChunk("first", "audio/mp4"),
                WatchAudioChunk("second", "audio/mp4")
            )
        )
        assertEquals(listOf("first", "second"), chunks.assistantAudioChunks.map { it.filePath })

        val transcript = PendingWatchAction.assistantTranscript("do it", 0.25, "debug-1")
        assertEquals("do it", transcript.assistantTranscript)
        assertEquals(0.25, transcript.assistantTranscriptionCostUsd ?: 0.0, 0.0001)
        assertEquals("debug-1", transcript.assistantDebugLogId)
    }

    @Test
    fun preparedAssistantActionDropsSensitiveInputButKeepsItsIdentity() {
        val action = PendingWatchAction.assistantTranscript("do it", 0.25, "debug-1")
            .copy(id = "voice-1", accountKey = "account-1")

        val prepared = action.withoutAssistantInput()

        assertEquals("voice-1", prepared.id)
        assertEquals("assistantVoice", prepared.kind)
        assertEquals("account-1", prepared.accountKey)
        assertEquals(null, prepared.assistantAudioBase64)
        assertEquals(null, prepared.assistantAudioMimeType)
        assertEquals(null, prepared.assistantTranscript)
        assertEquals(null, prepared.assistantTranscriptionCostUsd)
        assertEquals(null, prepared.assistantDebugLogId)
    }

    @Test
    fun publicAssistantSnapshotNeverContainsVoiceInput() {
        val action = PendingWatchAction.assistantVoice("audio", "audio/mp4").copy(
            assistantAudioChunks = listOf(WatchAudioChunk("chunk", "audio/mp4"))
        )

        val snapshot = action.publicSnapshot()

        assertEquals(action.id, snapshot.id)
        assertEquals(null, snapshot.assistantAudioBase64)
        assertEquals(null, snapshot.assistantAudioMimeType)
        assertTrue(snapshot.assistantAudioChunks.isEmpty())
    }

    @Test
    fun queueStateCountsOnlyActiveAndQueuedActions() {
        val empty = WatchQueueState()
        assertEquals(0, empty.count)
        assertFalse(empty.isBusy)

        val busy = WatchQueueState(
            active = PendingWatchAction.timer("pause"),
            queued = listOf(PendingWatchAction.timer("reset"), PendingWatchAction.session(2))
        )
        assertEquals(3, busy.count)
        assertTrue(busy.isBusy)
    }

    @Test
    fun lifecycleRecognizesAllTerminalSpellingsCaseInsensitively() {
        listOf("succeeded", "success", "completed", "failed", "cancelled", "canceled", "COMPLETED")
            .forEach { assertTrue(WatchActionLifecycle("id", it).isTerminal) }
        assertFalse(WatchActionLifecycle("id", "accepted").isTerminal)
    }

    @Test
    fun failureClassificationSeparatesAuthTransientAndTerminal() {
        assertEquals(WatchFailureKind.AUTH, classifyWatchFailure(WatchApiException(401, "expired")))
        assertEquals(WatchFailureKind.TERMINAL, classifyWatchFailure(WatchApiException(403, "forbidden")))
        assertEquals(WatchFailureKind.TERMINAL, classifyWatchFailure(WatchApiException(409, "conflict")))
        assertEquals(WatchFailureKind.TRANSIENT, classifyWatchFailure(WatchApiException(429, "busy")))
        assertEquals(WatchFailureKind.TRANSIENT, classifyWatchFailure(WatchApiException(503, "down")))
        assertEquals(WatchFailureKind.TRANSIENT, classifyWatchFailure(IOException("offline")))
        assertEquals(WatchFailureKind.TRANSIENT, classifyWatchFailure(IllegalStateException("bad")))
    }
}
