package app.pomi.community.watch

import android.util.Base64
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.io.File
import java.util.Locale

data class WatchActionLifecycle(
    val id: String,
    val status: String,
    val message: String? = null,
    val outcomeUnknown: Boolean = false,
    val result: JSONObject? = null
) {
    val isTerminal: Boolean
        get() = status.lowercase() in setOf("succeeded", "success", "completed", "failed", "cancelled", "canceled")
}

data class WatchLoginResult(
    val token: String,
    val language: String?
)

class WatchApiClient(private val sessionStore: WatchSessionStore) {
    val accountKey: String?
        get() = sessionStore.accountKey

    fun login(backendUrl: String, username: String, password: String): WatchLoginResult {
        val baseUrl = WatchSessionStore.normalizeBackendUrl(backendUrl)
        val response = try {
            request(
                baseUrl = baseUrl,
                path = "/sessions",
                method = "POST",
                token = null,
                body = loginBody(username, password)
            )
        } catch (error: WatchApiException) {
            if (!shouldRetryLoginWithoutLanguage(error)) throw error
            // Older self-hosted servers reject unknown request properties with
            // a 400. Retry once without language to preserve their login flow.
            request(
                baseUrl = baseUrl,
                path = "/sessions",
                method = "POST",
                token = null,
                body = legacyLoginBody(username, password)
            )
        }
        val result = JSONObject(response)
        return WatchLoginResult(
            token = result.getString("token"),
            language = result.optString("language").ifBlank { null }
        )
    }

    private fun loginBody(username: String, password: String): String = JSONObject()
        .put("username", username)
        .put("password", password)
        // The backend uses this only for new accounts; existing accounts
        // return their authoritative preference in the response.
        .put("language", sessionStore.languageTag)
        .toString()

    private fun legacyLoginBody(username: String, password: String): String = JSONObject()
        .put("username", username)
        .put("password", password)
        .toString()

    fun getStatus(
        taskMode: String,
        limit: Int,
        readTimeoutMs: Int = 30000,
        connectTimeoutMs: Int = 15000
    ): WatchStatus {
        val response = request(
            path = "/watch/status?taskMode=$taskMode&limit=$limit",
            method = "GET",
            readTimeoutMs = readTimeoutMs,
            connectTimeoutMs = connectTimeoutMs
        )
        val payload = JSONObject(response)
        val status = payload.toWatchStatus()
        if (payload.has("language") && !payload.isNull("language")) {
            sessionStore.saveLanguage(status.language)
        }
        sessionStore.saveStatus(response, System.currentTimeMillis())
        return status
    }

    /** Submit a generic watch mutation to the backend-owned FIFO gateway. */
    fun submitUserAction(action: PendingWatchAction): WatchActionLifecycle {
        val body = JSONObject()
            .put("actionId", action.id)
            .put("action", action.toGatewayRequest())
        val response = request(
            path = "/user-actions",
            method = "POST",
            body = body.toString(),
            readTimeoutMs = GATEWAY_RECEIPT_TIMEOUT_MS,
            connectTimeoutMs = GATEWAY_RECEIPT_TIMEOUT_MS
        )
        return response.toWatchActionLifecycle(action.id, defaultStatus = "accepted")
    }

    fun getUserActionStatus(actionId: String, waitMs: Int): WatchActionLifecycle {
        val response = request(
            path = "/user-actions/${encodePath(actionId)}?waitMs=${waitMs.coerceIn(0, 25000)}",
            method = "GET",
            readTimeoutMs = waitMs.coerceIn(1000, 25000) + 5000,
            connectTimeoutMs = GATEWAY_CONNECT_TIMEOUT_MS
        )
        return response.toWatchActionLifecycle(actionId, defaultStatus = "accepted")
    }

