package app.pomi.community

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Test

class AndroidRefreshTokenVaultTest {
    @Test
    fun survivesProcessRestart() {
        val phase = InstrumentationRegistry.getArguments().getString("restartPhase")
        assumeTrue(phase == "write" || phase == "read")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val vault = AndroidRefreshTokenVault(context, "https://process-restart-test.example")
        if (phase == "write") {
            vault.write("persisted-across-processes")
        } else {
            try {
                assertEquals("persisted-across-processes", vault.read())
            } finally {
                vault.delete()
            }
        }
    }

    @Test
    fun restoresRotatesAndDeletesCredentialsAcrossVaultInstances() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val account = "https://vault-test.example"
        val otherAccount = "https://other-vault-test.example"
        val first = AndroidRefreshTokenVault(context, account)
        val other = AndroidRefreshTokenVault(context, otherAccount)
        first.delete()
        other.delete()
        try {
            first.write("initial-refresh")
            assertEquals("initial-refresh", AndroidRefreshTokenVault(context, account).read())
            assertNull(other.read())
            AndroidRefreshTokenVault(context, account).write("rotated-refresh")
            assertEquals("rotated-refresh", first.read())
            AndroidRefreshTokenVault(context, account).delete()
            assertNull(AndroidRefreshTokenVault(context, account).read())
        } finally {
            first.delete()
            other.delete()
        }
    }
}
