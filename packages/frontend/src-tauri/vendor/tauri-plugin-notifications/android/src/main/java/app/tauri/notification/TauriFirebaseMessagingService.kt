package app.tauri.notification

import app.tauri.plugin.JSObject
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

private const val NOTIFICATION_GROUP_DATA_KEY = "notificationGroup"
private const val TITLE_DATA_KEY = "title"
private const val BODY_DATA_KEY = "body"
private const val CHANNEL_ID_DATA_KEY = "channelId"
private const val SOUND_DATA_KEY = "sound"
private const val ICON_DATA_KEY = "icon"
private const val COLOR_DATA_KEY = "color"
private const val LEGACY_ICON_COLOR_DATA_KEY = "iconColor"
private const val TAG_DATA_KEY = "tag"
private const val NOTIFICATION_ID_DATA_KEY = "notificationId"

internal object TauriFirebaseMessageMapper {
  fun toPushData(message: RemoteMessage): MutableMap<String, Any> {
    val pushData = mutableMapOf<String, Any>()

    message.notification?.let { notification ->
      notification.title?.let { pushData[TITLE_DATA_KEY] = it }
      notification.body?.let { pushData[BODY_DATA_KEY] = it }
      notification.channelId?.let { pushData[CHANNEL_ID_DATA_KEY] = it }
      notification.sound?.let { pushData[SOUND_DATA_KEY] = it }
      notification.icon?.let { pushData[ICON_DATA_KEY] = it }
      notification.color?.let { pushData[COLOR_DATA_KEY] = it }
      notification.tag?.let { pushData[TAG_DATA_KEY] = it }
    }

    if (message.data.isNotEmpty()) {
      pushData["data"] = message.data
      listOf(
        TITLE_DATA_KEY,
        BODY_DATA_KEY,
        CHANNEL_ID_DATA_KEY,
        SOUND_DATA_KEY,
        ICON_DATA_KEY,
        COLOR_DATA_KEY,
        TAG_DATA_KEY,
        NOTIFICATION_ID_DATA_KEY
      ).forEach { key ->
        if (!pushData.containsKey(key)) {
          message.data[key]?.let { pushData[key] = it }
        }
      }
      if (!pushData.containsKey(COLOR_DATA_KEY)) {
        message.data[LEGACY_ICON_COLOR_DATA_KEY]?.let {
          pushData[COLOR_DATA_KEY] = it
        }
      }
      message.data[NOTIFICATION_GROUP_DATA_KEY]?.let {
        pushData[NOTIFICATION_GROUP_DATA_KEY] = it
      }
    }

    message.messageId?.let { pushData["messageId"] = it }
    message.from?.let { pushData["from"] = it }
    pushData["sentTime"] = message.sentTime

    return pushData
  }

  fun toNotification(message: RemoteMessage): Notification? {
    val notification = message.notification
    val data = message.data
    val title = notification?.title ?: data[TITLE_DATA_KEY]
    val body = notification?.body ?: data[BODY_DATA_KEY]

    if (title == null && body == null) {
      return null
    }

    val extra = if (data.isNotEmpty()) {
      JSObject().apply {
        data.forEach { (key, value) -> put(key, value) }
      }
    } else {
      null
    }

    return Notification().apply {
      id = data[NOTIFICATION_ID_DATA_KEY]
        ?.takeIf { it.isNotBlank() }
        ?.hashCode()
        ?: System.currentTimeMillis().toInt()
      this.title = title ?: ""
      this.body = body
      channelId = notification?.channelId ?: data[CHANNEL_ID_DATA_KEY]
      sound = notification?.sound ?: data[SOUND_DATA_KEY]
      icon = notification?.icon ?: data[ICON_DATA_KEY]
      iconColor =
        notification?.color ?: data[COLOR_DATA_KEY] ?: data[LEGACY_ICON_COLOR_DATA_KEY]
      tag = notification?.tag ?: data[TAG_DATA_KEY]
      group = data[NOTIFICATION_GROUP_DATA_KEY]
      this.extra = extra
      sourceJson = if (data.isNotEmpty()) {
        JSONObject().apply { put("extra", JSONObject(data)) }.toString()
      } else {
        null
      }
    }
  }

  fun shouldShowSystemNotification(appInForeground: Boolean): Boolean =
    !appInForeground
}

class TauriFirebaseMessagingService : FirebaseMessagingService() {

  override fun onNewToken(token: String) {
    super.onNewToken(token)
    // Store the token for later retrieval and trigger push-token event
    NotificationPlugin.instance?.handleNewToken(token)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)

    val pushData = TauriFirebaseMessageMapper.toPushData(message)
    // Trigger push-message event
    NotificationPlugin.instance?.triggerPushMessage(pushData)

    val notification = TauriFirebaseMessageMapper.toNotification(message)
    if (notification != null) {
      if (TauriFirebaseMessageMapper.shouldShowSystemNotification(
          NotificationPlugin.isAppInForeground()
        )
      ) {
        NotificationPlugin.showRemoteNotification(this, notification)
      } else {
        // Foreground delivery keeps the existing event path.
        NotificationPlugin.triggerNotification(notification, "push")
      }
    }
  }
}
