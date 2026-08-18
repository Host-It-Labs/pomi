package app.pomi.community.watch

import android.app.Activity
import android.content.Context

/** Base Activity that applies the persisted account/system language before UI inflation. */
abstract class WatchActivity : Activity() {
    private var removeLanguageListener: (() -> Unit)? = null

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(newBase.withWatchLanguage())
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        removeLanguageListener = WatchLanguageCoordinator.addListener {
            runOnUiThread {
                if (!isFinishing && !isDestroyed) recreate()
            }
        }
    }

    override fun onDestroy() {
        removeLanguageListener?.invoke()
        removeLanguageListener = null
        super.onDestroy()
    }
}
