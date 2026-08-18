package app.pomi.community.watch

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.media.MediaRecorder
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.util.concurrent.Executors

internal fun shouldDeleteAssistantRecording(
    file: File,
    cutoff: Long,
    referencedPaths: Set<String>
): Boolean = file.name.startsWith("assistant-") &&
    file.name.endsWith(".m4a") &&
    file.absolutePath !in referencedPaths &&
    file.lastModified() < cutoff

class AssistantActivity : WatchActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val tickHandler = Handler(Looper.getMainLooper())
    private lateinit var sessionStore: WatchSessionStore
    private lateinit var apiClient: WatchApiClient
    private lateinit var stateText: TextView
    private lateinit var resultText: TextView
    private lateinit var primaryButton: TextView
    private lateinit var cancelButton: TextView
    private var recorder: MediaRecorder? = null
    private var audioFile: File? = null
    private val recordingFiles = mutableListOf<File>()
    private var recordingStartedAt = 0L
    private var nextChunkAtMs = 0L
    private var recordingMaxMinutes: Int? = DEFAULT_RECORDING_MAX_MINUTES
    private var mediaPlayer: MediaPlayer? = null
    private var spokenAudioFile: File? = null
    private var sessionGeneration = 0
    private var discardOnPause = false
    private var submissionStarted = false
    @Volatile private var pendingActionId: String? = null
    private var removeQueueListener: (() -> Unit)? = null
    private val audioManager by lazy { getSystemService(AudioManager::class.java) }
    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    private val audioFocusRequest by lazy {
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(audioAttributes)
            .build()
    }

    private val recordingTick = object : Runnable {
        override fun run() {
            if (recorder == null) return
            val seconds = ((SystemClock.elapsedRealtime() - recordingStartedAt) / 1000).coerceAtLeast(0)
            primaryButton.text = WatchAssistantPresentation.recordingLabel(this@AssistantActivity, seconds)
            val maxSeconds = recordingMaxMinutes?.coerceAtLeast(1)?.times(60)
            if (maxSeconds != null && seconds >= maxSeconds) {
                handleRecordingInterruption(WatchAssistantInterruption.MAXIMUM_DURATION)
                return
            }
            val now = SystemClock.elapsedRealtime()
            if (now >= nextChunkAtMs) {
                rotateRecordingChunk(now)
            }
            tickHandler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionStore = WatchSessionStore(this)
        apiClient = WatchApiClient(sessionStore)
        WatchActionCoordinator.configure(apiClient)
        cleanupStaleRecordingFiles()
        if (!sessionStore.isReady) {
            openLogin()
            return
        }
        val cachedStatus = sessionStore.cachedStatus
        recordingMaxMinutes = if (cachedStatus == null) {
            DEFAULT_RECORDING_MAX_MINUTES
        } else {
            cachedStatus.status.assistant.recordingMaxMinutes
        }
        buildView()
        resetAssistantState()
        var adoptedExistingAssistantState = false
        removeQueueListener = WatchActionCoordinator.addListener { state ->
            runOnUiThread {
                if (pendingActionId == null && state.active?.kind == "assistantVoice") {
                    adoptedExistingAssistantState = true
                    pendingActionId = state.active.id
                }
                if (
                    pendingActionId == null &&
                    state.assistantResultUnconsumed &&
                    state.assistantLifecycle != null
                ) {
                    adoptedExistingAssistantState = true
                    pendingActionId = state.assistantLifecycle.id
                }
                val lifecycle = if (state.assistantLifecycle?.id == pendingActionId) {
                    state.assistantLifecycle
                } else {
                    state.lifecycle
                }
                val actionMatches =
                    state.active?.id == pendingActionId || lifecycle?.id == pendingActionId
                if (state.authRequired && sessionStore.isReady && !isFinishing && !isDestroyed) {
                    discardOnPause = true
                    handleRecordingInterruption(WatchAssistantInterruption.AUTHENTICATION_LOSS)
                    WatchActionCoordinator.cancelPreparingAssistant(pendingActionId)
                    sessionStore.clear()
                    openLogin()
                    return@runOnUiThread
                }
                if (!actionMatches) return@runOnUiThread
                if (state.networkBlocked) {
                    stateText.text = getString(R.string.reconnecting)
                    stateText.setTextColor(WatchColors.Muted)
                    primaryButton.isEnabled = false
                    primaryButton.alpha = 0.55f
                } else if (lifecycle != null && !lifecycle.isTerminal) {
                    primaryButton.isEnabled = false
                    primaryButton.alpha = 0.55f
                    primaryButton.text = getString(R.string.processing)
                }
                if (!state.networkBlocked && lifecycle?.isTerminal == true) {
                    handleActionLifecycle(lifecycle, state.assistantFinalizationPending)
                }
            }
        }
        primaryButton.post {
            if (pendingActionId == null && !adoptedExistingAssistantState) beginRecording()
        }
    }

    override fun onDestroy() {
        if (!submissionStarted) cancelRecording()
        releaseSpokenAudio()
        removeQueueListener?.invoke()
        setAssistantAwake(false)
        worker.shutdown()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (sessionStore.isReady) {
            WatchActionCoordinator.retryAfterReconnect()
        }
    }

    override fun onPause() {
        if (discardOnPause || !sessionStore.isReady) {
            handleRecordingInterruption(
                if (sessionStore.isReady) {
                    WatchAssistantInterruption.CANCEL
                } else {
                    WatchAssistantInterruption.AUTHENTICATION_LOSS
                }
            )
        } else if (recorder != null && !submissionStarted) {
            handleRecordingInterruption(WatchAssistantInterruption.BACKGROUND)
        }
        releaseSpokenAudio()
        setAssistantAwake(false)
        super.onPause()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_RECORD_AUDIO && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            beginRecording()
        } else if (requestCode == REQUEST_RECORD_AUDIO) {
            showError(getString(R.string.microphone_denied))
        }
    }

    private fun buildView() {
        val root = watchRoot()
        root.addView(TextView(this).apply {
            text = getString(R.string.assistant)
            watchText(17f, WatchColors.Text, Typeface.BOLD)
        }, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(30),
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ).apply { topMargin = dp(18) })

        stateText = TextView(this).apply {
            text = ""
            watchText(12f, WatchColors.Assistant, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        root.addView(stateText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(24),
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ).apply { topMargin = dp(48) })

        val scroller = ScrollView(this)
        resultText = TextView(this).apply {
            text = ""
            watchText(11f, WatchColors.Muted)
            gravity = Gravity.CENTER
            setPadding(dp(4), 0, dp(4), 0)
        }
        scroller.addView(resultText)
        root.addView(scroller, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58),
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ).apply {
            leftMargin = dp(24)
            rightMargin = dp(24)
            topMargin = dp(70)
        })

        cancelButton = pillButton("×  ${getString(R.string.cancel)}", WatchColors.SurfaceSoft).apply {
            textSize = 10f
            setTextColor(WatchColors.Icon)
            background = outlinedBackground(
                WatchColors.SurfaceStroke,
                dp(WatchAssistantPresentation.CANCEL_HEIGHT_DP / 2).toFloat(),
                WatchColors.SurfaceSoft
            )
            setOnClickListener {
                discardOnPause = true
                handleRecordingInterruption(WatchAssistantInterruption.CANCEL)
                finish()
            }
        }
        root.addView(cancelButton, FrameLayout.LayoutParams(
            dp(WatchAssistantPresentation.CANCEL_WIDTH_DP),
            dp(WatchAssistantPresentation.CANCEL_HEIGHT_DP),
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        ).apply {
            bottomMargin = dp(WatchAssistantPresentation.CANCEL_BOTTOM_MARGIN_DP)
        })

        primaryButton = pillButton(WatchAssistantPresentation.recordingLabel(this, 0), WatchColors.Assistant).apply {
            textSize = 11f
            background = pressablePillBackground(
                normalColor = WatchColors.Assistant,
                pressedColor = WatchColors.Work,
                radiusDp = WatchAssistantPresentation.PRIMARY_HEIGHT_DP / 2
            )
            setOnClickListener {
                if (recorder == null) {
                    beginRecording()
                } else {
                    handleRecordingInterruption(WatchAssistantInterruption.STOP)
                }
            }
        }
        root.addView(primaryButton, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(WatchAssistantPresentation.PRIMARY_HEIGHT_DP),
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        ).apply {
            leftMargin = dp(WatchAssistantPresentation.PRIMARY_HORIZONTAL_MARGIN_DP)
            rightMargin = dp(WatchAssistantPresentation.PRIMARY_HORIZONTAL_MARGIN_DP)
            bottomMargin = dp(WatchAssistantPresentation.PRIMARY_BOTTOM_MARGIN_DP)
        })

        setContentView(root)
    }

    private fun resetAssistantState() {
        sessionGeneration += 1
        stateText.text = ""
        resultText.text = ""
        primaryButton.text = WatchAssistantPresentation.recordingLabel(this, 0)
        primaryButton.isEnabled = true
        primaryButton.alpha = 1f
        cancelButton.isEnabled = true
        cancelButton.alpha = 1f
    }

    private fun beginRecording() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO)
            return
        }

        recordingFiles.forEach { it.delete() }
        recordingFiles.clear()
        discardOnPause = false
        submissionStarted = false
        val file = File(cacheDir, "assistant-${System.currentTimeMillis()}.m4a")
        val generation = ++sessionGeneration
        try {
            val nextRecorder = createRecorder(file)
            nextRecorder.prepare()
            nextRecorder.start()
            setAssistantAwake(true)
            recorder = nextRecorder
            audioFile = file
            recordingStartedAt = SystemClock.elapsedRealtime()
            nextChunkAtMs = recordingStartedAt + RECORDING_CHUNK_MS
            if (generation != sessionGeneration) return
            primaryButton.text = WatchAssistantPresentation.recordingLabel(this@AssistantActivity, 0)
            primaryButton.alpha = 1f
            cancelButton.isEnabled = true
            cancelButton.alpha = 1f
            resultText.text = ""
            stateText.setTextColor(WatchColors.Assistant)
            recordingTick.run()
        } catch (error: Exception) {
            releaseRecorder()
            showError(localizedWatchMessage(error.message) ?: getString(R.string.could_not_start_recording))
        }
    }

    private fun stopRecordingAndSend() {
        if (submissionStarted) return
        val file = audioFile ?: return
        val activeRecorder = recorder ?: return
        submissionStarted = true
        stopTick()
        try {
            activeRecorder.stop()
        } catch (error: Exception) {
            releaseRecorder()
            setAssistantAwake(false)
            showError(localizedWatchMessage(error.message) ?: getString(R.string.recording_too_short))
            return
        }
        releaseRecorder()
        audioFile = null
        recordingFiles += file
        val files = recordingFiles.toList()
        recordingFiles.clear()
        primaryButton.isEnabled = false
        primaryButton.alpha = 0.55f
        cancelButton.isEnabled = false
        cancelButton.alpha = 0.45f
        val generation = sessionGeneration
        primaryButton.text = getString(R.string.processing)
        stateText.text = ""
        resultText.text = ""

        worker.execute {
            var transferredFiles = false
            try {
                val action = if (files.size == 1) {
                    val audioBase64 = Base64.encodeToString(
                        files.first().readBytes(),
                        Base64.NO_WRAP
                    )
                    PendingWatchAction.assistantVoice(audioBase64, "audio/mp4")
                } else {
                    PendingWatchAction.assistantVoiceChunks(
                        files.map { chunk ->
                            WatchAudioChunk(
                                chunk.absolutePath,
                                "audio/mp4"
                            )
                        }
                    )
                }
                if (generation != sessionGeneration) return@execute
                pendingActionId = action.id
                WatchActionCoordinator.enqueue(action)
                transferredFiles = files.size > 1
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    primaryButton.text = getString(R.string.processing)
                    stateText.text = ""
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (generation == sessionGeneration && !isFinishing && !isDestroyed) handleError(error)
                }
            } finally {
                if (!transferredFiles) files.forEach { it.delete() }
            }
        }
    }

    private fun handleRecordingInterruption(interruption: WatchAssistantInterruption) {
        when (WatchAssistantInterruptionPolicy.action(interruption)) {
            WatchAssistantInterruptionAction.SUBMIT -> stopRecordingAndSend()
            WatchAssistantInterruptionAction.DISCARD -> {
                sessionGeneration += 1
                cancelRecording()
            }
        }
    }

    private fun rotateRecordingChunk(now: Long) {
        val activeRecorder = recorder ?: return
        val currentFile = audioFile ?: return
        try {
            activeRecorder.stop()
            releaseRecorder()
            recordingFiles += currentFile
            val nextFile = File(cacheDir, "assistant-${System.currentTimeMillis()}-$now.m4a")
            val nextRecorder = createRecorder(nextFile)
            nextRecorder.prepare()
            nextRecorder.start()
            recorder = nextRecorder
            audioFile = nextFile
            nextChunkAtMs = now + RECORDING_CHUNK_MS
        } catch (error: Exception) {
            releaseRecorder()
            audioFile = null
            currentFile.delete()
            recordingFiles.forEach { it.delete() }
            recordingFiles.clear()
            stopTick()
            setAssistantAwake(false)
            showError(localizedWatchMessage(error.message) ?: getString(R.string.could_not_continue_recording))
        }
    }

    private fun handleActionLifecycle(
        lifecycle: WatchActionLifecycle,
        finalizationPending: Boolean
    ) {
        if (lifecycle.id != pendingActionId) return
        if (!finalizationPending) pendingActionId = null
        cancelButton.isEnabled = true
        cancelButton.alpha = 1f
        if (lifecycle.status.lowercase() != "succeeded" || lifecycle.result == null) {
            primaryButton.isEnabled = true
            primaryButton.alpha = 1f
            primaryButton.text = getString(R.string.retry)
            setAssistantAwake(false)
            showError(
                if (lifecycle.outcomeUnknown) {
                    getString(R.string.assistant_outcome_unknown)
                } else {
                    localizedWatchMessage(lifecycle.message) ?: getString(R.string.assistant_failed)
                }
            )
            WatchActionCoordinator.consumeAssistantResult(lifecycle.id)
            return
        }

        val result = try {
            lifecycle.result.toAssistantVoiceResult()
        } catch (_: Exception) {
            primaryButton.isEnabled = true
            primaryButton.alpha = 1f
            primaryButton.text = getString(R.string.retry)
            setAssistantAwake(false)
            showError(getString(R.string.assistant_invalid_result))
            WatchActionCoordinator.consumeAssistantResult(lifecycle.id)
            return
        }
        showAssistantResult(result, finalizationPending)
        if (!finalizationPending) {
            WatchActionCoordinator.consumeAssistantResult(lifecycle.id)
        }
    }

    private fun showAssistantResult(
        result: AssistantVoiceResult,
        finalizationPending: Boolean
    ) {
        primaryButton.isEnabled = !finalizationPending
        primaryButton.alpha = if (finalizationPending) 0.55f else 1f
        primaryButton.text = if (finalizationPending) getString(R.string.finishing) else getString(R.string.listen_again)
        stateText.text = if (finalizationPending) getString(R.string.done_preparing_audio) else getString(R.string.done)
        stateText.setTextColor(WatchColors.Assistant)
        resultText.text = renderResult(result)
        if (finalizationPending || !playSpokenAudio(result)) {
            setAssistantAwake(false)
        }
    }

    private fun createRecorder(file: File): MediaRecorder {
        val nextRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(this)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        nextRecorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        nextRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        nextRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        nextRecorder.setAudioSamplingRate(16000)
        nextRecorder.setAudioEncodingBitRate(64000)
        nextRecorder.setOutputFile(file.absolutePath)
        return nextRecorder
    }

    private fun renderResult(result: AssistantVoiceResult): String {
        val actions = if (result.actions.isEmpty()) getString(R.string.none) else result.actions.joinToString(", ")
        return listOf(
            getString(R.string.heard, result.transcript.ifBlank { "-" }),
            result.message,
            getString(R.string.actions, actions)
        ).filter { it.isNotBlank() }.joinToString("\n")
    }

    private fun handleError(error: Exception) {
        if (error is WatchApiException && error.code == 401) {
            discardOnPause = true
            handleRecordingInterruption(WatchAssistantInterruption.AUTHENTICATION_LOSS)
            sessionStore.clear()
            openLogin()
            return
        }
        primaryButton.isEnabled = true
        primaryButton.alpha = 1f
        primaryButton.text = getString(R.string.retry)
        setAssistantAwake(false)
        showError(localizedWatchMessage(error.message) ?: getString(R.string.assistant_failed))
    }

    private fun showError(message: String) {
        stateText.text = getString(R.string.error)
        stateText.setTextColor(WatchColors.Error)
        resultText.text = message
    }

    private fun stopTick() {
        tickHandler.removeCallbacks(recordingTick)
    }

    private fun cancelRecording() {
        stopTick()
        val file = audioFile
        releaseRecorder()
        audioFile = null
        file?.delete()
        recordingFiles.forEach { it.delete() }
        recordingFiles.clear()
    }

    private fun releaseRecorder() {
        recorder?.release()
        recorder = null
    }

    private fun playSpokenAudio(result: AssistantVoiceResult): Boolean {
        val encoded = result.spokenAudioBase64 ?: return false
        if (encoded.isBlank()) return false
        val file = File(cacheDir, "assistant-response-${System.currentTimeMillis()}.mp3")
        return try {
            file.writeBytes(Base64.decode(encoded, Base64.DEFAULT))
            spokenAudioFile = file
            stateText.text = getString(R.string.speaking)
            audioManager.requestAudioFocus(audioFocusRequest)
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(audioAttributes)
                setDataSource(file.absolutePath)
                setOnCompletionListener {
                    stateText.text = getString(R.string.done)
                    releaseSpokenAudio()
                    setAssistantAwake(false)
                }
                setOnErrorListener { _, _, _ ->
                    releaseSpokenAudio()
                    setAssistantAwake(false)
                    true
                }
                prepare()
                start()
            }
            true
        } catch (_: Exception) {
            releaseSpokenAudio()
            false
        }
    }

    private fun releaseSpokenAudio() {
        mediaPlayer?.release()
        mediaPlayer = null
        audioManager.abandonAudioFocusRequest(audioFocusRequest)
        spokenAudioFile?.delete()
        spokenAudioFile = null
    }

    private fun setAssistantAwake(awake: Boolean) {
        if (awake) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun openLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private fun cleanupStaleRecordingFiles() {
        val cutoff = System.currentTimeMillis() - ORPHAN_RECORDING_MAX_AGE_MS
        val referencedPaths = WatchActionCoordinator.referencedAssistantChunkPaths()
        cacheDir.listFiles { file ->
            shouldDeleteAssistantRecording(file, cutoff, referencedPaths)
        }?.forEach { it.delete() }
    }

    companion object {
        const val EXTRA_AUTO_START = "auto_start"
        private const val REQUEST_RECORD_AUDIO = 41
        private const val DEFAULT_RECORDING_MAX_MINUTES = 10
        private const val RECORDING_CHUNK_MS = 60_000L
        private const val ORPHAN_RECORDING_MAX_AGE_MS = 24 * 60 * 60 * 1000L
    }
}
