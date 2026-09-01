package app.tauri.notification

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.UserManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import app.tauri.plugin.JSObject

private const val TIMER_SYNC_PREFS = "pomi_android_timer_sync"
private const val TIMER_SYNC_ENABLED = "enabled"
private const val TIMER_SYNC_AUTH_READY = "auth_ready"
private const val TIMER_SYNC_PROJECTION = "timer_projection_v1"
private const val TIMER_SYNC_NOTIFICATION_ID = 2147483001
private const val TIMER_SYNC_CHANNEL_ID = "pomi_timer_foreground"

private const val ACTION_START = "app.tauri.notification.timer_sync.START"
private const val ACTION_UPDATE = "app.tauri.notification.timer_sync.UPDATE"
internal const val ACTION_TIMER_ACTION = "app.tauri.notification.timer_sync.ACTION"
internal const val EXTRA_TIMER_PROJECTION = "app.tauri.notification.extra.TIMER_PROJECTION"
internal const val EXTRA_TIMER_ID = "app.tauri.notification.extra.TIMER_ID"
internal const val EXTRA_TIMER_ACTION_ID = "app.tauri.notification.extra.ACTION_ID"
internal const val EXTRA_TIMER_EXPECTED_REVISION =
  "app.tauri.notification.extra.EXPECTED_REVISION"
internal const val EXTRA_TIMER_ACTION = "app.tauri.notification.extra.ACTION"
internal const val EXTRA_TIMER_TYPE = "app.tauri.notification.extra.TIMER_TYPE"

private const val TIMER_ACTION_REQUEST_CODE = 2147482800

class AndroidTimerSyncForegroundService : Service() {
  override fun onCreate() {
    super.onCreate()
    isRunning = true
    createForegroundNotificationChannel()
    updateForegroundNotification()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!canRunForegroundSync(this)) {
      stopSelf()
      return START_NOT_STICKY
    }

    if (AndroidTimerAction.fromIntentAction(intent?.action) != null) {
      handleTimerAction(intent)
      return START_STICKY
    }

    intent?.getStringExtra(EXTRA_TIMER_PROJECTION)?.let { rawProjection ->
      persistTimerProjection(this, rawProjection)
    }
    if (intent?.action == ACTION_UPDATE || intent?.action == ACTION_START || intent == null) {
      updateForegroundNotification()
    }

    return START_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createForegroundNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val channel = NotificationChannel(
      TIMER_SYNC_CHANNEL_ID,
      "Pomi Timer",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shows the active timer"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  @SuppressLint("InlinedApi")
  private fun updateForegroundNotification() {
    val notification = buildTimerNotification(this, readProjection(this))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceCompat.startForeground(
        this,
        TIMER_SYNC_NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      )
      return
    }

    ServiceCompat.startForeground(
      this,
      TIMER_SYNC_NOTIFICATION_ID,
      notification,
      0
    )
  }

  private fun handleTimerAction(intent: Intent?) {
    val action = AndroidTimerAction.fromIntentAction(intent?.action) ?: return
    val projection = readProjection(this) ?: return
    val projectedAction = projection.action(action) ?: return

    if (!isCurrentTimerAction(projection, intent, action)) {
      return
    }

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launchIntent.action = ACTION_TIMER_ACTION
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    launchIntent.putExtra(EXTRA_TIMER_ID, projection.timerId)
    launchIntent.putExtra(EXTRA_TIMER_ACTION_ID, projectedAction.id)
    launchIntent.putExtra(EXTRA_TIMER_EXPECTED_REVISION, projection.revision)
    launchIntent.putExtra(EXTRA_TIMER_ACTION, action.wireValue)
    launchIntent.putExtra(EXTRA_TIMER_TYPE, projection.timerType)
    startActivity(launchIntent)
  }

  companion object {
    @Volatile
    private var isRunning = false

    fun status(context: Context): JSObject {
      val prefs = context.getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE)
      return JSObject().apply {
        put("enabled", prefs.getBoolean(TIMER_SYNC_ENABLED, false))
        put("running", isRunning)
      }
    }

