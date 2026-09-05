package app.pomi.community.watch

import android.content.Context
import android.content.pm.ApplicationInfo
import org.json.JSONObject
import java.net.URI

data class CachedWatchStatus(val status: WatchStatus, val savedAtMs: Long)

class WatchSessionStore private constructor(
    context: Context,
    private val refreshTokenVault: RefreshTokenVault
) {
    private val applicationContext = context.applicationContext
    private val preferences = applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE
    )
    private val allowDevelopmentHttp =
        applicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    constructor(context: Context) : this(
        context,
        AndroidKeystoreRefreshTokenVault(context)
    )

    internal constructor(
        context: Context,
        refreshTokenVault: RefreshTokenVault,
        @Suppress("UNUSED_PARAMETER") testOnly: Unit
    ) : this(context, refreshTokenVault)

    var backendWasQuarantined: Boolean = false
        private set

    init {
        val legacyToken = preferences.getString(KEY_TOKEN, null)
        if (!legacyToken.isNullOrBlank()) accessTokenInMemory = legacyToken
        preferences.edit().remove(KEY_TOKEN).apply()

        val storedBackend = preferences.getString(KEY_BACKEND_URL, null)
        if (!storedBackend.isNullOrBlank()) {
            try {
                val normalized = normalizeBackendUrl(storedBackend)
                if (normalized != storedBackend) {
                    preferences.edit().putString(KEY_BACKEND_URL, normalized).apply()
                }
            } catch (_: IllegalArgumentException) {
                backendWasQuarantined = true
                clear()
                preferences.edit().remove(KEY_BACKEND_URL).apply()
            }
        }
    }

    val backendUrl: String?
        get() = preferences.getString(KEY_BACKEND_URL, null)

    val token: String?
        get() = accessTokenInMemory

    val refreshToken: String?
        get() = refreshTokenVault.read()

    val username: String?
        get() = preferences.getString(KEY_USERNAME, null)

    val hasLegacyAccessToken: Boolean
        get() = !token.isNullOrBlank() && refreshToken.isNullOrBlank()

    /** Canonical BCP-47 account language, falling back to the first system language. */
    val languageTag: String
        get() = preferences.getString(KEY_LANGUAGE, null)
            ?.let(WatchLanguages::normalizeTag)
            ?: WatchLanguages.detect(applicationContext).tag

    val isReady: Boolean
        get() = !backendUrl.isNullOrBlank() &&
            (!token.isNullOrBlank() || !refreshToken.isNullOrBlank())

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
        refreshToken: String?,
        accountLanguage: String?
    ) {
        val nextLanguage = WatchLanguages.normalizeTag(accountLanguage ?: languageTag)
        val normalizedBackend = normalizeBackendUrl(backendUrl)
        if (refreshToken.isNullOrBlank()) {
            refreshTokenVault.delete()
        } else {
            refreshTokenVault.write(refreshToken)
        }
        accessTokenInMemory = token
        preferences.edit()
            .putString(KEY_BACKEND_URL, normalizedBackend)
            .putString(KEY_USERNAME, username.trim())
            .putString(KEY_LANGUAGE, nextLanguage)
            .apply()
    }

    fun saveRotatedSession(token: String, refreshToken: String) {
        refreshTokenVault.write(refreshToken)
        accessTokenInMemory = token
    }

    fun clearAccessToken() {
        accessTokenInMemory = null
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
        accessTokenInMemory = null
        refreshTokenVault.delete()
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
        return backendUrl ?: if (allowDevelopmentHttp) "http://10.0.2.2:3000" else ""
    }

    fun normalizeBackendUrl(value: String): String =
        normalizeBackendUrl(value, allowDevelopmentHttp)

    companion object {
        private const val PREFERENCES_NAME = "pomi_watch"
        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_USERNAME = "username"
        private const val KEY_LANGUAGE = "language"
        private const val KEY_STATUS_JSON = "status_json"
        private const val KEY_STATUS_SAVED_AT = "status_saved_at"

        @Volatile
        private var accessTokenInMemory: String? = null

        fun peekLanguage(context: Context): String? = context.applicationContext
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .getString(KEY_LANGUAGE, null)

        fun normalizeBackendUrl(value: String, allowDevelopmentHttp: Boolean): String {
            val trimmed = value.trim()
            require(trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                "Enter an exact HTTPS backend origin"
            }

            val uri = try {
                URI(trimmed)
            } catch (_: Exception) {
                throw IllegalArgumentException("Enter an exact HTTPS backend origin")
            }
            require(
                (uri.scheme == "http" || uri.scheme == "https") &&
                    uri.host != null &&
                    uri.userInfo == null &&
                    (uri.path.isNullOrEmpty() || uri.path == "/") &&
                    uri.query == null &&
                    uri.fragment == null
            ) { "Enter an exact HTTPS backend origin" }

            if (uri.scheme == "http") {
                require(allowDevelopmentHttp && isDevelopmentHost(uri.host)) {
                    "Remote backends must use HTTPS"
                }
            }

            return URI(uri.scheme, null, uri.host, uri.port, null, null, null).toString()
        }

        private fun isDevelopmentHost(host: String): Boolean {
            val normalized = host.lowercase()
            return normalized == "localhost" ||
                normalized == "::1" ||
                normalized == "10.0.2.2" ||
                normalized.startsWith("127.")
        }
    }
}
