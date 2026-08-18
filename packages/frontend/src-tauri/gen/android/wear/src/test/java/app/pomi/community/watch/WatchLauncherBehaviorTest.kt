package app.pomi.community.watch

import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class WatchLauncherBehaviorTest {
    @Test
    fun launcherOpensFreshTimerHomeAndFinishes() {
        val activity = Robolectric.buildActivity(WatchLauncherActivity::class.java).setup().get()
        val launched = shadowOf(activity).nextStartedActivity

        assertEquals(WatchFaceActivity::class.java.name, launched.component?.className)
        assertTrue(launched.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertTrue(launched.flags and Intent.FLAG_ACTIVITY_CLEAR_TASK != 0)
        assertTrue(activity.isFinishing)
    }

    @Test
    fun manifestResolvesTheLauncherActivity() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)

        assertEquals(WatchLauncherActivity::class.java.name, intent?.component?.className)
    }
}