    fun start(context: Context): JSObject {
      context.getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(TIMER_SYNC_ENABLED, true)
        .putBoolean(TIMER_SYNC_AUTH_READY, true)
        .apply()

      val intent = Intent(context, AndroidTimerSyncForegroundService::class.java)
        .setAction(ACTION_START)
      ContextCompat.startForegroundService(context, intent)
      return status(context)
    }

    fun setTimerProjection(context: Context, rawProjection: String): Boolean {
      if (!persistTimerProjection(context, rawProjection)) return false
      val applicationContext = context.applicationContext
      if (isRunning) {
        applicationContext.startService(
          Intent(applicationContext, AndroidTimerSyncForegroundService::class.java)
            .setAction(ACTION_UPDATE)
        )
      } else {
        ContextCompat.startForegroundService(
          applicationContext,
          Intent(applicationContext, AndroidTimerSyncForegroundService::class.java)
            .setAction(ACTION_UPDATE)
        )
      }
      return true
    }

    fun clearTimerProjection(context: Context) {
      context.getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE)
        .edit()
        .remove(TIMER_SYNC_PROJECTION)
        .commit()
      if (isRunning) {
        if (shouldRunBackgroundSync(context)) {
          context.startService(
            Intent(context, AndroidTimerSyncForegroundService::class.java)
              .setAction(ACTION_UPDATE)
          )
        } else {
          isRunning = false
          context.stopService(Intent(context, AndroidTimerSyncForegroundService::class.java))
        }
      }
    }

    internal fun readProjection(context: Context): AndroidTimerProjection? {
      val raw = context
        .getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE)
        .getString(TIMER_SYNC_PROJECTION, null)
      return AndroidTimerProjectionParser.parse(raw)
    }

    fun stop(context: Context, clearOptIn: Boolean, clearAuth: Boolean): JSObject {
      val editor = context.getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE).edit()
      if (clearOptIn) {
        editor.putBoolean(TIMER_SYNC_ENABLED, false)
      }
      if (clearAuth) {
        editor.putBoolean(TIMER_SYNC_AUTH_READY, false)
      }
      editor.apply()

      if (readProjection(context) == null) {
        isRunning = false
        context.stopService(Intent(context, AndroidTimerSyncForegroundService::class.java))
      } else if (isRunning) {
        context.startService(
          Intent(context, AndroidTimerSyncForegroundService::class.java)
            .setAction(ACTION_UPDATE)
        )
      }
      return status(context)
    }

    fun maybeStart(context: Context) {
      val prefs = context.getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE)
      if (
        prefs.getBoolean(TIMER_SYNC_ENABLED, false) &&
        prefs.getBoolean(TIMER_SYNC_AUTH_READY, false) &&
        canRunForegroundSync(context)
      ) {
        ContextCompat.startForegroundService(
          context,
          Intent(context, AndroidTimerSyncForegroundService::class.java)
        )
      }
    }

    private fun canRunForegroundSync(context: Context): Boolean {
      return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    private fun shouldRunBackgroundSync(context: Context): Boolean {
      val prefs = context.getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE)
      return prefs.getBoolean(TIMER_SYNC_ENABLED, false) &&
        prefs.getBoolean(TIMER_SYNC_AUTH_READY, false) &&
        canRunForegroundSync(context)
    }
  }
}

internal fun buildTimerNotification(
  context: Context,
  projection: AndroidTimerProjection?,
): android.app.Notification {
  val running = projection?.status == AndroidTimerStatus.RUNNING
  val builder = NotificationCompat.Builder(context, TIMER_SYNC_CHANNEL_ID)
    .setContentTitle(projection?.displayTitle() ?: "Pomi Timer")
    .setContentText(
      projection?.let { AndroidTimerProjectionFormatter.stateText(it.status) }
        ?: "Timer sync active"
    )
    .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setShowWhen(projection != null)
    .setPriority(NotificationCompat.PRIORITY_LOW)
    .setCategory(NotificationCompat.CATEGORY_PROGRESS)
    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
    .setContentIntent(buildTimerContentPendingIntent(context))
    .setPublicVersion(buildPublicTimerNotification(context, running))

  if (projection != null) {
    builder
      .setShowWhen(projection.endTimeMs != null)
      .setUsesChronometer(running)
      .setChronometerCountDown(running)
    projection.endTimeMs?.let(builder::setWhen)
    if (!running && projection.pausedRemainingSeconds != null) {
      builder.setContentText(
        "${AndroidTimerProjectionFormatter.stateText(projection.status)} · " +
          AndroidTimerProjectionFormatter.formatRemaining(projection.pausedRemainingSeconds)
      )
    }

    projection.actions.filter { it.isSupported }.forEach { action ->
      builder.addAction(
        NotificationCompat.Action.Builder(
          action.kind.icon,
          action.kind.label,
          buildTimerActionPendingIntent(context, projection, action)
        ).build()
      )
    }
  }

  return builder.build()
}

