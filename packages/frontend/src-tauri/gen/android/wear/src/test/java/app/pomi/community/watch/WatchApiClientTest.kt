package app.pomi.community.watch

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WatchApiClientTest {
    @Test
    fun requiresPersistentCredentialsForSuccessfulLogin() {
        val response = JSONObject().put("token", "access").put("refreshToken", "refresh").put("language", "fr")
        assertEquals(WatchLoginResult("access", "refresh", "fr"), parseWatchLoginResponse(response))
        response.remove("refreshToken")
        assertThrows(Exception::class.java) { parseWatchLoginResponse(response) }
        response.put("refreshToken", "")
        assertThrows(IllegalArgumentException::class.java) { parseWatchLoginResponse(response) }
    }
}
