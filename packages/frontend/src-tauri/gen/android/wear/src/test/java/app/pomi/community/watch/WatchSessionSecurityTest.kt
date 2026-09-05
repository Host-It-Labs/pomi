package app.pomi.community.watch

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WatchSessionSecurityTest {
    @Test
    fun keepsAccessTokensOutOfPreferencesAndRefreshTokensInTheVault() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val vault = RecordingRefreshTokenVault()
        val store = WatchSessionStore(context, vault, Unit)

        store.saveSession(
            "https://pomi.example",
            "person",
            "access-token",
            "refresh-token",
            "en"
        )

        val preferences = context.getSharedPreferences("pomi_watch", Context.MODE_PRIVATE)
        assertFalse(preferences.contains("token"))
        assertEquals("access-token", store.token)
        assertEquals("refresh-token", vault.read())

        store.clear()
        assertNull(store.token)
        assertNull(vault.read())
    }

    @Test
    fun requiresExactHttpsOriginsForRemoteBackends() {
        assertEquals(
            "https://pomi.example:8443",
            WatchSessionStore.normalizeBackendUrl("https://pomi.example:8443/", false)
        )
        assertThrows(IllegalArgumentException::class.java) {
            WatchSessionStore.normalizeBackendUrl("http://pomi.example", false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WatchSessionStore.normalizeBackendUrl("https://pomi.example/api", false)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WatchSessionStore.normalizeBackendUrl("https://user@pomi.example", false)
        }
    }

    @Test
    fun allowsDebugLoopbackOrigins() {
        assertEquals(
            "http://10.0.2.2:3000",
            WatchSessionStore.normalizeBackendUrl("http://10.0.2.2:3000", true)
        )
        assertEquals(
            "http://127.0.0.1:3000",
            WatchSessionStore.normalizeBackendUrl("http://127.0.0.1:3000", true)
        )
    }
}

private class RecordingRefreshTokenVault : RefreshTokenVault {
    private var value: String? = null

    override fun read(): String? = value

    override fun write(value: String) {
        this.value = value
    }

    override fun delete() {
        value = null
    }
}
