package app.pomi.community.watch

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The language catalogue used by the standalone Wear application.  The API
 * stores BCP-47 tags so it can share the account preference with the main app,
 * while Android resource selection still gets a normal Locale.
 */
enum class WatchLanguage(val tag: String, val locale: Locale) {
    ENGLISH("en", Locale.ENGLISH),
    CHINESE("zh-Hans", Locale.forLanguageTag("zh-CN")),
    HINDI("hi", Locale.forLanguageTag("hi-IN")),
    SPANISH("es", Locale.forLanguageTag("es")),
    ARABIC("ar", Locale.forLanguageTag("ar")),
    FRENCH("fr", Locale.FRENCH),
    BENGALI("bn", Locale.forLanguageTag("bn-BD")),
    PORTUGUESE("pt-BR", Locale.forLanguageTag("pt-BR")),
    INDONESIAN("id", Locale.forLanguageTag("id")),
    URDU("ur", Locale.forLanguageTag("ur-PK"))
}

object WatchLanguages {
    val supported: List<WatchLanguage> = WatchLanguage.entries

    fun normalizeTag(raw: String?): String {
        return fromTag(raw)?.tag ?: WatchLanguage.ENGLISH.tag
    }

    fun fromTag(raw: String?): WatchLanguage? {
        if (raw.isNullOrBlank()) return null
        val normalized = raw.trim().replace('_', '-')
        val locale = Locale.forLanguageTag(normalized)
        val language = locale.language.lowercase(Locale.ROOT)
        return when (language) {
            "en" -> WatchLanguage.ENGLISH
            // Pomi currently ships Simplified Chinese. Regional/script
            // variants are intentionally collapsed to that catalogue.
            "zh" -> WatchLanguage.CHINESE
            "hi" -> WatchLanguage.HINDI
            "es" -> WatchLanguage.SPANISH
            "ar" -> WatchLanguage.ARABIC
            "fr" -> WatchLanguage.FRENCH
            "bn" -> WatchLanguage.BENGALI
            "pt" -> WatchLanguage.PORTUGUESE
            "id", "in" -> WatchLanguage.INDONESIAN
            "ur" -> WatchLanguage.URDU
            else -> null
        }
    }

    fun detect(locales: LocaleList): WatchLanguage {
        for (index in 0 until locales.size()) {
            fromTag(locales[index].toLanguageTag())?.let { return it }
        }
        return WatchLanguage.ENGLISH
    }

    fun detect(context: Context): WatchLanguage =
        detect(context.resources.configuration.locales)
}

/**
 * Process-local bridge from the session/API layer to live Activities.  Wear
 * stores one account language, so a status response received by any client
 * (including the tile) can update an already visible Activity.
 */
object WatchLanguageCoordinator {
    private val listeners = CopyOnWriteArrayList<(String) -> Unit>()

    fun addListener(listener: (String) -> Unit): () -> Unit {
        listeners += listener
        return { listeners -= listener }
    }

    internal fun publish(languageTag: String) {
        listeners.forEach { it(languageTag) }
    }
}

/** Return a context whose resources follow the account language preference. */
fun Context.withWatchLanguage(languageTag: String?): Context {
    val language = WatchLanguages.fromTag(languageTag) ?: WatchLanguages.detect(this)
    val configuration = Configuration(resources.configuration)
    configuration.setLocale(language.locale)
    configuration.setLocales(LocaleList(language.locale))
    return createConfigurationContext(configuration)
}

fun Context.withWatchLanguage(): Context = withWatchLanguage(
    WatchSessionStore.peekLanguage(this)
)
