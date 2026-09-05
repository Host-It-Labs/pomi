package app.tauri.notification

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.Locale

internal const val TIMER_PROJECTION_VERSION = 1

internal enum class AndroidTimerStatus {
  RUNNING,
  PAUSED;

  companion object {
    fun parse(value: String?): AndroidTimerStatus? = when (value?.lowercase()) {
      "running" -> RUNNING
      "paused" -> PAUSED
      else -> null
    }
  }
}

internal enum class AndroidTimerAction(
  val wireValue: String,
  val label: String,
  val icon: Int,
) {
  PAUSE("pause", "Pause", android.R.drawable.ic_media_pause),
  RESUME("resume", "Resume", android.R.drawable.ic_media_play),
  ADD_FIVE("addFive", "+5 min", android.R.drawable.ic_input_add),
  SKIP("skip", "Skip", android.R.drawable.ic_media_next);

  val intentAction: String
    get() = "$TIMER_ACTION_PREFIX.$wireValue"

  companion object {
    fun parse(value: String?): AndroidTimerAction? = values()
      .firstOrNull { it.wireValue == value }

    fun fromIntentAction(value: String?): AndroidTimerAction? = values()
      .firstOrNull { it.intentAction == value }
  }
}

internal data class AndroidTimerActionProjection(
  val id: String,
  val kind: AndroidTimerAction,
  val expectedTimerRevision: String,
  val isSupported: Boolean,
  val deepLink: String,
)

internal data class AndroidTimerProjection(
  val timerId: String,
  val revision: String,
  val timerType: String,
  val status: AndroidTimerStatus,
  val endTimeMs: Long?,
  val pausedRemainingSeconds: Long?,
  val intentionTitle: String?,
  val intentionEmoji: String?,
  val actions: List<AndroidTimerActionProjection>,
) {
  fun displayTitle(): String = AndroidTimerProjectionFormatter.displayTitle(
    intentionEmoji,
    intentionTitle,
    timerType,
  )

  fun action(kind: AndroidTimerAction): AndroidTimerActionProjection? =
    actions.firstOrNull { it.kind == kind && it.isSupported }
}

internal object AndroidTimerProjectionParser {
  fun parse(raw: String?): AndroidTimerProjection? {
    if (raw.isNullOrBlank()) return null

    return try {
      val json = JSONObject(raw)
      if (json.getInt("version") != TIMER_PROJECTION_VERSION) return null

      val timerId = required(json, "timerID") ?: return null
      val revision = required(json, "timerRevision") ?: return null
      val timerType = required(json, "timerType")
        ?.takeIf { it == "work" || it == "break" || it == "longBreak" }
        ?: return null
      val status = AndroidTimerStatus.parse(json.optString("status")) ?: return null
      val endTimeMs = json.optString("absoluteDeadline")
        .takeIf(String::isNotBlank)
        ?.let { Instant.parse(it).toEpochMilli() }
      val pausedRemainingSeconds = if (json.has("pausedRemainingSeconds")) {
        json.getLong("pausedRemainingSeconds").takeIf { it >= 0 }
      } else {
        null
      }

      if (
        (status == AndroidTimerStatus.RUNNING && endTimeMs == null) ||
        (status == AndroidTimerStatus.PAUSED && pausedRemainingSeconds == null)
      ) {
        return null
      }

      val intention = json.optJSONObject("intention")
      val titlePrivacy = intention?.optString("titlePrivacy")
      val title = if (titlePrivacy == "public") {
        AndroidTimerProjectionFormatter.sanitizeTitle(intention.optString("title"))
      } else {
        null
      }
      val emoji = AndroidTimerProjectionFormatter.sanitizeEmoji(
        intention?.optString("emoji")
      )
      val actions = parseActions(json.getJSONArray("actions"), revision)
      if (actions.isEmpty()) return null

      AndroidTimerProjection(
        timerId = timerId,
        revision = revision,
        timerType = timerType,
        status = status,
        endTimeMs = endTimeMs,
        pausedRemainingSeconds = pausedRemainingSeconds,
        intentionTitle = title,
        intentionEmoji = emoji,
        actions = actions,
      )
    } catch (_: Exception) {
      null
    }
  }

  private fun parseActions(
    json: JSONArray,
    revision: String,
  ): List<AndroidTimerActionProjection> {
    val actions = mutableListOf<AndroidTimerActionProjection>()
    val ids = mutableSetOf<String>()
    for (index in 0 until json.length()) {
      val item = json.getJSONObject(index)
      val id = required(item, "id") ?: return emptyList()
      val kind = AndroidTimerAction.parse(item.optString("kind")) ?: return emptyList()
      val expectedRevision = required(item, "expectedTimerRevision") ?: return emptyList()
      val deepLink = required(item, "deepLink") ?: return emptyList()
      if (
        expectedRevision != revision ||
        !deepLink.startsWith("pomi://") ||
        !ids.add(id)
      ) {
        return emptyList()
      }
      actions += AndroidTimerActionProjection(
        id = id,
        kind = kind,
        expectedTimerRevision = expectedRevision,
        isSupported = item.optBoolean("isSupported", false),
        deepLink = deepLink,
      )
    }
    return actions
  }

  private fun required(json: JSONObject, key: String): String? =
    json.optString(key).trim().takeIf { it.isNotEmpty() }?.take(MAX_ID_LENGTH)

  private const val MAX_ID_LENGTH = 128
}

internal object AndroidTimerProjectionFormatter {
  private const val MAX_TITLE_LENGTH = 80
  private const val MAX_EMOJI_LENGTH = 16

  fun sanitizeTitle(value: String?): String? = sanitize(value, MAX_TITLE_LENGTH)

  fun sanitizeEmoji(value: String?): String? = sanitize(value, MAX_EMOJI_LENGTH)

  fun displayTitle(emoji: String?, title: String?, timerType: String): String {
    return listOfNotNull(emoji, title).joinToString(" ").ifBlank {
      when (timerType) {
        "break" -> "Break"
        "longBreak" -> "Long break"
        else -> "Work"
      }
    }
  }

  fun stateText(status: AndroidTimerStatus): String = when (status) {
    AndroidTimerStatus.RUNNING -> "Running"
    AndroidTimerStatus.PAUSED -> "Paused"
  }

  fun formatRemaining(seconds: Long): String {
    val totalSeconds = seconds.coerceAtLeast(0)
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val remainingSeconds = totalSeconds % 60
    return if (hours > 0) {
      String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, remainingSeconds)
    } else {
      String.format(Locale.ROOT, "%02d:%02d", minutes, remainingSeconds)
    }
  }

  private fun sanitize(value: String?, maxLength: Int): String? {
    val sanitized = value
      ?.filterNot(Char::isISOControl)
      ?.replace(Regex("\\s+"), " ")
      ?.trim()
      ?.take(maxLength)
      .orEmpty()
    return sanitized.ifEmpty { null }
  }
}

private const val TIMER_ACTION_PREFIX = "app.tauri.notification.timer_action"
