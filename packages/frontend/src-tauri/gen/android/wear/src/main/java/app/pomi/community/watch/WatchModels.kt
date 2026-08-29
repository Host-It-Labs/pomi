package app.pomi.community.watch

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

data class WatchStatus(
    val serverNowMs: Long,
    val taskMode: String,
    val language: String,
    val timer: WatchTimer?,
    val assistant: WatchAssistant,
    val timerControls: WatchTimerControls,
    val tasks: List<WatchTask>,
    val totalVisibleTasks: Int,
    val totalActiveTasks: Int
)

data class WatchTimer(
    val id: String,
    val type: String,
    val status: String,
    val duration: Long,
    val remainingTime: Long,
    val endsAtMs: Long?,
    val progress: Float,
    val intentions: List<WatchIntention>,
    val sessionPosition: Int?,
    val sessionTotal: Int?,
    val stackedSessions: Int?,
    val isExtension: Boolean
)

data class WatchIntention(
    val slug: String,
    val title: String?,
    val emoji: String?,
    val subSlug: String?,
    val subTitle: String?,
    val subEmoji: String?
)

data class WatchAssistant(
    val assistantEnabled: Boolean,
    val speechCaptureEnabled: Boolean,
    val aiTaskCaptureEnabled: Boolean,
    val usageBudgetRemainingUsd: Double?,
    /** Null means Unlimited; absent is treated as the product default. */
    val recordingMaxMinutes: Int?
) {
    val canRecord: Boolean
        get() = assistantEnabled
}

data class WatchTimerControls(
    val canStartOrResume: Boolean,
    val canPause: Boolean,
    val canAddFiveMinutes: Boolean,
    val canReset: Boolean,
    val canSkip: Boolean,
    val canStartLongBreak: Boolean,
    val requiresIntentionSelection: Boolean,
    val intentionRequireSelection: Boolean,
    val intentionMultiSelect: Boolean,
    val advancedSkip: Boolean,
    val sessionsEnabled: Boolean,
    val resetBreakOnFirstIntention: Boolean,
    val resetLongBreakOnFirstIntention: Boolean
) {
    fun resetOnFirstIntentionFor(timerType: String): Boolean? = when (timerType) {
        "break" -> resetBreakOnFirstIntention
        "longBreak" -> resetLongBreakOnFirstIntention
        else -> null
    }
}

data class WatchSubIntentionOption(
    val slug: String,
    val title: String,
    val emoji: String
)

data class WatchIntentionOption(
    val slug: String,
    val title: String,
    val emoji: String,
    val type: String,
    val subIntentions: List<WatchSubIntentionOption>
)

data class WatchTask(
    val id: String,
    val title: String,
    val priority: String,
    val timerType: String,
    val dueDate: String?,
    val dueTime: String?,
    val intentionTitle: String?,
    val intentionEmoji: String?,
    val subIntentionSlug: String?,
    val subIntentionTitle: String?,
    val subIntentionEmoji: String?,
    val followUpParentTitle: String?,
    val isFocused: Boolean,
    val isLinkedToTimer: Boolean,
    val isOverdue: Boolean
) {
    fun intentionLabel(): String {
        val parent = listOfNotNull(intentionEmoji, intentionTitle).joinToString(" ").trim()
        val child = listOfNotNull(subIntentionEmoji, subIntentionTitle).joinToString(" ").trim()
        return when {
            parent.isNotEmpty() && child.isNotEmpty() -> "$parent / $child"
            parent.isNotEmpty() -> parent
            child.isNotEmpty() -> child
            else -> "General"
        }
    }

    fun priorityLabel(): String {
        return priority.replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString()
        }
    }

    fun followUpContextLabel(): String? {
        return followUpParentTitle?.takeIf { it.isNotBlank() }?.let { "↳ $it" }
    }

    fun localizedPriorityLabel(context: Context): String {
        return when (priority.lowercase(Locale.ROOT)) {
            "low" -> context.getString(R.string.priority_low)
            "normal" -> context.getString(R.string.priority_normal)
            "high" -> context.getString(R.string.priority_high)
            "urgent" -> context.getString(R.string.priority_urgent)
            else -> priorityLabel()
        }
    }
}

