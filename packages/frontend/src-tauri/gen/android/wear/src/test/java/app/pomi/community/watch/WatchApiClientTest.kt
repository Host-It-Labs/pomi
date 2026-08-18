package app.pomi.community.watch

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WatchApiClientTest {
    @Test
    fun onlyUnknownLanguageFieldErrorsAreRetryable() {
        assertTrue(
            shouldRetryLoginWithoutLanguage(
                WatchApiException(400, "property language should not exist")
            )
        )
        assertTrue(
            shouldRetryLoginWithoutLanguage(
                WatchApiException(400, "Unrecognized key: language")
            )
        )
        assertFalse(
            shouldRetryLoginWithoutLanguage(
                WatchApiException(400, "Unsupported language")
            )
        )
        assertFalse(
            shouldRetryLoginWithoutLanguage(
                WatchApiException(500, "property language should not exist")
            )
        )
    }
}
