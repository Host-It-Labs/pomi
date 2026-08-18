package app.pomi.community.watch

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.wear.tiles.TileService
import java.util.concurrent.Executors

class SkipActivity : WatchActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var sessionStore: WatchSessionStore
    private lateinit var apiClient: WatchApiClient
    private lateinit var statusText: TextView
    private var isSubmitting = false
    private var removeQueueListener: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionStore = WatchSessionStore(this)
        apiClient = WatchApiClient(sessionStore)
        WatchActionCoordinator.configure(apiClient)
        if (!sessionStore.isReady) {
            openLogin()
            return
        }
        buildView()
        removeQueueListener = WatchActionCoordinator.addListener { state ->
            runOnUiThread {
                if (state.authRequired && sessionStore.isReady && !isFinishing && !isDestroyed) {
                    sessionStore.clear()
                    openLogin()
                } else if (state.networkBlocked) {
                    statusText.text = getString(R.string.reconnecting)
                    statusText.setTextColor(WatchColors.Muted)
                } else if (state.terminalError != null) {
                    statusText.text = localizedWatchMessage(state.terminalError)
                    statusText.setTextColor(WatchColors.Error)
                }
            }
        }
    }

    override fun onDestroy() {
        removeQueueListener?.invoke()
        worker.shutdown()
        super.onDestroy()
    }

    private fun buildView() {
        val root = watchRoot()
        root.setPadding(dp(26), dp(18), dp(26), dp(14))

        root.addView(TextView(this).apply {
            text = getString(R.string.skip)
            watchText(16f, WatchColors.Text, Typeface.BOLD)
        }, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(28),
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ).apply {
            topMargin = dp(18)
        })

        statusText = TextView(this).apply {
            text = ""
            watchText(9.5f, WatchColors.Muted)
            maxLines = 1
        }
        root.addView(statusText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(16),
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ).apply {
            topMargin = dp(46)
        })

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        root.addView(column, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        ).apply {
            topMargin = dp(16)
        })

        column.addView(skipButton(getString(R.string.skip_no_log), "none", WatchColors.SurfaceStrong), buttonLayout())
        column.addView(skipButton(getString(R.string.skip_elapsed), "elapsed", WatchColors.Timer), buttonLayout())
        column.addView(skipButton(getString(R.string.skip_full), "full", WatchColors.LongBreak), buttonLayout())

        setContentView(root)
    }

    private fun buttonLayout(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(dp(112), dp(30)).apply {
            bottomMargin = dp(6)
        }
    }

    private fun skipButton(label: String, mode: String, color: Int): TextView {
        return pillButton(label, color).apply {
            textSize = 10.5f
            minHeight = 0
            minimumHeight = 0
            setOnClickListener { submitSkip(mode) }
        }
    }

    private fun submitSkip(mode: String) {
        if (isSubmitting) return
        val state = WatchActionCoordinator.snapshot()
        if (state.authRequired || state.networkBlocked) {
            statusText.text = if (state.authRequired) getString(R.string.login_required) else getString(R.string.reconnecting)
            statusText.setTextColor(WatchColors.Muted)
            return
        }
        isSubmitting = true
        statusText.text = getString(R.string.skipping)
        statusText.setTextColor(WatchColors.Muted)
        WatchActionCoordinator.enqueue(
            PendingWatchAction.timer("skip", sessionStore.cachedStatus?.status?.timer?.type ?: "work", mode)
        )
        TileService.getUpdater(this).requestUpdate(PomiTileService::class.java)
        setResult(RESULT_OK)
        finish()
    }

    private fun handleError(error: Exception) {
        if (error is WatchApiException && error.code == 401) {
            sessionStore.clear()
            openLogin()
            return
        }
        statusText.text = getString(R.string.sync_failed)
        statusText.setTextColor(WatchColors.Error)
    }

    private fun openLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}