data class AssistantVoiceResult(
    val transcript: String,
    val message: String,
    val actions: List<String>,
    val responseLanguage: String?,
    val costUsd: Double,
    val usedFallback: Boolean,
    val spokenAudioBase64: String?,
    val spokenAudioMimeType: String?
)

data class AssistantTranscriptionResult(
    val transcript: String,
    val costUsd: Double,
    val debugLogId: String?
)

fun JSONObject.toWatchStatus(): WatchStatus {
    val timerObject = optJSONObject("timer")
    val controls = getJSONObject("timerControls")
    return WatchStatus(
        serverNowMs = optLong("serverNowMs"),
        taskMode = optString("taskMode"),
        language = WatchLanguages.normalizeTag(optString("language")),
        timer = timerObject?.toWatchTimer(),
        assistant = getJSONObject("assistant").toWatchAssistant(),
        timerControls = WatchTimerControls(
            canStartOrResume = controls.optBoolean("canStartOrResume"),
            canPause = controls.optBoolean("canPause"),
            canAddFiveMinutes = controls.optBoolean("canAddFiveMinutes"),
            canReset = controls.optBoolean("canReset"),
            canSkip = controls.optBoolean("canSkip"),
            canStartLongBreak = controls.optBoolean("canStartLongBreak"),
            requiresIntentionSelection = controls.optBoolean("requiresIntentionSelection"),
            intentionRequireSelection = controls.optBoolean("intentionRequireSelection"),
            intentionMultiSelect = controls.optBoolean("intentionMultiSelect"),
            advancedSkip = controls.optBoolean("advancedSkip"),
            sessionsEnabled = controls.optBoolean("sessionsEnabled"),
            resetBreakOnFirstIntention = controls.optBoolean("resetBreakOnFirstIntention", false),
            resetLongBreakOnFirstIntention = controls.optBoolean("resetLongBreakOnFirstIntention", false)
        ),
        tasks = getJSONArray("tasks").mapObjects { it.toWatchTask() },
        totalVisibleTasks = optInt("totalVisibleTasks"),
        totalActiveTasks = optInt("totalActiveTasks")
    )
}

fun JSONArray.toWatchIntentionOptions(): List<WatchIntentionOption> {
    return mapObjects {
        WatchIntentionOption(
            slug = it.optString("slug"),
            title = it.optString("title"),
            emoji = it.optString("emoji"),
            type = it.optString("type"),
            subIntentions = it.optJSONArray("subIntentions")?.mapObjects { child ->
                child.toWatchSubIntentionOption()
            } ?: emptyList()
        )
    }
}

fun JSONObject.toAssistantVoiceResult(): AssistantVoiceResult {
    return AssistantVoiceResult(
        transcript = optString("transcript"),
        message = optString("message"),
        actions = optJSONArray("actions")?.mapStrings() ?: emptyList(),
        responseLanguage = optNullableString("responseLanguage")?.let(WatchLanguages::normalizeTag),
        costUsd = optDouble("costUsd"),
        usedFallback = optBoolean("usedFallback"),
        spokenAudioBase64 = optNullableString("spokenAudioBase64"),
        spokenAudioMimeType = optNullableString("spokenAudioMimeType")
    )
}

fun AssistantVoiceResult.toJSONObject(): JSONObject = JSONObject()
    .put("transcript", transcript)
    .put("message", message)
    .put("actions", JSONArray(actions))
    .put("responseLanguage", responseLanguage)
    .put("costUsd", costUsd)
    .put("usedFallback", usedFallback)
    .put("spokenAudioBase64", spokenAudioBase64)
    .put("spokenAudioMimeType", spokenAudioMimeType)

fun JSONObject.toAssistantTranscriptionResult(): AssistantTranscriptionResult {
    return AssistantTranscriptionResult(
        transcript = optString("transcript"),
        costUsd = optDouble("costUsd"),
        debugLogId = optNullableString("debugLogId")
    )
}

