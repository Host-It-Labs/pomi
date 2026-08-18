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
private const val TIMER_SYNC_NOTIFICATION_ID = 2147483001
private const val TIMER_SYNC_CHANNEL_ID = "pomi_background_sync"

private const val ACTION_START = "app.tauri.notification.timer_sync.START"

class AndroidTimerSyncForegroundService : Service() {
  override fun onCreate() {
    super.onCreate()
    isRunning = true
    createForegroundNotificationChannel()
    startAsForegroundService()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!canRunForegroundSync(this)) {
      stopSelf()
      return START_NOT_STICKY
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
      "Background Timer Sync",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Keeps timer notifications ready"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  @SuppressLint("InlinedApi")
  private fun startAsForegroundService() {
    val launchIntent =
      packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or immutablePendingIntentFlag()
    val contentIntent = PendingIntent.getActivity(
      this,
      TIMER_SYNC_NOTIFICATION_ID,
      launchIntent,
      flags
    )
    val notification = NotificationCompat.Builder(this, TIMER_SYNC_CHANNEL_ID)
      .setContentTitle("Pomi background sync")
      .setContentText("Timer sync active")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceCompat.startForeground(
        this,
        TIMER_SYNC_NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
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

    fun stop(context: Context, clearOptIn: Boolean, clearAuth: Boolean): JSObject {
      val editor = context.getSharedPreferences(TIMER_SYNC_PREFS, Context.MODE_PRIVATE).edit()
      if (clearOptIn) {
        editor.putBoolean(TIMER_SYNC_ENABLED, false)
      }
      if (clearAuth) {
        editor.putBoolean(TIMER_SYNC_AUTH_READY, false)
      }
      editor.apply()

      isRunning = false
      context.stopService(Intent(context, AndroidTimerSyncForegroundService::class.java))
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

    private fun immutablePendingIntentFlag(): Int {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        return 0
      }

      return PendingIntent.FLAG_IMMUTABLE
    }
  }
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
