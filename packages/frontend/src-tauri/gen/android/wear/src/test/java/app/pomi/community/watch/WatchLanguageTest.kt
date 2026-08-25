package app.pomi.community.watch

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
class WatchLanguageTest {
    @Test
    fun normalizesTheTenSupportedLanguageFamilies() {
        assertEquals("en", WatchLanguages.normalizeTag("en-US"))
        assertEquals("zh-Hans", WatchLanguages.normalizeTag("zh-TW"))
        assertEquals("hi", WatchLanguages.normalizeTag("hi-IN"))
        assertEquals("es", WatchLanguages.normalizeTag("es-MX"))
        assertEquals("ar", WatchLanguages.normalizeTag("ar-SA"))
        assertEquals("fr", WatchLanguages.normalizeTag("fr-CA"))
        assertEquals("bn", WatchLanguages.normalizeTag("bn-BD"))
        assertEquals("pt-BR", WatchLanguages.normalizeTag("pt-PT"))
        assertEquals("id", WatchLanguages.normalizeTag("in-ID"))
        assertEquals("ur", WatchLanguages.normalizeTag("ur-PK"))
        assertEquals("en", WatchLanguages.normalizeTag("de-DE"))
        assertEquals(10, WatchLanguages.supported.size)
    }

    @Test
    fun firstSupportedSystemLocaleWinsAndUnknownLocalesFallBackToEnglish() {
        val locales = android.os.LocaleList(
            Locale.forLanguageTag("de-DE"),
            Locale.forLanguageTag("fr-CH")
        )
        assertEquals(WatchLanguage.FRENCH, WatchLanguages.detect(locales))
        assertEquals(WatchLanguage.ENGLISH, WatchLanguages.detect(android.os.LocaleList(Locale.GERMAN)))
    }

    @Test
    fun statusLanguageIsNormalizedFromTheAuthoritativePayload() {
        val status = JSONObject(
            """{
                "serverNowMs":0,"taskMode":"intention","language":"pt-PT","timer":null,
                "assistant":{},"timerControls":{},"tasks":[],"totalVisibleTasks":0,"totalActiveTasks":0
            }"""
        ).toWatchStatus()
        assertEquals("pt-BR", status.language)
    }

    @Test
    fun storedLanguageWrapsActivityResourcesWithoutChangingTheBaseContext() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = WatchSessionStore(context)
        store.saveSession("localhost:3000", "person", "token", "fr")

        val localized = context.withWatchLanguage()
        assertEquals("fr", localized.resources.configuration.locales[0].language)
        assertTrue(localized.getString(app.pomi.community.watch.R.string.tasks).isNotBlank())
        assertEquals("■  Stop  01:05", WatchAssistantPresentation.recordingLabel(context, 65))
        store.clear()
        assertEquals("fr", store.languageTag)
    }

    @Test
    fun accountLanguageChangesNotifyLiveActivityBindingsOnlyWhenTheValueChanges() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = WatchSessionStore(context)
        store.saveLanguage("en")
        val observed = mutableListOf<String>()
        val remove = WatchLanguageCoordinator.addListener { observed += it }

        store.saveLanguage("fr-CA")
        store.saveLanguage("fr")
        store.saveLanguage("fr")

        remove()
        assertEquals(listOf("fr"), observed)
    }

    @Test
    fun normalTaskPriorityUsesTheNormalCatalogEntryInEveryLocale() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val task = WatchTask(
            id = "task",
            title = "Task",
            priority = "normal",
            timerType = "work",
            dueDate = null,
            dueTime = null,
            intentionTitle = null,
            intentionEmoji = null,
            subIntentionSlug = null,
            subIntentionTitle = null,
            subIntentionEmoji = null,
            followUpParentTitle = null,
            isFocused = false,
            isLinkedToTimer = false,
            isOverdue = false
        )

        assertEquals("Normal", task.localizedPriorityLabel(context.withWatchLanguage("en")))
        assertEquals("Normale", task.localizedPriorityLabel(context.withWatchLanguage("fr")))
    }
}
