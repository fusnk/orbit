package io.github.fusnk.orbit

import android.app.SearchManager
import android.content.Intent
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    // Before Rust starts: its HTTPS requests check certificates through Android, which needs the context.
    TlsInit.init(applicationContext)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // A remote's Back is Orbit's Back (src/app/back.ts): it closes what's open, then goes back through
  // pages, as Esc does on a PC. Only when Orbit has nowhere left to go does Android get it and
  // return to the launcher. Added after wry's own callback (which only knows browser history), so it runs first.
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    takeKeys()
    searchFrom(intent)
    watchNextFrom(intent)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("window.__orbitBack ? window.__orbitBack() : false") { handled ->
          if (handled != "true") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onResume() {
    super.onResume()
    takeKeys()
  }

  // A remote has no pointer to click into the page with: without Android's focus on the WebView,
  // the first key after opening Orbit would only move focus there. Only when it hasn't got it:
  // taking focus again makes the WebView move the page's focus to the first thing it can, away from
  // what the page chose (a failure's Back button, say).
  private fun takeKeys() {
    webView?.apply {
      if (hasFocus()) return
      isFocusable = true
      isFocusableInTouchMode = true
      requestFocus()
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    searchFrom(intent)
    watchNextFrom(intent)
  }

  /** A search aimed at Orbit (the system's or Assistant's): Search opens with it, once the page can take it. */
  private fun searchFrom(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEARCH) return
    val query = intent.getStringExtra(SearchManager.QUERY)?.take(200)?.takeIf { it.isNotBlank() } ?: return
    // Once: a later resume mustn't search again.
    intent.action = null
    deliver("__orbitSearch", query, 20)
  }

  /**
   * A title picked in the home screen's Continue Watching (WatchNext.kt): Orbit plays it, if the
   * profile that comes up has it in its own list. Waits up to a minute, as "Who's watching?" may ask first.
   */
  private fun watchNextFrom(intent: Intent?) {
    if (intent?.action != WatchNext.ACTION) return
    val id = intent.getStringExtra(WatchNext.EXTRA_TITLE)?.take(200)?.takeIf { it.isNotBlank() } ?: return
    intent.action = null
    deliver("__orbitWatchNext", id, 120)
  }

  /** Calls the page's `window[name](text)` once the page has it and takes it (says true), every half second. */
  private fun deliver(name: String, text: String, tries: Int) {
    val view = webView ?: return
    view.evaluateJavascript("window.$name ? window.$name(${org.json.JSONObject.quote(text)}) : false") { taken ->
      if (taken != "true" && tries > 0) view.postDelayed({ deliver(name, text, tries - 1) }, 500)
    }
  }
}