private fun buildPublicTimerNotification(
  context: Context,
  running: Boolean,
): android.app.Notification = NotificationCompat.Builder(context, TIMER_SYNC_CHANNEL_ID)
  .setContentTitle("Pomi Timer")
  .setContentText(if (running) "Timer active" else "Timer paused")
  .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
  .setOngoing(true)
  .setOnlyAlertOnce(true)
  .setShowWhen(false)
  .setPriority(NotificationCompat.PRIORITY_LOW)
  .setCategory(NotificationCompat.CATEGORY_PROGRESS)
  .build()

private fun buildTimerContentPendingIntent(context: Context): PendingIntent {
  val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    ?: Intent()
  return PendingIntent.getActivity(
    context,
    TIMER_SYNC_NOTIFICATION_ID,
    launchIntent,
    PendingIntent.FLAG_UPDATE_CURRENT or immutablePendingIntentFlagForAction()
  )
}

internal fun buildTimerActionIntent(
  context: Context,
  projection: AndroidTimerProjection,
  action: AndroidTimerActionProjection,
): Intent = Intent(context, AndroidTimerSyncForegroundService::class.java)
  .setAction(action.kind.intentAction)
  .putExtra(EXTRA_TIMER_ID, projection.timerId)
  .putExtra(EXTRA_TIMER_ACTION_ID, action.id)
  .putExtra(EXTRA_TIMER_EXPECTED_REVISION, projection.revision)
  .putExtra(EXTRA_TIMER_ACTION, action.kind.wireValue)
  .putExtra(EXTRA_TIMER_TYPE, projection.timerType)

internal fun isCurrentTimerAction(
  projection: AndroidTimerProjection,
  intent: Intent?,
  action: AndroidTimerAction? = null,
): Boolean {
  val resolvedAction = action ?: AndroidTimerAction.fromIntentAction(intent?.action) ?: return false
  val projectedAction = projection.action(resolvedAction) ?: return false
  return projection.timerId == intent?.getStringExtra(EXTRA_TIMER_ID) &&
    projection.revision == intent.getStringExtra(EXTRA_TIMER_EXPECTED_REVISION) &&
    projectedAction.id == intent.getStringExtra(EXTRA_TIMER_ACTION_ID) &&
    resolvedAction.wireValue == intent.getStringExtra(EXTRA_TIMER_ACTION) &&
    projection.timerType == intent.getStringExtra(EXTRA_TIMER_TYPE)
}

private fun buildTimerActionPendingIntent(
  context: Context,
  projection: AndroidTimerProjection,
  action: AndroidTimerActionProjection,
): PendingIntent = PendingIntent.getService(
  context,
  TIMER_ACTION_REQUEST_CODE + action.kind.ordinal,
  buildTimerActionIntent(context, projection, action),
  PendingIntent.FLAG_CANCEL_CURRENT or immutablePendingIntentFlagForAction()
)

private fun immutablePendingIntentFlagForAction(): Int =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

private fun persistTimerProjection(context: Context, rawProjection: String): Boolean {
  if (AndroidTimerProjectionParser.parse(rawProjection) == null) return false
  return context.applicationContext
    .getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE)
    .edit()
    .putString(TIMER_SYNC_PROJECTION, rawProjection)
    .commit()
}

class AndroidTimerSyncBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      val userManager = context.getSystemService(UserManager::class.java)
      if (userManager == null || !userManager.isUserUnlocked) {
        return
      }
    }

    AndroidTimerSyncForegroundService.maybeStart(context)
  }
}
