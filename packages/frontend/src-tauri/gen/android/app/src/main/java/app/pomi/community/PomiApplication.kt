package app.pomi.community

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.graphics.Color
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build

class PomiApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NotificationManager::class.java)

            val alertAudioAttributes = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build()

            val channels = listOf(
                createAlertChannel(
                    CHANNEL_ID_WORK_COMPLETE,
                    "Work Session Complete",
                    "Notifications when work sessions complete",
                    "work_complete",
                    Color.BLUE,
                    true,
                    alertAudioAttributes
                ),
                createAlertChannel(
                    CHANNEL_ID_BREAK_COMPLETE,
                    "Break Complete",
                    "Notifications when breaks complete",
                    "break_complete",
                    Color.GREEN,
                    true,
                    alertAudioAttributes
                ),
                createAlertChannel(
                    CHANNEL_ID_WARNINGS,
                    "Timer Warnings",
                    "Warning notifications before timer completes",
                    "timer_warning",
                    Color.YELLOW,
                    false,
                    alertAudioAttributes
                ),
                createAlertChannel(
                    CHANNEL_ID_SESSION_END,
                    "Session End",
                    "Notifications when session completes",
                    "session_end",
                    Color.parseColor("#9333ea"),
                    true,
                    alertAudioAttributes
                ),
                NotificationChannel(
                    CHANNEL_ID_GENERAL,
                    "General Notifications",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "General Pomi notifications"
                    enableVibration(true)
                    setShowBadge(true)
                }
            )

            notificationManager.createNotificationChannels(channels)
        }
    }

    private fun createAlertChannel(
        id: String,
        name: String,
        descriptionText: String,
        soundResourceName: String,
        lightColorValue: Int,
        showBadge: Boolean,
        audioAttributes: AudioAttributes
    ): NotificationChannel {
        return NotificationChannel(
            id,
            name,
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = descriptionText
            enableVibration(true)
            setShowBadge(showBadge)
            enableLights(true)
            lightColor = lightColorValue
            setSound(
                Uri.parse("android.resource://${packageName}/raw/${soundResourceName}"),
                audioAttributes
            )
        }
    }

    companion object {
        const val CHANNEL_ID_WORK_COMPLETE = "pomi_work_complete_alarm_v3"
        const val CHANNEL_ID_BREAK_COMPLETE = "pomi_break_complete_alarm_v3"
        const val CHANNEL_ID_WARNINGS = "pomi_warnings_alarm_v3"
        const val CHANNEL_ID_SESSION_END = "pomi_session_end_alarm_v3"
        const val CHANNEL_ID_GENERAL = "pomi_notifications"
    }
}
