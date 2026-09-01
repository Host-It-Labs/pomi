package app.tauri.notification

import android.app.Notification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class AndroidTimerProjectionTest {
  @Test
  fun parsesPrivacySafeRunningProjection() {
    val projection = AndroidTimerProjectionParser.parse(runningProjection(1, "public"))

    assertNotNull(projection)
    assertEquals(AndroidTimerStatus.RUNNING, projection?.status)
    assertEquals("work", projection?.timerType)
    assertEquals("Deep work", projection?.intentionTitle)
    assertEquals("🎯", projection?.intentionEmoji)
    assertEquals("🎯 Deep work", projection?.displayTitle())
    assertEquals(1730000000000L, projection?.endTimeMs)
    assertEquals(AndroidTimerAction.PAUSE, projection?.actions?.first()?.kind)
  }

  @Test
  fun stripsPrivateIntentionTitles() {
    val projection = AndroidTimerProjectionParser.parse(
        runningProjection(1, "private")
    )

    assertNull(projection?.intentionTitle)
    assertEquals("🎯", projection?.displayTitle())
  }

  @Test
  fun parsesPausedProjectionWithoutADeadline() {
    val projection = AndroidTimerProjectionParser.parse(
      """
      {
        "version": 1,
        "timerID": "timer-paused",
        "timerRevision": "revision-paused",
        "status": "paused",
        "timerType": "break",
        "pausedRemainingSeconds": 3661,
        "actions": [
          {
            "id": "native:timer-paused:revision-paused:resume",
            "kind": "resume",
            "expectedTimerRevision": "revision-paused",
            "isSupported": true,
            "deepLink": "pomi://timer-action?action=resume"
          }
        ],
        "deepLink": "pomi://timer"
      }
      """.trimIndent()
    )

    assertEquals(AndroidTimerStatus.PAUSED, projection?.status)
    assertNull(projection?.endTimeMs)
    assertEquals(3661L, projection?.pausedRemainingSeconds)
    assertEquals("1:01:01", AndroidTimerProjectionFormatter.formatRemaining(3661))
  }

  @Test
  fun rejectsUnknownVersionMissingTimingAndMismatchedActionFence() {
    assertNull(AndroidTimerProjectionParser.parse(runningProjection(2, "public")))
    assertNull(
      AndroidTimerProjectionParser.parse(
        runningProjection(1, "public").replace(
          "\"absoluteDeadline\": \"2024-10-27T03:33:20.000Z\",",
          ""
        )
      )
    )
    assertNull(
      AndroidTimerProjectionParser.parse(
        runningProjection(1, "public").replace(
          "\"expectedTimerRevision\": \"revision-12\"",
          "\"expectedTimerRevision\": \"stale\""
        )
      )
    )
  }

  @Test
  fun actionIntentCarriesTheProjectionFence() {
    val projection = AndroidTimerProjectionParser.parse(runningProjection(1, "public"))!!
    val action = projection.actions.first()
    val intent = buildTimerActionIntent(
      RuntimeEnvironment.getApplication(),
      projection,
      action
    )

    assertEquals(AndroidTimerAction.PAUSE.intentAction, intent.action)
    assertEquals("timer-1", intent.getStringExtra(EXTRA_TIMER_ID))
    assertEquals(action.id, intent.getStringExtra(EXTRA_TIMER_ACTION_ID))
    assertEquals("revision-12", intent.getStringExtra(EXTRA_TIMER_EXPECTED_REVISION))
    assertEquals("pause", intent.getStringExtra(EXTRA_TIMER_ACTION))
    assertEquals("work", intent.getStringExtra(EXTRA_TIMER_TYPE))
    assertTrue(isCurrentTimerAction(projection, intent))

    intent.putExtra(EXTRA_TIMER_EXPECTED_REVISION, "revision-old")
    assertFalse(isCurrentTimerAction(projection, intent))
  }

  @Test
  fun runningNotificationUsesDeadlineAndSafePublicVersion() {
    val projection = AndroidTimerProjectionParser.parse(runningProjection(1, "public"))!!
    val notification = buildTimerNotification(RuntimeEnvironment.getApplication(), projection)

    assertEquals(1730000000000L, notification.`when`)
    assertTrue(notification.extras.getBoolean("android.showChronometer"))
    assertTrue(notification.extras.getBoolean("android.chronometerCountDown"))
    assertEquals(1, notification.actions.size)
    assertEquals("🎯 Deep work", notification.extras.getCharSequence(Notification.EXTRA_TITLE))
    assertNotNull(notification.publicVersion)
    assertEquals(
      "Pomi Timer",
      notification.publicVersion?.extras?.getCharSequence(Notification.EXTRA_TITLE)
    )
  }

  private fun runningProjection(
    version: Int,
    titlePrivacy: String,
  ) = """
    {
      "version": $version,
      "timerID": "timer-1",
      "timerRevision": "revision-12",
      "status": "running",
      "timerType": "work",
      "absoluteDeadline": "2024-10-27T03:33:20.000Z",
      "intention": {
        "emoji": "🎯",
        "title": "  Deep\n work  ",
        "titlePrivacy": "$titlePrivacy"
      },
      "actions": [
        {
          "id": "native:timer-1:revision-12:pause",
          "kind": "pause",
          "expectedTimerRevision": "revision-12",
          "isSupported": true,
          "deepLink": "pomi://timer-action?action=pause"
        }
      ],
      "deepLink": "pomi://timer"
    }
  """.trimIndent()
}
