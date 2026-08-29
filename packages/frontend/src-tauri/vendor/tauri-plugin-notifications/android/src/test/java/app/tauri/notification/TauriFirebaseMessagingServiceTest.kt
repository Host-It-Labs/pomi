package app.tauri.notification

import com.google.firebase.messaging.RemoteMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
class TauriFirebaseMessagingServiceTest {
  @Test
  fun dataOnlyPayloadKeepsNotificationMetadataAndGroup() {
    val message = RemoteMessage.Builder("sender")
      .setMessageId("message-1")
      .addData("title", "Timer complete")
      .addData("body", "Time for a break")
      .addData("channelId", "pomi_break_complete_v3")
      .addData("sound", "break_complete")
      .addData("icon", "ic_notification")
      .addData("color", "#10B981")
      .addData("tag", "break")
      .addData("notificationGroup", "pomi-timer")
      .addData("notificationId", "timer-completed:timer-1")
      .build()

    val notification = TauriFirebaseMessageMapper.toNotification(message)
    val pushData = TauriFirebaseMessageMapper.toPushData(message)

    assertNotNull(notification)
    assertEquals("Timer complete", notification?.title)
    assertEquals("Time for a break", notification?.body)
    assertEquals("pomi_break_complete_v3", notification?.channelId)
    assertEquals("break_complete", notification?.sound)
    assertEquals("ic_notification", notification?.icon)
    assertEquals("#10B981", notification?.iconColor)
    assertEquals("break", notification?.tag)
    assertEquals("pomi-timer", notification?.group)
    assertEquals("Timer complete", pushData["title"])
    assertEquals("ic_notification", pushData["icon"])
    assertEquals("#10B981", pushData["color"])
    assertEquals("break", pushData["tag"])
    assertEquals("pomi-timer", pushData["notificationGroup"])

    val sourceJson = JSONObject(notification?.sourceJson)
    assertEquals(
      "pomi-timer",
      sourceJson.getJSONObject("extra").getString("notificationGroup")
    )
  }

  @Test
  fun legacyIconColorDataStillMapsToNativeColor() {
    val message = RemoteMessage.Builder("sender")
      .addData("title", "Legacy color")
      .addData("body", "Legacy body")
      .addData("channelId", "pomi_timer_warnings_v3")
      .addData("sound", "timer_warning")
      .addData("icon", "ic_notification")
      .addData("iconColor", "#6366F1")
      .addData("tag", "warning")
      .build()

    val notification = TauriFirebaseMessageMapper.toNotification(message)
    val pushData = TauriFirebaseMessageMapper.toPushData(message)

    assertEquals("#6366F1", notification?.iconColor)
    assertEquals("#6366F1", pushData["color"])
  }

  @Test
  fun notificationPayloadUsesDataGroupWhenForegroundMessageHasNotificationFields() {
    val message = RemoteMessage.Builder("sender")
      .addData("title", "Fallback title")
      .addData("body", "Fallback body")
      .addData("notificationGroup", "pomi-task")
      .build()

    val notification = TauriFirebaseMessageMapper.toNotification(message)

    assertEquals("Fallback title", notification?.title)
    assertEquals("Fallback body", notification?.body)
    assertEquals("pomi-task", notification?.group)
    assertFalse(TauriFirebaseMessageMapper.shouldShowSystemNotification(true))
    assertTrue(TauriFirebaseMessageMapper.shouldShowSystemNotification(false))
  }

  @Test
  fun payloadWithoutTitleOrBodyDoesNotCreateNotification() {
    val message = RemoteMessage.Builder("sender")
      .addData("notificationGroup", "pomi-task")
      .build()

    assertNull(TauriFirebaseMessageMapper.toNotification(message))
  }
}