    fun cancelUserAction(actionId: String): WatchActionLifecycle {
        val response = request(
            path = "/user-actions/${encodePath(actionId)}",
            method = "DELETE",
            readTimeoutMs = GATEWAY_RECEIPT_TIMEOUT_MS,
            connectTimeoutMs = GATEWAY_CONNECT_TIMEOUT_MS
        )
        return response.toWatchActionLifecycle(actionId, defaultStatus = "cancelled")
    }

    fun getIntentions(): List<WatchIntentionOption> {
        val response = request(
            path = "/watch/intentions",
            method = "GET"
        )
        return org.json.JSONArray(response).toWatchIntentionOptions()
    }

    fun prepareVoiceCommand(action: PendingWatchAction) {
        val body = JSONObject()
            .put("preparationId", action.id)
        if (action.assistantPreparedChunks) {
            body.put("kind", "chunks")
        } else if (action.assistantTranscript != null) {
            body
                .put("kind", "transcript")
                .put("transcript", action.assistantTranscript)
                .put("transcriptionCostUsd", action.assistantTranscriptionCostUsd ?: 0.0)
            if (!action.assistantDebugLogId.isNullOrBlank()) {
                body.put("debugLogId", action.assistantDebugLogId)
            }
        } else {
            body
                .put("kind", "audio")
                .put("audioBase64", requireNotNull(action.assistantAudioBase64))
                .put("mimeType", requireNotNull(action.assistantAudioMimeType))
        }
        request(
            path = "/assistant/voice-command/prepare",
            method = "POST",
            body = body.toString(),
            readTimeoutMs = 90000
        )
    }

    fun transcribeVoiceChunks(
        action: PendingWatchAction,
        ensureCurrent: () -> Unit
    ): PendingWatchAction {
        val manifest = org.json.JSONArray().apply {
            action.assistantAudioChunks.forEach { chunk ->
                val audioBase64 = encodeChunk(chunk)
                put(
                    JSONObject()
                        .put("audioSha256", sha256(audioBase64))
                        .put("mimeType", chunk.mimeType)
                )
            }
        }
        request(
            path = "/assistant/voice-command/chunks",
            method = "POST",
            body = JSONObject()
                .put("preparationId", action.id)
                .put("manifest", manifest)
                .toString(),
            readTimeoutMs = 90_000
        )
        ensureCurrent()
        action.assistantAudioChunks.forEachIndexed { index, chunk ->
            ensureCurrent()
            val audioBase64 = encodeChunk(chunk)
            val body = JSONObject()
                .put("preparationId", action.id)
                .put("index", index)
                .put("audioBase64", audioBase64)
                .put("mimeType", chunk.mimeType)
            request(
                path = "/assistant/voice-command/chunk",
                method = "POST",
                body = body.toString(),
                readTimeoutMs = 90_000
            )
            ensureCurrent()
        }
        return action.copy(
            assistantAudioChunks = emptyList(),
            assistantPreparedChunks = true
        )
    }

    fun finalizeVoiceCommand(preparationId: String): AssistantVoiceResult {
        val body = JSONObject()
            .put("preparationId", preparationId)
        val response = request(
            path = "/assistant/voice-command/finalize",
            method = "POST",
            body = body.toString(),
            readTimeoutMs = 90000
        )
        return JSONObject(response).toAssistantVoiceResult()
    }

    private fun request(
        path: String,
        method: String,
        token: String? = sessionStore.token,
        body: String? = null,
        readTimeoutMs: Int = 30000,
        connectTimeoutMs: Int = 15000,
        baseUrl: String = requireNotNull(sessionStore.backendUrl) { "Missing backend URL" }
    ): String {
        val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = connectTimeoutMs
        connection.readTimeout = readTimeoutMs
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Accept-Language", sessionStore.languageTag)
        if (!token.isNullOrBlank()) {
            connection.setRequestProperty("Authorization", "Bearer $token")
        }
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { stream ->
                stream.write(body.toByteArray(Charsets.UTF_8))
            }
        }

