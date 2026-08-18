package app.pomi.community.watch

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WatchSerializationTest {
    @Test
    fun completeStatusPayloadMapsNullableNestedModelsAndDefaults() {
        val status = JSONObject(
            """{
              "serverNowMs":100000,
              "taskMode":"intention",
              "timer":{
                "id":"timer-1","type":"work","status":"running","duration":60000,
                "remainingTime":45000,"endsAtMs":145000,"progress":1.4,
                "intentions":[{"slug":"focus","title":"Focus","emoji":"F","subSlug":"code","subTitle":"Code","subEmoji":"C"}],
                "sessionPosition":2,"sessionTotal":4,"stackedSessions":3,"isExtension":true
              },
              "assistant":{"assistantEnabled":true,"speechCaptureEnabled":true,"aiTaskCaptureEnabled":false,"usageBudgetRemainingUsd":1.5},
              "timerControls":{"canStartOrResume":false,"canPause":true,"canAddFiveMinutes":true,"canReset":true,"canSkip":true,"canStartLongBreak":true,"requiresIntentionSelection":false,"intentionRequireSelection":true,"intentionMultiSelect":true,"advancedSkip":true,"sessionsEnabled":true},
              "tasks":[{"id":"task-1","title":"Ship","priority":"urgent","dueDate":null,"dueTime":"10:00","intentionTitle":"Focus","intentionEmoji":"F","subIntentionSlug":"code","subIntentionTitle":"Code","subIntentionEmoji":"C","isFocused":true,"isLinkedToTimer":true,"isOverdue":false}],
              "totalVisibleTasks":1,"totalActiveTasks":2
            }"""
        ).toWatchStatus()

        assertEquals("en", status.language)
        assertEquals("timer-1", status.timer?.id)
        assertEquals(1f, status.timer?.progress ?: 0f, 0.0001f)
        assertEquals("code", status.timer?.intentions?.single()?.subSlug)
        assertEquals(10, status.assistant.recordingMaxMinutes)
        assertTrue(status.assistant.canRecord)
        assertEquals("work", status.tasks.single().timerType)
        assertEquals("F Focus / C Code", status.tasks.single().intentionLabel())
        assertEquals("Urgent", status.tasks.single().priorityLabel())
        assertEquals(2, status.totalActiveTasks)
    }

    @Test
    fun nullableStatusFieldsAndUnlimitedAssistantLimitRemainNull() {
        val status = JSONObject(
            """{
              "serverNowMs":0,"taskMode":"general","timer":null,
              "assistant":{"assistantEnabled":false,"speechCaptureEnabled":false,"aiTaskCaptureEnabled":false,"usageBudgetRemainingUsd":null,"assistantRecordingMaxMinutes":null},
              "timerControls":{},"tasks":[],"totalVisibleTasks":0,"totalActiveTasks":0
            }"""
        ).toWatchStatus()

        assertNull(status.timer)
        assertNull(status.assistant.usageBudgetRemainingUsd)
        assertNull(status.assistant.recordingMaxMinutes)
        assertFalse(status.assistant.canRecord)
    }

    @Test
    fun intentionAndAssistantPayloadsMapOptionalArraysAndAudio() {
        val intentions = JSONArray(
            """[{"slug":"focus","title":"Focus","emoji":"F","type":"work","subIntentions":[{"slug":"code","title":"Code","emoji":"C"}]},{"slug":"admin","title":"Admin","emoji":"A","type":"work"}]"""
        ).toWatchIntentionOptions()
        assertEquals("code", intentions.first().subIntentions.single().slug)
        assertTrue(intentions.last().subIntentions.isEmpty())

        val voice = JSONObject(
            """{"transcript":"hello","message":"done","actions":["start","task"],"costUsd":0.2,"usedFallback":true,"spokenAudioBase64":"audio","spokenAudioMimeType":"audio/mp3"}"""
        ).toAssistantVoiceResult()
        assertEquals(listOf("start", "task"), voice.actions)
        assertEquals("audio/mp3", voice.spokenAudioMimeType)
        assertTrue(voice.usedFallback)
    }

    @Test
    fun everyPendingActionSerializesToItsGatewayContract() {
        val timer = PendingWatchAction(
            id = "timer-command",
            kind = "timer",
            action = "skip",
            timerType = "work",
            skipLogMode = "record"
        ).toGatewayRequest()
        assertEquals("timer", timer.getString("kind"))
        assertEquals("skip", timer.getString("operation"))
        assertEquals("record", timer.getString("requestedLogMode"))

        val intentions = PendingWatchAction(
            id = "intentions-command",
            kind = "intentions",
            action = "setIntentions",
            timerType = "work",
            intentionSlugs = listOf("focus"),
            subIntentions = mapOf("focus" to "code")
        ).toGatewayRequest()
        assertEquals("focus", intentions.getJSONArray("intentions").getString(0))
        assertEquals("code", intentions.getJSONObject("subIntentions").getString("focus"))

        val startWithIntentions = PendingWatchAction(
            id = "start-intentions-command",
            kind = "intentions",
            action = "startOrResume",
            timerType = "work",
            intentionSlugs = listOf("focus")
        ).toGatewayRequest()
        assertEquals("createOrResume", startWithIntentions.getString("operation"))
        assertEquals("focus", startWithIntentions.getJSONArray("intentions").getString(0))

        val session = PendingWatchAction(id = "session-command", kind = "session", position = 2).toGatewayRequest()
        assertEquals("setSessionPosition", session.getString("operation"))

        val task = PendingWatchAction.completeTask("task-1").toGatewayRequest()
        assertEquals("tasks", task.getString("kind"))
        assertEquals("task-1", task.getString("taskId"))

        val audioAction = PendingWatchAction.assistantVoice("audio", "audio/webm")
        val audio = audioAction.toGatewayRequest()
        assertEquals("commitPreparedVoiceCommand", audio.getString("operation"))
        assertEquals(audioAction.id, audio.getJSONObject("payload").getString("preparationId"))
        assertFalse(audio.getJSONObject("payload").has("audioBase64"))

        val transcriptAction = PendingWatchAction.assistantTranscript("do it", 0.3, "debug-1")
        val transcript = transcriptAction.toGatewayRequest()
        assertEquals(transcriptAction.id, transcript.getJSONObject("payload").getString("preparationId"))
        assertFalse(transcript.getJSONObject("payload").has("transcript"))
    }

    @Test(expected = IllegalStateException::class)
    fun unsupportedActionKindsFailBeforeNetworkSubmission() {
        PendingWatchAction(kind = "unknown").toGatewayRequest()
    }

    @Test
    fun lifecycleDeserializerReadsCanonicalEnvelopeAndHandlesMalformedResponses() {
        val lifecycle = """{"actionId":"action-1","status":"failed","error":{"message":"late"},"outcomeUnknown":true,"result":{"ok":true}}"""
            .toWatchActionLifecycle("default", "accepted")
        assertEquals("action-1", lifecycle.id)
        assertEquals("failed", lifecycle.status)
        assertEquals("late", lifecycle.message)
        assertTrue(lifecycle.outcomeUnknown)
        assertTrue(lifecycle.result?.getBoolean("ok") == true)

        assertEquals(WatchActionLifecycle("default", "accepted"), "".toWatchActionLifecycle("default", "accepted"))
        assertEquals(WatchActionLifecycle("default", "accepted"), "not-json".toWatchActionLifecycle("default", "accepted"))
    }
}
