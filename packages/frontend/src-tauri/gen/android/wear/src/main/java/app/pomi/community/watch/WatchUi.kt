package app.pomi.community.watch

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import java.util.Locale
import kotlin.math.roundToInt

object WatchColors {
    val White: Int = Color.WHITE
    val Background: Int = Color.rgb(5, 5, 6)
    val Surface: Int = Color.rgb(18, 27, 34)
    val SurfaceStrong: Int = Color.rgb(39, 39, 42)
    val SurfaceSoft: Int = Color.rgb(15, 23, 30)
    val SurfaceStroke: Int = Color.rgb(43, 55, 64)
    val Text: Int = Color.rgb(248, 250, 252)
    val Icon: Int = Color.rgb(203, 213, 225)
    val IconMuted: Int = Color.rgb(148, 163, 184)
    val Muted: Int = Color.rgb(161, 161, 170)
    val Blue: Int = Color.rgb(59, 130, 246)
    val Work: Int = Color.rgb(79, 70, 229)
    val Break: Int = Color.rgb(16, 185, 129)
    val LongBreak: Int = Color.rgb(147, 51, 234)
    val Timer: Int = Work
    val Assistant: Int = Blue
    val SessionStack: Int = Color.rgb(245, 158, 11)
    val IconWell: Int = Color.rgb(15, 23, 30)
    val Error: Int = Color.rgb(248, 113, 113)
}

fun Context.dp(value: Int): Int {
    return (value * resources.displayMetrics.density).roundToInt()
}

fun Activity.watchRoot(): FrameLayout {
    return FrameLayout(this).apply {
        setBackgroundColor(WatchColors.Background)
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
    }
}

fun TextView.watchText(
    textSizeSp: Float,
    color: Int = WatchColors.Text,
    typefaceStyle: Int = Typeface.NORMAL
): TextView {
    textSize = textSizeSp
    setTextColor(color)
    gravity = Gravity.CENTER
    typeface = Typeface.create(Typeface.DEFAULT, typefaceStyle)
    includeFontPadding = false
    letterSpacing = 0f
    return this
}

fun Context.pillButton(label: String, color: Int): TextView {
    return TextView(this).apply {
        text = label
        watchText(11f, WatchColors.Text, Typeface.BOLD)
        minHeight = dp(36)
        minWidth = dp(52)
        setPadding(dp(8), dp(4), dp(8), dp(4))
        background = roundedBackground(color, dp(18).toFloat())
        isClickable = true
        isFocusable = true
    }
}

fun Context.pressablePillBackground(normalColor: Int, pressedColor: Int, radiusDp: Int): StateListDrawable {
    return StateListDrawable().apply {
        addState(
            intArrayOf(android.R.attr.state_pressed),
            roundedBackground(pressedColor, dp(radiusDp).toFloat())
        )
        addState(
            intArrayOf(),
            roundedBackground(normalColor, dp(radiusDp).toFloat())
        )
    }
}

fun Context.iconPill(label: String, color: Int): TextView {
    return TextView(this).apply {
        text = label
        watchText(10f, WatchColors.Text, Typeface.BOLD)
        maxLines = 2
        setPadding(dp(8), dp(4), dp(8), dp(4))
        background = roundedBackground(color, dp(16).toFloat())
        isClickable = true
        isFocusable = true
    }
}

fun Context.circleButton(label: String, color: Int, textSizeSp: Float = 17f): TextView {
    return TextView(this).apply {
        text = label
        watchText(textSizeSp, WatchColors.Text, Typeface.BOLD)
        minHeight = 0
        minWidth = 0
        setPadding(0, 0, 0, 0)
        background = roundedBackground(color, dp(24).toFloat())
        isClickable = true
        isFocusable = true
    }
}

fun Context.iconWellButton(
    iconResId: Int,
    description: String,
    tint: Int = WatchColors.Icon
): ImageButton {
    return ImageButton(this).apply {
        contentDescription = description
        setImageResource(iconResId)
        setColorFilter(tint)
        scaleType = ImageView.ScaleType.CENTER
        setPadding(dp(6), dp(6), dp(6), dp(6))
        background = outlinedBackground(WatchColors.SurfaceStroke, dp(22).toFloat(), WatchColors.IconWell)
        isClickable = true
        isFocusable = true
    }
}