        val code = connection.responseCode
        val text = readResponse(connection, code)
        connection.disconnect()
        if (code !in 200..299) {
            throw WatchApiException(code, parseErrorMessage(text, code))
        }
        return text
    }

    private fun readResponse(connection: HttpURLConnection, code: Int): String {
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        if (stream == null) return ""
        return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
    }

    private fun parseErrorMessage(body: String, code: Int): String {
        if (body.isBlank()) return requestFailedMessage(code)
        return try {
            val value = JSONObject(body).opt("message")
            when (value) {
                is String -> value
                null -> requestFailedMessage(code)
                else -> value.toString()
            }
        } catch (_: Exception) {
            body.take(120)
        }
    }

    private fun encodePath(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun sha256(value: String): String = MessageDigest
        .getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte) }

    private fun encodeChunk(chunk: WatchAudioChunk): String = Base64.encodeToString(
        File(chunk.filePath).readBytes(),
        Base64.NO_WRAP
    )

    private companion object {
        const val GATEWAY_RECEIPT_TIMEOUT_MS = 5_000
        const val GATEWAY_CONNECT_TIMEOUT_MS = 5_000
    }
}

class WatchApiException(val code: Int, message: String) : Exception(message)

internal fun shouldRetryLoginWithoutLanguage(error: WatchApiException): Boolean {
    if (error.code != 400) return false
    val message = error.message?.lowercase(Locale.ROOT) ?: return false
    if (!message.contains("language")) return false
    return listOf(
        "unknown",
        "unrecognized",
        "unrecognised",
        "unexpected",
        "should not exist",
        "not allowed",
        "extraneous",
        "additional property"
    ).any(message::contains)
}

internal fun PendingWatchAction.toGatewayRequest(): JSONObject {
    when (kind) {
        "timer" -> {
            val operation = if (action == "startOrResume") "createOrResume" else action
            return JSONObject()
                .put("kind", "timer")
                .put("operation", operation)
                .apply {
                    if (!timerType.isNullOrBlank()) put("timerType", timerType)
                    if (!skipLogMode.isNullOrBlank()) put("requestedLogMode", skipLogMode)
                }
        }
        "intentions" -> {
            val operation = if (action == "startOrResume") "createOrResume" else action
            return JSONObject()
                .put("kind", "timer")
                .put("operation", operation)
                .put("timerType", timerType)
                .put("intentions", org.json.JSONArray(intentionSlugs))
                .put("subIntentions", JSONObject(subIntentions))
        }
        "session" -> {
            return JSONObject()
                .put("kind", "timer")
                .put("operation", "setSessionPosition")
                .put("position", position)
        }
        "taskComplete" -> {
            return JSONObject()
                .put("kind", "tasks")
                .put("operation", "complete")
                .put("taskId", requireNotNull(taskId))
        }
        "assistantVoice" -> {
            return JSONObject()
                .put("kind", "assistant")
                .put("operation", "commitPreparedVoiceCommand")
                .put("payload", JSONObject().put("preparationId", id))
        }
        else -> error("Unsupported watch action kind: $kind")
    }
}

internal fun String.toWatchActionLifecycle(
    defaultActionId: String,
    defaultStatus: String
): WatchActionLifecycle {
    if (isBlank()) return WatchActionLifecycle(defaultActionId, defaultStatus)
    return try {
        val value = JSONObject(this)
        WatchActionLifecycle(
            id = value.optString("actionId", defaultActionId),
            status = value.optString("status", defaultStatus),
            message = value.optNullableString("message")
                ?: value.optJSONObject("error")?.optNullableString("message"),
            outcomeUnknown = value.optBoolean("outcomeUnknown"),
            result = value.optJSONObject("result")
        )
    } catch (_: Exception) {
        WatchActionLifecycle(defaultActionId, defaultStatus)
    }
}

private fun JSONObject.optNullableString(name: String): String? =
    if (isNull(name)) null else optString(name).ifBlank { null }
