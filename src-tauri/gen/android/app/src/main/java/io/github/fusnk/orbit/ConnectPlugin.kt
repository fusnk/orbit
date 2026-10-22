package io.github.fusnk.orbit

import android.app.Activity
import android.content.Context
import android.net.wifi.WifiManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class MulticastArgs {
  var on: Boolean = false
}

/**
 * Orbit Connect's part on Android (src-tauri/src/android/connect.rs): Wi-Fi's
 * multicast lock. Android filters incoming multicast to save power unless an
 * app holds this lock, and finding other Orbits (mDNS) is multicast. It's held
 * only while Orbit Connect is on, and released when it's turned off or Orbit
 * closes. Called from Rust only: the plugin's IPC handler refuses the page.
 */
@TauriPlugin
class ConnectPlugin(private val activity: Activity) : Plugin(activity) {
  private var lock: WifiManager.MulticastLock? = null

  @Command
  @Synchronized
  fun multicast(invoke: Invoke) {
    val args = invoke.parseArgs(MulticastArgs::class.java)
    try {
      if (args.on) {
        val held = lock ?: (activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
          .createMulticastLock("orbit-connect")
          .apply { setReferenceCounted(false) }
          .also { lock = it }
        if (!held.isHeld) held.acquire()
      } else {
        lock?.takeIf { it.isHeld }?.release()
      }
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("multicast lock unavailable")
    }
  }

  override fun onDestroy() {
    lock?.takeIf { it.isHeld }?.release()
    super.onDestroy()
  }
}