fun Context.plainIconButton(
    iconResId: Int,
    description: String,
    tint: Int = WatchColors.Icon
): ImageButton {
    return ImageButton(this).apply {
        contentDescription = description
        setImageResource(iconResId)
        setColorFilter(tint)
        scaleType = ImageView.ScaleType.CENTER
        setPadding(dp(4), dp(4), dp(4), dp(4))
        background = null
        isClickable = true
        isFocusable = true
    }
}

fun Context.backIconButton(): ImageButton {
    return iconWellButton(R.drawable.ic_watch_back, getString(R.string.back))
}

fun Context.circleIconButton(
    iconResId: Int,
    color: Int,
    description: String,
    tint: Int = WatchColors.Text
): ImageButton {
    return ImageButton(this).apply {
        contentDescription = description
        setImageResource(iconResId)
        setColorFilter(tint)
        scaleType = ImageView.ScaleType.CENTER
        setPadding(dp(11), dp(11), dp(11), dp(11))
        background = roundedBackground(color, dp(24).toFloat())
        isClickable = true
        isFocusable = true
    }
}

fun Context.textActionButton(
    label: String,
    tint: Int = WatchColors.Icon,
    textSizeSp: Float = 15f
): TextView {
    return TextView(this).apply {
        text = label
        watchText(textSizeSp, tint, Typeface.BOLD)
        minHeight = 0
        minWidth = 0
        setPadding(0, 0, 0, 0)
        background = null
        isClickable = true
        isFocusable = true
    }
}

fun roundedBackground(color: Int, radius: Float): GradientDrawable {
    return GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(color)
        cornerRadius = radius
    }
}

fun outlinedBackground(strokeColor: Int, radius: Float): GradientDrawable {
    return outlinedBackground(strokeColor, radius, WatchColors.Surface)
}

fun outlinedBackground(strokeColor: Int, radius: Float, fillColor: Int): GradientDrawable {
    return GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(fillColor)
        setStroke(1, strokeColor)
        cornerRadius = radius
    }
}

fun ovalBackground(
    fillColor: Int,
    strokeColor: Int,
    strokeWidth: Int = 1
): GradientDrawable {
    return GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(fillColor)
        setStroke(strokeWidth, strokeColor)
    }
}

fun View.visibleWhen(visible: Boolean) {
    visibility = if (visible) View.VISIBLE else View.GONE
}

fun formatTimerMillis(value: Long): String {
    val totalSeconds = (value / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds)
}

fun Context.timerTypeLabel(value: String): String {
    return when (value) {
        "work" -> getString(R.string.work)
        "break" -> getString(R.string.break_label)
        "longBreak" -> getString(R.string.long_break)
        else -> value.replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString()
        }
    }
}

fun Context.timerStatusLabel(value: String): String {
    return when (value) {
        "running" -> getString(R.string.running)
        "paused" -> getString(R.string.paused)
        "completed" -> getString(R.string.status_done)
        else -> value
    }
}

internal object WatchQueueMessages {
    const val ACCOUNT_CHANGED = "account_changed"
}

private const val REQUEST_FAILED_PREFIX = "request_failed:"

internal fun requestFailedMessage(code: Int): String = "$REQUEST_FAILED_PREFIX$code"

fun Context.localizedWatchMessage(message: String?): String? {
    return when (message) {
        WatchQueueMessages.ACCOUNT_CHANGED -> getString(R.string.queued_actions_discarded)
        null -> null
        else -> if (message.startsWith(REQUEST_FAILED_PREFIX)) {
            message.removePrefix(REQUEST_FAILED_PREFIX).toIntOrNull()?.let { statusCode ->
                getString(R.string.request_failed, statusCode)
            } ?: message
        } else message
    }
}

fun timerAccentColor(value: String?): Int {
    return when (value) {
        "break" -> WatchColors.Break
        "longBreak" -> WatchColors.LongBreak
        else -> WatchColors.Work
    }
}
