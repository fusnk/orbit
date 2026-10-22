package io.github.fusnk.orbit

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SecretName {
  lateinit var name: String
}

@InvokeArg
class SecretValue {
  lateinit var name: String
  /** Base64, so binary secrets (the vault's data key) pass through unchanged. */
  lateinit var value: String
}

/**
 * Orbit's secrets on Android (keychain.rs's store there). One AES-256-GCM key
 * lives in the Android Keystore and never leaves it; each secret is sealed
 * under it with a fresh IV (the Keystore picks it) and its own name as
 * associated data, so one entry's ciphertext can't stand in for another's.
 * Only nonce + ciphertext reach app-private storage.
 *
 * Called from Rust only: keychain.rs registers it behind a plugin whose IPC
 * handler refuses every command, so the WebView can't read a secret back.
 * Errors are fixed strings and never include a secret.
 */
@TauriPlugin
class SecureStorePlugin(activity: Activity) : Plugin(activity) {
  private val prefs = activity.getSharedPreferences(STORE, Context.MODE_PRIVATE)

  @Command
  @Synchronized
  fun get(invoke: Invoke) {
    val args = invoke.parseArgs(SecretName::class.java)
    val sealed = prefs.getString(args.name, null)
    if (sealed == null) {
      invoke.resolve(JSObject())
      return
    }
    try {
      // A missing key with a sealed value (e.g. restored onto another device) is an error, not "no secret".
      val key = key(create = false) ?: return invoke.reject("secure storage is unavailable")
      val bytes = Base64.decode(sealed, Base64.NO_WRAP)
      if (bytes.size <= IV_BYTES) return invoke.reject("secure storage is unavailable")
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
      cipher.updateAAD(args.name.toByteArray(Charsets.UTF_8))
      val plain = cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES)
      invoke.resolve(JSObject().put("value", Base64.encodeToString(plain, Base64.NO_WRAP)))
      plain.fill(0)
    } catch (e: Exception) {
      invoke.reject("secure storage is unavailable")
    }
  }

  @Command
  @Synchronized
  fun set(invoke: Invoke) {
    val args = invoke.parseArgs(SecretValue::class.java)
    try {
      val plain = Base64.decode(args.value, Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
      cipher.updateAAD(args.name.toByteArray(Charsets.UTF_8))
      val sealed = cipher.iv + cipher.doFinal(plain)
      plain.fill(0)
      // commit, not apply: Rust carries on as if the secret is saved once this returns.
      if (!prefs.edit().putString(args.name, Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()) {
        return invoke.reject("secure storage is unavailable")
      }
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("secure storage is unavailable")
    }
  }

  @Command
  @Synchronized
  fun delete(invoke: Invoke) {
    val args = invoke.parseArgs(SecretName::class.java)
    if (!prefs.edit().remove(args.name).commit()) return invoke.reject("secure storage is unavailable")
    invoke.resolve()
  }

  private fun key(create: Boolean): SecretKey? {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    if (!create) return null
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private companion object {
    const val KEYSTORE = "AndroidKeyStore"
    const val ALIAS = "orbit-secrets"
    const val STORE = "orbit-secrets"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_BYTES = 12
    const val TAG_BITS = 128
  }
}