private fun JSONObject.toWatchTimer(): WatchTimer {
    return WatchTimer(
        id = optString("id"),
        type = optString("type"),
        status = optString("status"),
        duration = optLong("duration"),
        remainingTime = optLong("remainingTime"),
        endsAtMs = optNullableLong("endsAtMs"),
        progress = optDouble("progress").toFloat().coerceIn(0f, 1f),
        intentions = optJSONArray("intentions")?.mapObjects { it.toWatchIntention() } ?: emptyList(),
        sessionPosition = optNullableInt("sessionPosition"),
        sessionTotal = optNullableInt("sessionTotal"),
        stackedSessions = optNullableInt("stackedSessions"),
        isExtension = optBoolean("isExtension")
    )
}

private fun JSONObject.toWatchIntention(): WatchIntention {
    return WatchIntention(
        slug = optString("slug"),
        title = optNullableString("title"),
        emoji = optNullableString("emoji"),
        subSlug = optNullableString("subSlug"),
        subTitle = optNullableString("subTitle"),
        subEmoji = optNullableString("subEmoji")
    )
}

private fun JSONObject.toWatchSubIntentionOption(): WatchSubIntentionOption {
    return WatchSubIntentionOption(
        slug = optString("slug"),
        title = optString("title"),
        emoji = optString("emoji")
    )
}

private fun JSONObject.toWatchAssistant(): WatchAssistant {
    return WatchAssistant(
        assistantEnabled = optBoolean("assistantEnabled"),
        speechCaptureEnabled = optBoolean("speechCaptureEnabled"),
        aiTaskCaptureEnabled = optBoolean("aiTaskCaptureEnabled"),
        usageBudgetRemainingUsd = optNullableDouble("usageBudgetRemainingUsd"),
        recordingMaxMinutes = when {
            has("assistantRecordingMaxMinutes") &&
                isNull("assistantRecordingMaxMinutes") -> null
            has("assistantRecordingMaxMinutes") -> optInt("assistantRecordingMaxMinutes")
            else -> DEFAULT_RECORDING_MAX_MINUTES
        }
    )
}

private const val DEFAULT_RECORDING_MAX_MINUTES = 10

private fun JSONObject.toWatchTask(): WatchTask {
    return WatchTask(
        id = optString("id"),
        title = optString("title"),
        priority = optString("priority"),
        timerType = optString("timerType", "work"),
        dueDate = optNullableString("dueDate"),
        dueTime = optNullableString("dueTime"),
        intentionTitle = optNullableString("intentionTitle"),
        intentionEmoji = optNullableString("intentionEmoji"),
        subIntentionSlug = optNullableString("subIntentionSlug"),
        subIntentionTitle = optNullableString("subIntentionTitle"),
        subIntentionEmoji = optNullableString("subIntentionEmoji"),
        followUpParentTitle = optJSONObject("followUpParent")?.optNullableString("title"),
        isFocused = optBoolean("isFocused"),
        isLinkedToTimer = optBoolean("isLinkedToTimer"),
        isOverdue = optBoolean("isOverdue")
    )
}

private fun JSONObject.optNullableString(name: String): String? {
    return if (isNull(name)) null else optString(name)
}

private fun JSONObject.optNullableInt(name: String): Int? {
    return if (isNull(name)) null else optInt(name)
}

private fun JSONObject.optNullableDouble(name: String): Double? {
    return if (isNull(name)) null else optDouble(name)
}

private fun JSONObject.optNullableLong(name: String): Long? {
    return if (isNull(name)) null else optLong(name)
}

private inline fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> {
    val values = mutableListOf<T>()
    for (index in 0 until length()) {
        values += transform(getJSONObject(index))
    }
    return values
}

private fun JSONArray.mapStrings(): List<String> {
    val values = mutableListOf<String>()
    for (index in 0 until length()) {
        values += optString(index)
    }
    return values
}
