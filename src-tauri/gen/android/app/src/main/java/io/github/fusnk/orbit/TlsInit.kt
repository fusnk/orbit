package io.github.fusnk.orbit

import android.content.Context

/** Hands Rust the app context its HTTPS certificate checks need (src-tauri/src/android/tls.rs). */
object TlsInit {
  init {
    System.loadLibrary("orbit_lib")
  }

  @JvmStatic
  external fun init(context: Context)
}
