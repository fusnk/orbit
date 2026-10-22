package io.github.fusnk.orbit

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import app.tauri.annotation.InvokeArg
import java.util.concurrent.Executors

/** One title in Orbit's Continue Watching, as Rust checked it (src-tauri/src/watch_next.rs). */
@InvokeArg
class WatchNextItem {
  /** Orbit's title id: how the home screen's entry finds its title again. */
  lateinit var id: String
  /** "movie" or "series". */
  lateinit var kind: String
  lateinit var title: String
  var season: Int? = null
  var episode: Int? = null
  /** A public https picture; `wide` when it's 16:9 (else a 2:3 poster). */
  var art: String? = null
  var wide: Boolean = false
  var positionMs: Long = 0
  var durationMs: Long = 0
  /** The next episode, not one part-way through. */
  var next: Boolean = false
  var lastWatched: Long = 0
}

@InvokeArg
class WatchNextArgs {
  var items: List<WatchNextItem> = listOf()
}

/**
 * Orbit's Continue Watching on the Android TV home screen (Google TV's "Continue watching" row):
 * the system's Watch Next list, which shows each app only its own entries. An entry carries the
 * title's public name and picture and opens Orbit with its id, never an address to play.
 */
object WatchNext {
  /** MainActivity's action for an entry picked on the home screen; the title id rides in [EXTRA_TITLE]. */
  const val ACTION = "io.github.fusnk.orbit.WATCH_NEXT"
  const val EXTRA_TITLE = "title"

  // One at a time, off the UI thread: each sync reads and writes the provider.
  private val worker = Executors.newSingleThreadExecutor()

  fun publish(context: Context, items: List<WatchNextItem>, done: (Boolean) -> Unit) {
    val app = context.applicationContext
    // Only TVs have the home screen (and the provider) for it.
    if (!app.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return done(false)
    worker.execute { done(runCatching { sync(app, items) }.isSuccess) }
  }

  /** Makes the home screen's entries `items`: new ones added, changed ones updated, gone ones removed. */
  private fun sync(context: Context, items: List<WatchNextItem>) {
    val resolver = context.contentResolver
    val existing = mutableMapOf<String, WatchNextProgram>()
    resolver.query(TvContractCompat.WatchNextPrograms.CONTENT_URI, WatchNextProgram.PROJECTION, null, null, null)?.use { rows ->
      while (rows.moveToNext()) {
        val program = WatchNextProgram.fromCursor(rows)
        program.internalProviderId?.let { existing[it] = program }
      }
    }
    val wanted = items.map { it.id }.toSet()
    for ((id, program) in existing) {
      if (id !in wanted) resolver.delete(TvContractCompat.buildWatchNextProgramUri(program.id), null, null)
    }
    for (item in items) {
      val old = existing[item.id]
      // Removed from the home screen by the person: it stays off while the title is still in Orbit's list.
      if (old != null && !old.isBrowsable) continue
      val values = program(context, item).toContentValues()
      if (old == null) resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, values)
      else resolver.update(TvContractCompat.buildWatchNextProgramUri(old.id), values, null, null)
    }
  }

  private fun program(context: Context, item: WatchNextItem): WatchNextProgram {
    val builder = WatchNextProgram.Builder()
    builder
      .setWatchNextType(if (item.next) TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT else TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
      .setLastEngagementTimeUtcMillis(item.lastWatched)
      .setInternalProviderId(item.id)
      .setTitle(item.title)
      .setIntent(Intent(context, MainActivity::class.java).setAction(ACTION).putExtra(EXTRA_TITLE, item.id))
    if (item.kind == "series") {
      builder.setType(TvContractCompat.WatchNextPrograms.TYPE_TV_EPISODE)
      item.season?.let { builder.setSeasonNumber(it) }
      item.episode?.let { builder.setEpisodeNumber(it) }
    } else {
      builder.setType(TvContractCompat.WatchNextPrograms.TYPE_MOVIE)
    }
    item.art?.let {
      builder.setPosterArtUri(Uri.parse(it))
        .setPosterArtAspectRatio(if (item.wide) TvContractCompat.PreviewPrograms.ASPECT_RATIO_16_9 else TvContractCompat.PreviewPrograms.ASPECT_RATIO_2_3)
    }
    if (item.positionMs > 0 && item.durationMs > item.positionMs) {
      builder.setLastPlaybackPositionMillis(item.positionMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        .setDurationMillis(item.durationMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
    }
    return builder.build()
  }
}
