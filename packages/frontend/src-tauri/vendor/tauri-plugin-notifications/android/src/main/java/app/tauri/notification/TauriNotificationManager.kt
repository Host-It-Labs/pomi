package app.tauri.notification

import android.annotation.SuppressLint
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Build.VERSION.SDK_INT
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import app.tauri.Logger
import app.tauri.plugin.JSObject
import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONException
import org.json.JSONObject

// Action constants
const val NOTIFICATION_INTENT_KEY = "NotificationId"
const val NOTIFICATION_OBJ_INTENT_KEY = "LocalNotficationObject"
const val ACTION_INTENT_KEY = "NotificationUserAction"
const val NOTIFICATION_IS_REMOVABLE_KEY = "NotificationRepeating"
const val REMOTE_INPUT_KEY = "NotificationRemoteInput"
const val DEFAULT_NOTIFICATION_CHANNEL_ID = "default"
const val DEFAULT_PRESS_ACTION = "tap"
const val TAG = "NotificationsPlugin"

class TauriNotificationManager(
  private val storage: NotificationStorage,
  private val activity: Activity?,
  private val context: Context,
  private val config: PluginConfig?
) {
  private var defaultSoundID: Int = AssetUtils.RESOURCE_ID_ZERO_VALUE
  private var defaultSmallIconID: Int = AssetUtils.RESOURCE_ID_ZERO_VALUE

  fun handleNotificationActionPerformed(
    data: Intent,
    notificationStorage: NotificationStorage
  ): JSObject? {
    Logger.debug(Logger.tags(TAG), "Notification received: " + data.dataString)
    val notificationId =
      data.getIntExtra(NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
    if (notificationId == Int.MIN_VALUE) {
      Logger.debug(Logger.tags(TAG), "Activity started without notification attached")
      return null
    }
    val isRemovable =
      data.getBooleanExtra(NOTIFICATION_IS_REMOVABLE_KEY, true)
    if (isRemovable) {
      notificationStorage.deleteNotification(notificationId.toString())
    }
    val dataJson = JSObject()
    val results = RemoteInput.getResultsFromIntent(data)
    val input = results?.getCharSequence(REMOTE_INPUT_KEY)
    dataJson.put("inputValue", input?.toString())
    val menuAction = data.getStringExtra(ACTION_INTENT_KEY)
    dismissVisibleNotification(notificationId)
    dataJson.put("actionId", menuAction)
    var request: JSONObject? = null
    try {
      val notificationJsonString =
        data.getStringExtra(NOTIFICATION_OBJ_INTENT_KEY)
      if (notificationJsonString != null) {
        request = JSObject(notificationJsonString)
      }
    } catch (e: JSONException) {
      Logger.error(Logger.tags(TAG), "Failed to parse notification JSON: ${e.message}", e)
    }
    dataJson.put("notification", request)
    return dataJson
  }

  /**
   * Create notification channel
   */
  fun createNotificationChannel() {
    // Create the NotificationChannel, but only on API 26+ because
    // the NotificationChannel class is new and not in the support library
    if (SDK_INT >= Build.VERSION_CODES.O) {
      val name: CharSequence = "Default"
      val description = "Default"
      val importance = NotificationManager.IMPORTANCE_DEFAULT
      val channel = NotificationChannel(DEFAULT_NOTIFICATION_CHANNEL_ID, name, importance)
      channel.description = description
      val audioAttributes = AudioAttributes.Builder()
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .setUsage(AudioAttributes.USAGE_ALARM)
        .build()
      val soundUri = getDefaultSoundUrl(context)
      if (soundUri != null) {
        channel.setSound(soundUri, audioAttributes)
      }
      // Register the channel with the system; you can't change the importance
      // or other notification behaviors after this
      val notificationManager = context.getSystemService(
        NotificationManager::class.java
      )
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun trigger(notificationManager: NotificationManagerCompat, notification: Notification): Int {
    dismissVisibleNotification(notification.id)
    buildNotification(notificationManager, notification)

    return notification.id
  }

  fun schedule(notification: Notification): Int {
    val notificationManager = NotificationManagerCompat.from(context)
    return trigger(notificationManager, notification)
  }

  fun schedule(notifications: List<Notification>): List<Int> {
    val ids = mutableListOf<Int>()
    val notificationManager = NotificationManagerCompat.from(context)

    for (notification in notifications) {
      val id = trigger(notificationManager, notification)
      ids.add(id)
    }

    return ids
  }

  // TODO Progressbar support
  // TODO System categories (DO_NOT_DISTURB etc.)
  // TODO use NotificationCompat.MessagingStyle for latest API
  // TODO expandable notification NotificationCompat.MessagingStyle
  // TODO media style notification support NotificationCompat.MediaStyle
  @SuppressLint("MissingPermission")
  private fun buildNotification(
    notificationManager: NotificationManagerCompat,
    notification: Notification,
  ) {
    val channelId = notification.channelId ?: DEFAULT_NOTIFICATION_CHANNEL_ID
    val isAlertNotification = notification.schedule != null || notification.sound != null
    val priority =
      if (isAlertNotification) {
        NotificationCompat.PRIORITY_HIGH
      } else {
        NotificationCompat.PRIORITY_DEFAULT
      }
    val category =
      if (notification.schedule != null) {
        NotificationCompat.CATEGORY_ALARM
      } else {
        NotificationCompat.CATEGORY_REMINDER
      }
    val mBuilder = NotificationCompat.Builder(
      context, channelId
    )
      .setContentTitle(notification.title)
      .setContentText(notification.body)
      .setAutoCancel(notification.isAutoCancel)
      .setOngoing(notification.isOngoing)
      .setPriority(priority)
      .setCategory(category)
      .setGroupSummary(notification.isGroupSummary)
    if (notification.largeBody != null) {
      // support multiline text
      mBuilder.setStyle(
        NotificationCompat.BigTextStyle()
          .bigText(notification.largeBody)
          .setSummaryText(notification.summary)
      )
    } else if (notification.inboxLines != null) {
      val inboxStyle = NotificationCompat.InboxStyle()
      for (line in notification.inboxLines ?: listOf()) {
        inboxStyle.addLine(line)
      }
      inboxStyle.setBigContentTitle(notification.title)
      inboxStyle.setSummaryText(notification.summary)
      mBuilder.setStyle(inboxStyle)
    }
    val sound = notification.getSound(context, getDefaultSound(context))
    if (sound != null) {
      val soundUri = Uri.parse(sound)
      // Grant permission to use sound
      context.grantUriPermission(
        "com.android.systemui",
        soundUri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION
      )
      mBuilder.setSound(soundUri)
      mBuilder.setDefaults(android.app.Notification.DEFAULT_VIBRATE or android.app.Notification.DEFAULT_LIGHTS)
    } else {
      mBuilder.setDefaults(android.app.Notification.DEFAULT_ALL)
    }
    val group = notification.group
    if (group != null) {
      mBuilder.setGroup(group)
      if (notification.isGroupSummary) {
        mBuilder.setSubText(notification.summary)
      }
    }
    mBuilder.setVisibility(notification.visibility ?: NotificationCompat.VISIBILITY_PRIVATE)
    mBuilder.setOnlyAlertOnce(notification.isOngoing)
    mBuilder.setSmallIcon(notification.getSmallIcon(context, getDefaultSmallIcon(context)))
    mBuilder.setLargeIcon(notification.getLargeIcon(context))
    val iconColor = notification.getIconColor(config?.iconColor ?: "")
    if (iconColor.isNotEmpty()) {
      try {
        mBuilder.color = Color.parseColor(iconColor)
      } catch (ex: IllegalArgumentException) {
        throw Exception("Invalid color provided. Must be a hex string (ex: #ff0000")
      }
    }
    createActionIntents(notification, mBuilder)
    // notificationId is a unique int for each notification that you must define
    val buildNotification = mBuilder.build()
    if (notification.schedule != null) {
      Logger.warn(Logger.tags(TAG), "Scheduled local notifications are disabled.")
      return
    }

    notificationManager.notify(notification.id, buildNotification)
    try {
      NotificationPlugin.triggerNotification(notification)
    } catch (e: JSONException) {
      Logger.error(Logger.tags(TAG), "Failed to trigger notification event: ${e.message}", e)
    }
  }

  // Create intents for open/dismiss actions
  private fun createActionIntents(
    notification: Notification,
    mBuilder: NotificationCompat.Builder
  ) {
    // Open intent
    val intent = buildIntent(notification, DEFAULT_PRESS_ACTION)
    var flags = PendingIntent.FLAG_CANCEL_CURRENT
    if (SDK_INT >= Build.VERSION_CODES.S) {
      flags = flags or PendingIntent.FLAG_MUTABLE
    }
    val pendingIntent = PendingIntent.getActivity(context, notification.id, intent, flags)
    mBuilder.setContentIntent(pendingIntent)

    // Build action types
    val actionTypeId = notification.actionTypeId
    if (actionTypeId != null) {
      val actionGroup = storage.getActionGroup(actionTypeId)
      for (notificationAction in actionGroup) {
        // TODO Add custom icons to actions
        val actionIntent = buildIntent(notification, notificationAction!!.id)
        val actionPendingIntent = PendingIntent.getActivity(
          context,
          (notification.id) + notificationAction.id.hashCode(),
          actionIntent,
          flags
        )
        val actionBuilder: NotificationCompat.Action.Builder = NotificationCompat.Action.Builder(
          R.drawable.ic_transparent,
          notificationAction.title,
          actionPendingIntent
        )
        if (notificationAction.input == true) {
          val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(
            notificationAction.title
          ).build()
          actionBuilder.addRemoteInput(remoteInput)
        }
        mBuilder.addAction(actionBuilder.build())
      }
    }

    // Dismiss intent
    val dissmissIntent = Intent(
      context,
      NotificationDismissReceiver::class.java
    )
    dissmissIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
    dissmissIntent.putExtra(NOTIFICATION_INTENT_KEY, notification.id)
    dissmissIntent.putExtra(ACTION_INTENT_KEY, "dismiss")
    val schedule = notification.schedule
    dissmissIntent.putExtra(
      NOTIFICATION_IS_REMOVABLE_KEY,
      schedule == null || schedule.isRemovable()
    )
    flags = 0
    if (SDK_INT >= Build.VERSION_CODES.S) {
      flags = PendingIntent.FLAG_MUTABLE
    }
    val deleteIntent =
      PendingIntent.getBroadcast(context, notification.id, dissmissIntent, flags)
    mBuilder.setDeleteIntent(deleteIntent)
  }

  private fun buildIntent(notification: Notification, action: String?): Intent {
    val intent = if (activity != null) {
      Intent(context, activity.javaClass)
    } else {
      val packageName = context.packageName
      context.packageManager.getLaunchIntentForPackage(packageName)!!
    }
    intent.action = Intent.ACTION_MAIN
    intent.addCategory(Intent.CATEGORY_LAUNCHER)
    intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    intent.putExtra(NOTIFICATION_INTENT_KEY, notification.id)
    intent.putExtra(ACTION_INTENT_KEY, action)
    intent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, notification.sourceJson)
    val schedule = notification.schedule
    intent.putExtra(NOTIFICATION_IS_REMOVABLE_KEY, schedule == null || schedule.isRemovable())
    return intent
  }

  fun cancel(notifications: List<Int>) {
    for (id in notifications) {
      dismissVisibleNotification(id)
      storage.deleteNotification(id.toString())
    }
  }

  private fun dismissVisibleNotification(notificationId: Int) {
    val notificationManager = NotificationManagerCompat.from(
      context
    )
    notificationManager.cancel(notificationId)
  }

  fun areNotificationsEnabled(): Boolean {
    val notificationManager = NotificationManagerCompat.from(context)
    return notificationManager.areNotificationsEnabled()
  }

  private fun getDefaultSoundUrl(context: Context): Uri? {
    val soundId = getDefaultSound(context)
    return if (soundId != AssetUtils.RESOURCE_ID_ZERO_VALUE) {
      Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + context.packageName + "/" + soundId)
    } else null
  }

  private fun getDefaultSound(context: Context): Int {
    if (defaultSoundID != AssetUtils.RESOURCE_ID_ZERO_VALUE) return defaultSoundID
    var resId: Int = AssetUtils.RESOURCE_ID_ZERO_VALUE
    val soundConfigResourceName = AssetUtils.getResourceBaseName(config?.sound)
    if (soundConfigResourceName != null) {
      resId = AssetUtils.getResourceID(context, soundConfigResourceName, "raw")
    }
    defaultSoundID = resId
    return resId
  }

  private fun getDefaultSmallIcon(context: Context): Int {
    if (defaultSmallIconID != AssetUtils.RESOURCE_ID_ZERO_VALUE) return defaultSmallIconID
    var resId: Int = AssetUtils.RESOURCE_ID_ZERO_VALUE
    val smallIconConfigResourceName = AssetUtils.getResourceBaseName(config?.icon)
    if (smallIconConfigResourceName != null) {
      resId = AssetUtils.getResourceID(context, smallIconConfigResourceName, "drawable")
    }
    if (resId == AssetUtils.RESOURCE_ID_ZERO_VALUE) {
      resId = android.R.drawable.ic_dialog_info
    }
    defaultSmallIconID = resId
    return resId
  }
}

class NotificationDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val intExtra =
      intent.getIntExtra(NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
    if (intExtra == Int.MIN_VALUE) {
      Logger.error(Logger.tags(TAG), "Invalid notification dismiss operation", null)
      return
    }
    val isRemovable =
      intent.getBooleanExtra(NOTIFICATION_IS_REMOVABLE_KEY, true)
    if (isRemovable) {
      val notificationStorage = NotificationStorage(context, ObjectMapper())
      notificationStorage.deleteNotification(intExtra.toString())
    }
  }
}
