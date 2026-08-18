package app.pomi.community.watch

import android.content.Context
import org.json.JSONObject

data class CachedWatchStatus(val status: WatchStatus, val savedAtMs: Long)

class WatchSessionStore(context: Context) {
    private val applicationContext = context.applicationContext
    private val preferences = applicationContext.getSharedPreferences("pomi_watch", Context.MODE_PRIVATE)

    val backendUrl: String?
        get() = preferences.getString(KEY_BACKEND_URL, null)

    val token: String?
        get() = preferences.getString(KEY_TOKEN, null)

    val username: String?
        get() = preferences.getString(KEY_USERNAME, null)

    /** Canonical BCP-47 account language, falling back to the first system language. */
    val languageTag: String
        get() = preferences.getString(KEY_LANGUAGE, null)
            ?.let(WatchLanguages::normalizeTag)
            ?: WatchLanguages.detect(applicationContext).tag

    val isReady: Boolean
        get() = !backendUrl.isNullOrBlank() && !token.isNullOrBlank()

    val accountKey: String?
        get() {
            val url = backendUrl ?: return null
            val user = username?.trim().orEmpty()
            if (user.isBlank()) return null
            return "$url|$user"
        }

    val cachedStatus: CachedWatchStatus?
        get() {
            val json = preferences.getString(KEY_STATUS_JSON, null) ?: return null
            val savedAtMs = preferences.getLong(KEY_STATUS_SAVED_AT, 0L)
            return try {
                CachedWatchStatus(JSONObject(json).toWatchStatus(), savedAtMs)
            } catch (_: Exception) {
                null
            }
        }

    fun saveSession(
        backendUrl: String,
        username: String,
        token: String,
        accountLanguage: String?
    ) {
        val nextLanguage = WatchLanguages.normalizeTag(accountLanguage ?: languageTag)
        preferences.edit()
            .putString(KEY_BACKEND_URL, normalizeBackendUrl(backendUrl))
            .putString(KEY_USERNAME, username.trim())
            .putString(KEY_TOKEN, token)
            .putString(KEY_LANGUAGE, nextLanguage)
            .apply()
    }

    fun saveSession(backendUrl: String, username: String, token: String) {
        saveSession(backendUrl, username, token, null)
    }

    fun saveLanguage(language: String) {
        val nextLanguage = WatchLanguages.normalizeTag(language)
        val previousLanguage = preferences.getString(KEY_LANGUAGE, null)
            ?.let(WatchLanguages::normalizeTag)
            ?: WatchLanguages.detect(applicationContext).tag
        if (preferences.contains(KEY_LANGUAGE) && previousLanguage == nextLanguage) return
        preferences.edit().putString(KEY_LANGUAGE, nextLanguage).apply()
        if (previousLanguage != nextLanguage) WatchLanguageCoordinator.publish(nextLanguage)
    }

    fun clear() {
        preferences.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_STATUS_JSON)
            .remove(KEY_STATUS_SAVED_AT)
            .apply()
    }

    fun saveStatus(json: String, savedAtMs: Long) {
        preferences.edit()
            .putString(KEY_STATUS_JSON, json)
            .putLong(KEY_STATUS_SAVED_AT, savedAtMs)
            .apply()
    }

    fun defaultBackendUrl(): String {
        return backendUrl ?: "http://10.0.2.2:3000"
    }

    companion object {
        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_USERNAME = "username"
        private const val KEY_LANGUAGE = "language"
        private const val KEY_STATUS_JSON = "status_json"
        private const val KEY_STATUS_SAVED_AT = "status_saved_at"

        fun peekLanguage(context: Context): String? = context.applicationContext
            .getSharedPreferences("pomi_watch", Context.MODE_PRIVATE)
            .getString(KEY_LANGUAGE, null)

        fun normalizeBackendUrl(value: String): String {
            val trimmed = value.trim().trimEnd('/')
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                return trimmed
            }
            return "http://$trimmed"
        }
    }
}
