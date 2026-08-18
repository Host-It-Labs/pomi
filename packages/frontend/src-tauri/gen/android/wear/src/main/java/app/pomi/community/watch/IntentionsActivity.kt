package app.pomi.community.watch

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

class IntentionsActivity : WatchActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var sessionStore: WatchSessionStore
    private lateinit var apiClient: WatchApiClient
    private lateinit var list: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var titleText: TextView
    private var isSubmitting = false
    private var selectedSlugs = emptySet<String>()
    private var selectedSubIntentions = emptyMap<String, String>()
    private var multiSelectEnabled = false
    private var requireSelection = false
    private var currentTimerType = "work"
    private var rootIntentions = emptyList<WatchIntentionOption>()
    private var activeParent: WatchIntentionOption? = null
    private var networkBlocked = false
    private var isVisible = false
    private var isLoading = false
    private var removeQueueListener: (() -> Unit)? = null
    private val pollIntentions = object : Runnable {
        override fun run() {
            if (!isVisible) return
            loadIntentions()
            mainHandler.postDelayed(this, INTENTIONS_POLL_INTERVAL_MS)
        }
    }

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
                val wasNetworkBlocked = networkBlocked
                networkBlocked = state.networkBlocked
                setListEnabled(!state.networkBlocked)
                if (state.networkBlocked) {
                    statusText.text = getString(R.string.reconnecting)
                    statusText.setTextColor(WatchColors.Muted)
                    statusText.visibleWhen(true)
                } else if (state.terminalError != null && state.confirmedStatus == null) {
                    statusText.text = localizedWatchMessage(state.terminalError)
                    statusText.setTextColor(WatchColors.Error)
                    statusText.visibleWhen(true)
                } else if (state.confirmedStatus != null && wasNetworkBlocked && !isFinishing) {
                    loadIntentions()
                }
                if (state.authRequired && sessionStore.isReady && !isFinishing && !isDestroyed) {
                    sessionStore.clear()
                    openLogin()
                }
            }
        }
        loadIntentions()
    }

    override fun onDestroy() {
        removeQueueListener?.invoke()
        mainHandler.removeCallbacks(pollIntentions)
        worker.shutdown()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        isVisible = true
        if (sessionStore.isReady) {
            WatchActionCoordinator.retryAfterReconnect()
            mainHandler.removeCallbacks(pollIntentions)
            mainHandler.postDelayed(pollIntentions, INTENTIONS_POLL_INTERVAL_MS)
        }
    }

    override fun onPause() {
        isVisible = false
        mainHandler.removeCallbacks(pollIntentions)
        super.onPause()
    }

    private fun buildView() {
        val root = watchRoot()
        root.setPadding(dp(26), dp(16), dp(26), dp(12))

        val header = FrameLayout(this)
        root.addView(header, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(38),
            Gravity.TOP
        ))

        titleText = TextView(this).apply {
            text = getString(R.string.intentions)
            watchText(16f, WatchColors.Text, Typeface.BOLD)
        }
        header.addView(titleText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(34),
            Gravity.CENTER
        ))

        statusText = TextView(this).apply {
            text = getString(R.string.syncing)
            watchText(9.5f, WatchColors.Muted)
            maxLines = 1
        }
        root.addView(statusText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(16),
            Gravity.TOP
        ).apply {
            topMargin = dp(40)
        })

        val scroller = ScrollView(this).apply {
            overScrollMode = ScrollView.OVER_SCROLL_IF_CONTENT_SCROLLS
        }
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(12))
        }
        scroller.addView(list)
        root.addView(scroller, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.TOP
        ).apply {
            topMargin = dp(58)
        })

        setContentView(root)
    }

    private fun loadIntentions() {
        if (isLoading) return
        isLoading = true
        statusText.text = getString(R.string.syncing)
        statusText.setTextColor(WatchColors.Muted)
        worker.execute {
            try {
                val intentions = apiClient.getIntentions()
                val status = apiClient.getStatus(taskMode = "intention", limit = 1)
                runOnUiThread {
                    isLoading = false
                    rootIntentions = intentions
                    currentTimerType = status.timer?.type ?: "work"
                    selectedSlugs = status.timer?.intentions.orEmpty().map { it.slug }.toSet()
                    selectedSubIntentions = status.timer?.intentions.orEmpty()
                        .mapNotNull { intention ->
                            intention.subSlug?.let { subSlug -> intention.slug to subSlug }
                        }
                        .toMap()
                    multiSelectEnabled = status.timerControls.intentionMultiSelect
                    requireSelection = status.timerControls.intentionRequireSelection
                    renderRootIntentions()
                    WatchActionCoordinator.reportNetworkSuccess(status)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    isLoading = false
                    handleError(error)
                }
            }
        }
    }

    private fun renderRootIntentions() {
        activeParent = null
        titleText.text = getString(R.string.intentions)
        renderList(rootIntentions, getString(R.string.no_intentions)) { intentionRow(it) }
    }

    private fun renderSubIntentions(parent: WatchIntentionOption) {
        activeParent = parent
        titleText.text = getString(R.string.sub_intentions)
        renderList(parent.subIntentions, getString(R.string.no_sub_intentions)) { subIntentionRow(parent, it) }
    }

    private fun <T> renderList(
        items: List<T>,
        emptyLabel: String,
        row: (T) -> LinearLayout
    ) {
        list.removeAllViews()
        statusText.text = ""
        statusText.visibleWhen(false)
        statusText.setTextColor(WatchColors.Muted)

        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = emptyLabel
                watchText(12f, WatchColors.Muted)
                setPadding(0, dp(28), 0, 0)
            })
            return
        }

        items.forEach { item ->
            list.addView(row(item), LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(5)
            })
        }
        setListEnabled(!WatchActionCoordinator.snapshot().networkBlocked)
    }

    private fun setListEnabled(enabled: Boolean) {
        list.alpha = if (enabled) 1f else 0.55f
        for (index in 0 until list.childCount) {
            // Scrolling and parent/sub-intention navigation remain available while the
            // network is down. Individual selection handlers gate mutations below.
            list.getChildAt(index).isEnabled = true
        }
    }

    private fun intentionRow(intention: WatchIntentionOption): LinearLayout {
        val isSelected = selectedSlugs.contains(intention.slug)
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(5), dp(12), dp(5))
            background = roundedBackground(WatchColors.SurfaceSoft, dp(17).toFloat())
            isClickable = true
            isFocusable = true
            setOnClickListener {
                if (intention.subIntentions.isNotEmpty()) {
                    renderSubIntentions(intention)
                } else if (!networkBlocked) {
                    submitSelection(
                        WatchIntentionSelectionReducer.toggleParent(
                            selectedSlugs.toList(),
                            selectedSubIntentions,
                            intention.slug,
                            multiSelectEnabled,
                            requireSelection
                        )
                    )
                }
            }

            addView(TextView(this@IntentionsActivity).apply {
                text = intention.emoji
                watchText(18f, WatchColors.Text)
            }, LinearLayout.LayoutParams(dp(30), dp(30)).apply {
                rightMargin = dp(8)
            })

            addView(TextView(this@IntentionsActivity).apply {
                text = intention.title
                watchText(14f, WatchColors.Text, Typeface.BOLD)
                gravity = Gravity.START
                maxLines = 1
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            val radio = selectionRadio(isSelected).apply {
                if (isSelected && (!requireSelection || selectedSlugs.size > 1)) {
                    contentDescription = getString(R.string.remove_intention, intention.title)
                    isClickable = true
                    setOnClickListener {
                        if (networkBlocked) return@setOnClickListener
                        submitSelection(
                            WatchIntentionSelectionReducer.toggleParent(
                                selectedSlugs.toList(),
                                selectedSubIntentions,
                                intention.slug,
                                multiSelectEnabled,
                                requireSelection
                            )
                        )
                    }
                }
            }
            addView(radio, LinearLayout.LayoutParams(dp(24), dp(24)).apply {
                leftMargin = dp(8)
            })
        }
    }

    private fun subIntentionRow(
        parent: WatchIntentionOption,
        subIntention: WatchSubIntentionOption
    ): LinearLayout {
        val isSelected = selectedSubIntentions[parent.slug] == subIntention.slug
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(5), dp(12), dp(5))
            background = roundedBackground(WatchColors.SurfaceSoft, dp(17).toFloat())
            isClickable = true
            isFocusable = true
            setOnClickListener {
                if (networkBlocked) return@setOnClickListener
                submitSelection(
                    WatchIntentionSelectionReducer.selectChild(
                        selectedSlugs.toList(),
                        selectedSubIntentions,
                        parent.slug,
                        subIntention.slug,
                        multiSelectEnabled
                    )
                )
            }

            addView(TextView(this@IntentionsActivity).apply {
                text = subIntention.emoji
                watchText(18f, WatchColors.Text)
            }, LinearLayout.LayoutParams(dp(30), dp(30)).apply {
                rightMargin = dp(8)
            })

            addView(TextView(this@IntentionsActivity).apply {
                text = subIntention.title
                watchText(14f, WatchColors.Text, Typeface.BOLD)
                gravity = Gravity.START
                maxLines = 1
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(selectionRadio(isSelected), LinearLayout.LayoutParams(dp(24), dp(24)).apply {
                leftMargin = dp(8)
            })
        }
    }

    private fun selectionRadio(isSelected: Boolean): View {
        return FrameLayout(this).apply {
            addView(View(this@IntentionsActivity).apply {
                background = ovalBackground(
                    fillColor = if (isSelected) WatchColors.Blue else WatchColors.Background,
                    strokeColor = if (isSelected) WatchColors.Blue else WatchColors.IconMuted,
                    strokeWidth = dp(2)
                )
            }, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
            if (isSelected) {
                addView(View(this@IntentionsActivity).apply {
                    background = ovalBackground(WatchColors.SurfaceSoft, WatchColors.SurfaceSoft)
                }, FrameLayout.LayoutParams(dp(10), dp(10), Gravity.CENTER))
            }
        }
    }

    private fun submitSelection(selection: WatchIntentionSelection) {
        if (isSubmitting) return
        if (networkBlocked || WatchActionCoordinator.snapshot().authRequired) {
            statusText.text = if (WatchActionCoordinator.snapshot().authRequired) {
                getString(R.string.login_required)
            } else {
                getString(R.string.reconnecting)
            }
            statusText.setTextColor(WatchColors.Muted)
            statusText.visibleWhen(true)
            return
        }
        isSubmitting = true
        val action = PendingWatchAction.intentions(
            WatchIntentionSelectionAction.action(
                intent.getBooleanExtra(EXTRA_START_ON_SELECT, true)
            ),
            selection.slugs,
            selection.subIntentions,
            currentTimerType
        )
        WatchActionCoordinator.enqueue(action)
        finish()
    }

    private fun navigateBack() {
        if (activeParent != null) {
            renderRootIntentions()
            return
        }
        finish()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (activeParent != null) {
            renderRootIntentions()
            return
        }
        super.onBackPressed()
    }

    private fun handleError(error: Exception) {
        when (classifyWatchFailure(error)) {
            WatchFailureKind.AUTH -> {
                WatchActionCoordinator.reportNetworkFailure(error)
            }
            WatchFailureKind.TRANSIENT -> {
                WatchActionCoordinator.reportNetworkFailure(error)
                networkBlocked = true
                statusText.text = getString(R.string.reconnecting)
                statusText.setTextColor(WatchColors.Muted)
                statusText.visibleWhen(true)
                setListEnabled(false)
            }
            WatchFailureKind.TERMINAL -> {
                WatchActionCoordinator.reportNetworkFailure(error)
                statusText.text = localizedWatchMessage(error.message) ?: getString(R.string.sync_failed)
                statusText.setTextColor(WatchColors.Error)
                statusText.visibleWhen(true)
            }
        }
    }

    private fun openLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    companion object {
        const val EXTRA_START_ON_SELECT = "start_on_select"
        private const val INTENTIONS_POLL_INTERVAL_MS = 15_000L
    }
}
