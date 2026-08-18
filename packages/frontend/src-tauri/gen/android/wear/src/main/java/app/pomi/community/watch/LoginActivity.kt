package app.pomi.community.watch

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

class LoginActivity : WatchActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var sessionStore: WatchSessionStore
    private lateinit var apiClient: WatchApiClient
    private lateinit var backendValue: TextView
    private lateinit var usernameValue: TextView
    private lateinit var passwordValue: TextView
    private lateinit var statusText: TextView
    private lateinit var submitButton: TextView
    private var backendUrl = ""
    private var username = ""
    private var password = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionStore = WatchSessionStore(this)
        apiClient = WatchApiClient(sessionStore)
        backendUrl = sessionStore.defaultBackendUrl()
        username = sessionStore.username ?: ""
        buildView()
    }

    override fun onDestroy() {
        worker.shutdown()
        super.onDestroy()
    }

    private fun buildView() {
        val root = watchRoot()
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = ScrollView.OVER_SCROLL_IF_CONTENT_SCROLLS
        }
        root.addView(
            scroll,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(2), dp(8), dp(2))
        }
        scroll.addView(
            column,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        column.addView(TextView(this).apply {
            text = getString(R.string.login_title)
            watchText(14f, WatchColors.Text, Typeface.BOLD)
        })

        statusText = TextView(this).apply {
            text = getString(R.string.connect_backend)
            watchText(10f, WatchColors.Muted)
            setPadding(0, dp(4), 0, dp(4))
        }
        column.addView(statusText)

        column.addView(fieldRow(getString(R.string.backend), backendUrl, FIELD_BACKEND, secret = false), inputLayout())
        column.addView(fieldRow(getString(R.string.username), username, FIELD_USERNAME, secret = false), inputLayout())
        column.addView(fieldRow(getString(R.string.password), password, FIELD_PASSWORD, secret = true), inputLayout())

        if (isDebugBuild()) {
            val copymeButton = pillButton(getString(R.string.use_copyme), WatchColors.SurfaceStrong).apply {
                minHeight = 0
                minimumHeight = 0
                textSize = 10f
                setOnClickListener {
                    username = "copyme"
                    password = "copyme"
                    renderFieldValues()
                    statusText.text = getString(R.string.local_fixture_filled)
                    statusText.setTextColor(WatchColors.Muted)
                }
            }
            column.addView(copymeButton, LinearLayout.LayoutParams(dp(108), dp(28)).apply {
                topMargin = dp(2)
            })
        }

        submitButton = pillButton(getString(R.string.connect), WatchColors.Assistant).apply {
            minHeight = 0
            minimumHeight = 0
            textSize = 10.5f
            setOnClickListener { submitLogin() }
        }
        column.addView(submitButton, LinearLayout.LayoutParams(dp(108), dp(30)).apply {
            topMargin = dp(4)
        })

        setContentView(root)
    }

    private fun fieldRow(label: String, value: String, field: Int, secret: Boolean): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
            background = outlinedBackground(WatchColors.SurfaceStrong, dp(14).toFloat())
            isClickable = true
            isFocusable = true
            setOnClickListener { openFieldEditor(field) }
        }

        row.addView(TextView(this).apply {
            text = label
            watchText(8.5f, WatchColors.Muted, Typeface.BOLD)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            maxLines = 1
        }, LinearLayout.LayoutParams(dp(52), ViewGroup.LayoutParams.MATCH_PARENT))

        val valueText = TextView(this).apply {
            watchText(10.5f, WatchColors.Text, Typeface.BOLD)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            maxLines = 1
        }
        row.addView(valueText, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))

        row.addView(TextView(this).apply {
            text = getString(R.string.edit)
            watchText(8f, WatchColors.Assistant, Typeface.BOLD)
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(dp(28), ViewGroup.LayoutParams.MATCH_PARENT))

        when (field) {
            FIELD_BACKEND -> backendValue = valueText
            FIELD_USERNAME -> usernameValue = valueText
            FIELD_PASSWORD -> passwordValue = valueText
        }
        renderOneField(valueText, label, value, secret)
        return row
    }

    private fun inputLayout(): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(30)
        ).apply {
            bottomMargin = dp(4)
        }
    }

    @Deprecated("Deprecated in Android API 35, but enough for this small Wear flow.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data == null) return
        val value = data.getStringExtra(LoginFieldActivity.EXTRA_VALUE) ?: return
        when (requestCode) {
            FIELD_BACKEND -> backendUrl = value
            FIELD_USERNAME -> username = value
            FIELD_PASSWORD -> password = value
        }
        renderFieldValues()
    }

    private fun openFieldEditor(field: Int) {
        val (title, value, secret) = when (field) {
            FIELD_BACKEND -> Triple(getString(R.string.backend_url), backendUrl, false)
            FIELD_USERNAME -> Triple(getString(R.string.username), username, false)
            else -> Triple(getString(R.string.password), password, true)
        }
        val intent = Intent(this, LoginFieldActivity::class.java)
            .putExtra(LoginFieldActivity.EXTRA_TITLE, title)
            .putExtra(LoginFieldActivity.EXTRA_VALUE, value)
            .putExtra(LoginFieldActivity.EXTRA_SECRET, secret)
        startActivityForResult(intent, field)
    }

    private fun renderFieldValues() {
        renderOneField(backendValue, getString(R.string.backend), backendUrl, false)
        renderOneField(usernameValue, getString(R.string.username), username, false)
        renderOneField(passwordValue, getString(R.string.password), password, true)
    }

    private fun renderOneField(target: TextView, label: String, value: String, secret: Boolean) {
        target.text = when {
            value.isBlank() -> label
            secret -> "*".repeat(value.length.coerceAtMost(12))
            else -> value
        }
        target.setTextColor(if (value.isBlank()) WatchColors.Muted else WatchColors.Text)
    }

    private fun submitLogin() {
        val nextBackendUrl = backendUrl.trim()
        val nextUsername = username.trim()

        if (nextBackendUrl.isBlank() || nextUsername.isBlank() || password.isBlank()) {
            statusText.text = getString(R.string.all_fields_required)
            statusText.setTextColor(WatchColors.Error)
            return
        }

        setBusy(true, getString(R.string.connecting))
        worker.execute {
            try {
                val login = apiClient.login(nextBackendUrl, nextUsername, password)
                WatchActionCoordinator.beginAccountChange()
                sessionStore.saveSession(
                    nextBackendUrl,
                    nextUsername,
                    login.token,
                    login.language
                )
                WatchActionCoordinator.markAuthenticated()
                runOnUiThread {
                    startActivity(Intent(this, WatchFaceActivity::class.java))
                    finish()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    setBusy(false, localizedWatchMessage(error.message) ?: getString(R.string.login_failed))
                    statusText.setTextColor(WatchColors.Error)
                }
            }
        }
    }

    private fun setBusy(isBusy: Boolean, message: String) {
        submitButton.isEnabled = !isBusy
        submitButton.alpha = if (isBusy) 0.6f else 1f
        statusText.text = message
        statusText.setTextColor(if (isBusy) WatchColors.Muted else WatchColors.Text)
    }

    private fun isDebugBuild(): Boolean {
        return (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }

    companion object {
        private const val FIELD_BACKEND = 11
        private const val FIELD_USERNAME = 12
        private const val FIELD_PASSWORD = 13
    }
}
