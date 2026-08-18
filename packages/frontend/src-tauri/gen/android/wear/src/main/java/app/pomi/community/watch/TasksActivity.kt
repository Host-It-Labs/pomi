package app.pomi.community.watch

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

class TasksActivity : WatchActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var sessionStore: WatchSessionStore
    private lateinit var apiClient: WatchApiClient
    private lateinit var list: LinearLayout
    private lateinit var statusText: TextView
    private var isCompleting = false
    private var completingActionId: String? = null
    private var isRefreshing = false
    private var isVisible = false
    private var networkBlocked = false
    private var currentStatus: WatchStatus? = null
    private var removeQueueListener: (() -> Unit)? = null
    private val pollTasks = object : Runnable {
        override fun run() {
            if (!isVisible) return
            refreshTasks(background = true)
            mainHandler.postDelayed(this, TASK_POLL_INTERVAL_MS)
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
                val lifecycle = state.lifecycle
                val completedAction = completingActionId?.let { id ->
                    lifecycle?.let { it.id == id && it.isTerminal && state.active == null }
                } == true
                if (completedAction) {
                    completingActionId = null
                    isCompleting = false
                }
                if (state.networkBlocked) {
                    statusText.visibleWhen(true)
                    statusText.text = getString(R.string.reconnecting)
                    statusText.setTextColor(WatchColors.Muted)
                    list.alpha = 0.5f
                } else {
                    list.alpha = 1f
                    if (state.confirmedStatus != null && (wasNetworkBlocked || completedAction) && isVisible) {
                        refreshTasks(background = true)
                    }
                    if (state.terminalError != null && state.confirmedStatus == null) {
                        statusText.visibleWhen(true)
                        statusText.text = localizedWatchMessage(state.terminalError)
                        statusText.setTextColor(WatchColors.Error)
                    }
                }
                setTaskCompletionEnabled(!state.networkBlocked && !state.authRequired && !isCompleting)
                if (state.authRequired && sessionStore.isReady && !isFinishing && !isDestroyed) {
                    sessionStore.clear()
                    openLogin()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        isVisible = true
        if (sessionStore.isReady) {
            WatchActionCoordinator.retryAfterReconnect()
            refreshTasks()
            mainHandler.removeCallbacks(pollTasks)
            mainHandler.postDelayed(pollTasks, TASK_POLL_INTERVAL_MS)
        } else openLogin()
    }

    override fun onPause() {
        isVisible = false
        mainHandler.removeCallbacks(pollTasks)
        super.onPause()
    }

    override fun onDestroy() {
        removeQueueListener?.invoke()
        worker.shutdown()
        mainHandler.removeCallbacks(pollTasks)
        super.onDestroy()
    }

    private fun buildView() {
        val root = watchRoot()
        root.setPadding(dp(26), dp(16), dp(26), dp(12))

        root.addView(TextView(this).apply {
            text = getString(R.string.tasks)
            watchText(16f, WatchColors.Text, Typeface.BOLD)
        }, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(38),
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
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
            topMargin = dp(38)
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

    private fun refreshTasks(background: Boolean = false) {
        if (isCompleting || isRefreshing) return
        isRefreshing = true
        if (!background || list.childCount == 0) {
            statusText.visibleWhen(true)
            statusText.text = getString(R.string.syncing)
            statusText.setTextColor(WatchColors.Muted)
        }
        worker.execute {
            try {
                val status = apiClient.getStatus(taskMode = "general", limit = 12)
                runOnUiThread {
                    isRefreshing = false
                    renderTasks(status)
                    WatchActionCoordinator.reportNetworkSuccess(status)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    isRefreshing = false
                    handleError(error)
                }
            }
        }
    }

    private fun renderTasks(status: WatchStatus) {
        currentStatus = status
        list.removeAllViews()
        statusText.text = ""
        statusText.visibleWhen(false)
        statusText.setTextColor(WatchColors.Muted)

        if (status.tasks.isEmpty()) {
            list.addView(TextView(this).apply {
                text = getString(R.string.no_active_tasks)
                watchText(12f, WatchColors.Muted)
                setPadding(0, dp(28), 0, 0)
            })
            return
        }

        status.tasks.forEach { task ->
            list.addView(taskRow(task), LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(5)
            })
        }
        setTaskCompletionEnabled(!WatchActionCoordinator.snapshot().networkBlocked)
    }

    private fun taskRow(task: WatchTask): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(13), dp(7), dp(10), dp(7))
            background = outlinedBackground(
                if (task.isOverdue) WatchColors.Error else WatchColors.SurfaceStroke,
                dp(17).toFloat(),
                WatchColors.SurfaceSoft
            )

            val textColumn = LinearLayout(this@TasksActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
            }
            textColumn.addView(TextView(this@TasksActivity).apply {
                text = task.title
                watchText(12f, WatchColors.Text, Typeface.BOLD)
                gravity = Gravity.START
                maxLines = 1
            })
            textColumn.addView(TextView(this@TasksActivity).apply {
                text = taskMeta(task)
                watchText(8.5f, if (task.isOverdue) WatchColors.Error else WatchColors.Muted)
                gravity = Gravity.START
                maxLines = 1
                setPadding(0, dp(3), 0, 0)
            })
            addView(textColumn, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            val completeButton = plainIconButton(R.drawable.ic_watch_circle, getString(R.string.complete_task), WatchColors.IconMuted).apply {
                setOnClickListener {
                    completeTask(task)
                }
            }
            addView(completeButton, LinearLayout.LayoutParams(dp(32), dp(32)).apply {
                leftMargin = dp(8)
            })
        }
    }

    private fun taskMeta(task: WatchTask): String {
        val due = when {
            task.dueDate != null && task.dueTime != null -> "${compactDate(task.dueDate)} ${task.dueTime}"
            task.dueDate != null -> compactDate(task.dueDate)
            else -> null
        }
        val flags = listOfNotNull(
            if (task.isFocused) getString(R.string.pinned) else null,
            if (task.isOverdue) getString(R.string.overdue) else null
        )
        return listOfNotNull(
            task.localizedPriorityLabel(this),
            due,
            flags.joinToString(" / ").ifBlank { null }
        ).joinToString(" / ")
    }

    private fun compactDate(date: String): String {
        return if (date.length >= 10) date.substring(5, 10) else date
    }

    private fun completeTask(task: WatchTask) {
        if (isCompleting) return
        val state = WatchActionCoordinator.snapshot()
        if (state.networkBlocked || state.authRequired) {
            statusText.visibleWhen(true)
            statusText.text = if (state.authRequired) getString(R.string.login_required) else getString(R.string.reconnecting)
            statusText.setTextColor(WatchColors.Muted)
            return
        }
        val action = PendingWatchAction.completeTask(task.id)
        isCompleting = true
        completingActionId = action.id
        setTaskCompletionEnabled(false)
        statusText.visibleWhen(true)
        statusText.text = getString(R.string.syncing)
        statusText.setTextColor(WatchColors.Muted)
        WatchActionCoordinator.enqueue(action)
    }

    private fun setTaskCompletionEnabled(enabled: Boolean) {
        for (index in 0 until list.childCount) {
            val row = list.getChildAt(index) as? ViewGroup ?: continue
            if (row.childCount < 2) continue
            row.getChildAt(1).isEnabled = enabled
            row.getChildAt(1).alpha = if (enabled) 1f else 0.45f
        }
    }

    private fun handleError(error: Exception) {
        when (classifyWatchFailure(error)) {
            WatchFailureKind.AUTH -> {
                WatchActionCoordinator.reportNetworkFailure(error)
            }
            WatchFailureKind.TRANSIENT -> {
                WatchActionCoordinator.reportNetworkFailure(error)
                statusText.visibleWhen(false)
                setTaskCompletionEnabled(false)
            }
            WatchFailureKind.TERMINAL -> {
                WatchActionCoordinator.reportNetworkFailure(error)
                statusText.visibleWhen(true)
                statusText.text = localizedWatchMessage(error.message) ?: getString(R.string.sync_failed)
                statusText.setTextColor(WatchColors.Error)
            }
        }
    }

    private fun openLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    companion object {
        private const val TASK_POLL_INTERVAL_MS = 3_000L
    }
}
