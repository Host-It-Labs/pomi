package app.pomi.community.watch

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class WatchLauncherActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openTimerHome()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        openTimerHome()
    }

    private fun openTimerHome() {
        startActivity(
            Intent(this, WatchFaceActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            )
        )
        finish()
    }
}
