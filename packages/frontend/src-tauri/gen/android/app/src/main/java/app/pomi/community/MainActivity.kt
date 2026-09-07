package app.pomi.community

import android.webkit.CookieManager
import android.webkit.WebView

class MainActivity : TauriActivity() {
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        // The bundled app and its HTTPS backend have different origins.
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }
}
