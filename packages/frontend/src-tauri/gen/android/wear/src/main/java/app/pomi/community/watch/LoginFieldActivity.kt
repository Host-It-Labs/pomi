package app.pomi.community.watch

import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class LoginFieldActivity : WatchActivity() {
    private lateinit var input: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildView()
        input.setOnClickListener { focusAndShowKeyboard() }
        input.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) showKeyboard()
        }
    }

    private fun buildView() {
        val title = intent.getStringExtra(EXTRA_TITLE) ?: getString(R.string.edit)
        val value = intent.getStringExtra(EXTRA_VALUE) ?: ""
        val secret = intent.getBooleanExtra(EXTRA_SECRET, false)
        val root = watchRoot()
        root.setPadding(dp(18), dp(18), dp(18), dp(16))

        root.addView(TextView(this).apply {
            text = title
            watchText(14f, WatchColors.Text, Typeface.BOLD)
        }, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(28),
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ))

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        root.addView(column, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        ))

        input = EditText(this).apply {
            setText(value)
            setSingleLine(true)
            textSize = 12f
            setTextColor(WatchColors.Text)
            setHintTextColor(WatchColors.Muted)
            setPadding(dp(10), 0, dp(10), 0)
            background = outlinedBackground(WatchColors.Assistant, dp(15).toFloat())
            imeOptions = EditorInfo.IME_ACTION_DONE
            inputType = if (secret) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            }
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    finishWithValue()
                    true
                } else {
                    false
                }
            }
        }
        column.addView(input, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(34)
        ))

        val done = pillButton(getString(R.string.done), WatchColors.Assistant).apply {
            textSize = 10.5f
            setOnClickListener { finishWithValue() }
        }
        column.addView(done, LinearLayout.LayoutParams(dp(106), dp(30)).apply {
            topMargin = dp(10)
        })

        val cancel = pillButton(getString(R.string.cancel), WatchColors.SurfaceStrong).apply {
            textSize = 9.5f
            setOnClickListener { finish() }
        }
        column.addView(cancel, LinearLayout.LayoutParams(dp(92), dp(26)).apply {
            topMargin = dp(6)
        })

        setContentView(root)
        input.requestFocus()
        input.setSelection(input.text.length)
    }

    private fun focusAndShowKeyboard() {
        input.requestFocus()
        input.setSelection(input.text.length)
        input.post { showKeyboard() }
    }

    private fun showKeyboard() {
        val keyboard = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        keyboard.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun finishWithValue() {
        val result = Intent().putExtra(EXTRA_VALUE, input.text.toString())
        setResult(RESULT_OK, result)
        finish()
    }

    companion object {
        const val EXTRA_TITLE = "title"
        const val EXTRA_VALUE = "value"
        const val EXTRA_SECRET = "secret"
    }
}
