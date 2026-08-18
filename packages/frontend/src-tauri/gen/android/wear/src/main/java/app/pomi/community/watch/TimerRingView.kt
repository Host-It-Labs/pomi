package app.pomi.community.watch

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View

class TimerRingView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = WatchColors.SurfaceStrong
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val progressPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = WatchColors.Timer
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val rect = RectF()

    var progress: Float = 0f
        set(value) {
            field = value.coerceIn(0f, 1f)
            invalidate()
        }

    var accentColor: Int = WatchColors.Work
        set(value) {
            field = value
            progressPaint.color = if (active) value else WatchColors.Muted
            invalidate()
        }

    var active: Boolean = false
        set(value) {
            field = value
            progressPaint.color = if (value) accentColor else WatchColors.Muted
            invalidate()
        }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val stroke = context.dp(5).toFloat()
        trackPaint.strokeWidth = stroke
        progressPaint.strokeWidth = stroke
        val inset = stroke / 2f + context.dp(3)
        rect.set(inset, inset, width - inset, height - inset)
        canvas.drawOval(rect, trackPaint)
        canvas.drawArc(
            rect,
            -90f,
            WatchRingPresentation.sweepDegrees(progress),
            false,
            progressPaint
        )
    }
}
