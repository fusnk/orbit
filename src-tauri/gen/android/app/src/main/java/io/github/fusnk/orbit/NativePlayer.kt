package io.github.fusnk.orbit

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import java.util.concurrent.ConcurrentLinkedQueue
import app.tauri.plugin.Plugin

/**
 * Video on Android (src-tauri/src/player/android.rs): Rust resolves the
 * address as on a PC (provider logins, media-server tokens and debrid links
 * stay in Rust), then opens it here, in a Media3 player that owns the screen.
 * The address and headers pass through this in-process object, never an
 * Intent, so no other app can see them. Rust reads the player's state back
 * twice a second and reports it to the page as mpv's would be.
 */
object PlayerSession {
  /** What Rust asked to play; read once by PlayerActivity. */
  /** `local`: a file Orbit downloaded (Rust found it), the only file the player may open. */
  class Request(val url: String, val headers: Map<String, String>, val startMs: Long, val local: Boolean, val subtitles: List<SubtitleArgs>, val matchRate: Boolean)

  @Volatile var request: Request? = null
  /** Bumped by every open, so a closing activity can't report over the next file. */
  @Volatile var generation = 0

  // The player's state, written on the main thread and read by Rust's poll.
  @Volatile var loaded = false
  @Volatile var ready = false
  @Volatile var positionMs = 0L
  @Volatile var durationMs = C.TIME_UNSET
  @Volatile var bufferedMs = 0L
  @Volatile var paused = false
  @Volatile var buffering = true
  @Volatile var ended = false
  @Volatile var height = 0
  @Volatile var speed = 1f
  @Volatile var error: String? = null
  /** The person left the player (Back), or Rust stopped it. */
  @Volatile var closed = false

  /** Remote keys that are Orbit's, not Media3's (channel surfing, next/previous episode), for the page. */
  val keys = ConcurrentLinkedQueue<String>()

  /** Settings → Audio & Subtitles: the languages to pick tracks in (ISO codes, in order), as mpv's alang/slang. */
  @Volatile var audioLanguages: List<String> = listOf()
  @Volatile var subtitleLanguages: List<String> = listOf()

  /** Settings → Subtitles' look, as the page sends it to mpv (see player/android.rs); null until it does. */
  @Volatile var subtitleStyle: JSObject? = null

  /** What plays and its episode line, as the page tells the phone remote: Android's Now Playing shows them. */
  @Volatile var title: String? = null
  @Volatile var detail: String? = null

  /** A player screen was started and hasn't been created yet: it will play the newest request itself. */
  @Volatile var launching = false

  /** The activity on screen, for `stop`. */
  @Volatile var activity: Activity? = null

  fun reset(request: Request) {
    generation += 1
    this.request = request
    loaded = false; ready = false; positionMs = 0; durationMs = C.TIME_UNSET; bufferedMs = 0
    paused = false; buffering = true; ended = false; height = 0; speed = 1f; error = null; closed = false
    keys.clear()
  }

  fun snapshot(): JSObject = JSObject().apply {
    put("generation", generation)
    put("loaded", loaded)
    put("ready", ready)
    put("position", positionMs / 1000.0)
    if (durationMs != C.TIME_UNSET && durationMs > 0) put("duration", durationMs / 1000.0)
    put("buffered", bufferedMs / 1000.0)
    put("paused", paused)
    put("buffering", buffering)
    put("ended", ended)
    if (height > 0) put("height", height)
    put("speed", speed.toDouble())
    error?.let { put("error", it) }
    put("closed", closed)
    put("keys", JSArray().apply { while (true) put(keys.poll() ?: break) })
  }
}

@InvokeArg
class SubtitleArgs {
  /** The file's contents, base64: Rust fetched and cleaned it up, so its address never comes here. */
  lateinit var data: String
  lateinit var mime: String
  lateinit var label: String
  var lang: String? = null
}

@InvokeArg
class OpenArgs {
  lateinit var url: String
  /** "Name: value" lines, as mpv takes them. */
  var headers: List<String> = listOf()
  var start: Double? = null
  var local: Boolean = false
  /** Subtitles that go with the file from the start (a download's), as contents. */
  var subtitles: List<SubtitleArgs> = listOf()
  /** Settings → Playback → Match the TV's refresh rate. */
  var matchRate: Boolean = false
}

/** Rust's handle on the player. Like the secret store, the WebView can't call it (see player/android.rs). */
@TauriPlugin
class NativePlayerPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun open(invoke: Invoke) {
    val args = invoke.parseArgs(OpenArgs::class.java)
    val headers = args.headers.mapNotNull { line ->
      val (name, value) = line.split(":", limit = 2).takeIf { it.size == 2 } ?: return@mapNotNull null
      name.trim() to value.trim()
    }.toMap()
    val startMs = ((args.start ?: 0.0).coerceAtLeast(0.0) * 1000).toLong()
    activity.runOnUiThread {
      PlayerSession.reset(PlayerSession.Request(args.url, headers, startMs, args.local, args.subtitles, args.matchRate))
      // A player already open takes the new file (the next episode, another source).
      val current = PlayerSession.activity as? PlayerActivity
      if (current != null && !current.isFinishing) current.load()
      else if (!PlayerSession.launching) {
        PlayerSession.launching = true
        activity.startActivity(Intent(activity, PlayerActivity::class.java))
      }
      invoke.resolve()
    }
  }

  @Command
  fun addSubtitle(invoke: Invoke) {
    val args = invoke.parseArgs(SubtitleArgs::class.java)
    activity.runOnUiThread {
      val player = PlayerSession.activity as? PlayerActivity
      if (player == null || player.isFinishing) return@runOnUiThread invoke.reject("no player")
      player.addSubtitle(args)
      invoke.resolve()
    }
  }

  @Command
  fun setPaused(invoke: Invoke) {
    val paused = invoke.getArgs().getBoolean("paused", false)
    onPlayer(invoke) { it.playWhenReady = !paused }
  }

  @Command
  fun seek(invoke: Invoke) {
    val args = invoke.getArgs()
    val ms = (args.getDouble("seconds") * 1000).toLong()
    onPlayer(invoke) { it.seekTo(((if (args.getBoolean("relative", false)) it.currentPosition + ms else ms)).coerceAtLeast(0)) }
  }

  /** Runs `action` on the player on screen, on its thread. */
  private fun onPlayer(invoke: Invoke, action: (ExoPlayer) -> Unit) {
    activity.runOnUiThread {
      val player = (PlayerSession.activity as? PlayerActivity)?.exoPlayer
      if (player == null) return@runOnUiThread invoke.reject("no player")
      action(player)
      invoke.resolve()
    }
  }

  /** A trailer, in the YouTube app (or a browser); Rust checked the id is a YouTube video id. */
  @Command
  fun openYoutube(invoke: Invoke) {
    val id = invoke.getArgs().getString("id", null) ?: return invoke.reject("no id")
    if (!Regex("[A-Za-z0-9_-]{11}").matches(id)) return invoke.reject("no id")
    activity.runOnUiThread {
      val app = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("vnd.youtube:$id"))
      val web = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/watch?v=$id"))
      try {
        activity.startActivity(app)
        invoke.resolve()
      } catch (e: android.content.ActivityNotFoundException) {
        try {
          activity.startActivity(web)
          invoke.resolve()
        } catch (e: android.content.ActivityNotFoundException) {
          invoke.reject("no app")
        }
      }
    }
  }

  @Command
  fun skipButton(invoke: Invoke) {
    val label = invoke.getArgs().getString("label", null)
    activity.runOnUiThread {
      (PlayerSession.activity as? PlayerActivity)?.showSkip(label)
      invoke.resolve()
    }
  }

  @Command
  fun nextUp(invoke: Invoke) {
    val label = invoke.getArgs().getString("label", null)
    activity.runOnUiThread {
      (PlayerSession.activity as? PlayerActivity)?.showNextUp(label)
      invoke.resolve()
    }
  }

  @Command
  fun nowPlaying(invoke: Invoke) {
    val args = invoke.getArgs()
    PlayerSession.title = args.getString("title", null)
    PlayerSession.detail = args.getString("detail", null)
    activity.runOnUiThread {
      (PlayerSession.activity as? PlayerActivity)?.applyNowPlaying()
      invoke.resolve()
    }
  }

  @Command
  fun setLanguages(invoke: Invoke) {
    val args = invoke.getArgs()
    val list = { name: String -> args.getString(name, "")!!.split(',').map { it.trim() }.filter { it.isNotEmpty() } }
    PlayerSession.audioLanguages = list("audio")
    PlayerSession.subtitleLanguages = list("subtitle")
    activity.runOnUiThread {
      (PlayerSession.activity as? PlayerActivity)?.applyLanguages()
      invoke.resolve()
    }
  }

  @Command
  fun setSubtitleStyle(invoke: Invoke) {
    PlayerSession.subtitleStyle = invoke.getArgs()
    activity.runOnUiThread {
      (PlayerSession.activity as? PlayerActivity)?.applySubtitleStyle()
      invoke.resolve()
    }
  }

  /**
   * What this device can decode and show, for ranking sources (ranking-fallback.ts DeviceSupport).
   * A video codec counts only with a hardware decoder where Android says which those are (10+):
   * software 4K HEVC or AV1 stutters on a TV box. H.264 plays everywhere. Dolby Vision needs both a
   * decoder and a screen for it.
   */
  @Command
  @Suppress("DEPRECATION")
  fun capabilities(invoke: Invoke) {
    val decoders = android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
    val hardware = { info: android.media.MediaCodecInfo -> android.os.Build.VERSION.SDK_INT < 29 || info.isHardwareAccelerated }
    val types = decoders.filter(hardware).flatMap { it.supportedTypes.toList() }.map { it.lowercase() }.toSet()
    val codecs = JSArray().apply {
      put("H.264")
      if ("video/hevc" in types) put("HEVC")
      if ("video/av01" in types) put("AV1")
    }
    val display = activity.windowManager.defaultDisplay
    val shown = display.hdrCapabilities?.supportedHdrTypes ?: intArrayOf()
    val hdr = JSArray().apply {
      if (android.view.Display.HdrCapabilities.HDR_TYPE_HDR10 in shown) put("HDR10")
      if (android.view.Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS in shown) put("HDR10+")
      if (android.view.Display.HdrCapabilities.HDR_TYPE_HLG in shown) put("HLG")
      if (android.view.Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in shown && "video/dolby-vision" in types) put("Dolby Vision")
    }
    val height = display.supportedModes.maxOfOrNull { minOf(it.physicalWidth, it.physicalHeight) } ?: 1080
    val maxResolution = when {
      height >= 2160 -> "2160p"
      height >= 1080 -> "1080p"
      height >= 720 -> "720p"
      else -> "480p"
    }
    invoke.resolve(JSObject().put("codecs", codecs).put("hdr", hdr).put("maxResolution", maxResolution))
  }

  /** Voice search: Android's own speech prompt (it handles the microphone, so Orbit needs no permission). */
  @Command
  fun listen(invoke: Invoke) {
    val intent = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    invoke.getArgs().getString("prompt", null)?.let { intent.putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, it) }
    if (intent.resolveActivity(activity.packageManager) == null) return invoke.reject("no voice")
    startActivityForResult(invoke, intent, "heard")
  }

  @ActivityCallback
  fun heard(invoke: Invoke, result: ActivityResult) {
    val text = if (result.resultCode == Activity.RESULT_OK) result.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() else null
    invoke.resolve(JSObject().put("text", text))
  }

  /** Orbit's Continue Watching on the TV's home screen (WatchNext.kt); an empty list clears it. */
  @Command
  fun watchNext(invoke: Invoke) {
    val args = invoke.parseArgs(WatchNextArgs::class.java)
    WatchNext.publish(activity, args.items) { done -> if (done) invoke.resolve() else invoke.reject("unavailable") }
  }

  @Command
  fun status(invoke: Invoke) {
    invoke.resolve(PlayerSession.snapshot())
  }

  @Command
  fun stop(invoke: Invoke) {
    activity.runOnUiThread {
      PlayerSession.request = null
      PlayerSession.launching = false
      PlayerSession.activity?.finish()
      invoke.resolve()
    }
  }
}

/**
 * The player screen: Media3 with its own remote-friendly controls. Back
 * leaves it, which Rust passes on to the page so it closes its player too and
 * saves where the person got to.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {
  private companion object {
    /** Dropped connections retried before the page hears of it (1, then 2 s apart): few, so a source that's gone gives way to the next one quickly. */
    const val MAX_RETRIES = 2
  }

  private var player: ExoPlayer? = null
  /**
   * The player as the rest of Android sees it: "Hey Google, pause", a TV remote's buttons over
   * HDMI-CEC, a Bluetooth remote's, and the system's Now Playing. Lives as long as the screen.
   */
  private var session: MediaSession? = null
  val exoPlayer: ExoPlayer? get() = player
  private lateinit var view: PlayerView
  private lateinit var nextUp: android.widget.Button
  private lateinit var skip: android.widget.Button
  private val main = Handler(Looper.getMainLooper())
  private var generation = -1
  private val subtitles = mutableListOf<MediaItem.SubtitleConfiguration>()

  private val tick = object : Runnable {
    override fun run() {
      report()
      main.postDelayed(this, 250)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    view = PlayerView(this).apply {
      keepScreenOn = true
      setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
      // Remote-friendly: the controls take focus, so the D-pad seeks and Enter plays/pauses.
      controllerAutoShow = true
      requestFocus()
    }
    nextUp = overlayButton { PlayerSession.keys.add("MediaTrackNext") }
    skip = overlayButton { PlayerSession.keys.add("Skip") }
    val corner = { gravity: Int ->
      android.widget.FrameLayout.LayoutParams(
        android.view.ViewGroup.LayoutParams.WRAP_CONTENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
        android.view.Gravity.BOTTOM or gravity,
      ).apply { val m = dp(48); setMargins(m, m, m, m) }
    }
    setContentView(android.widget.FrameLayout(this).apply {
      addView(view)
      addView(nextUp, corner(android.view.Gravity.END))
      addView(skip, corner(android.view.Gravity.START))
    })
    // Above Media3's seek bar and buttons while those show, so they never cover them.
    view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
      val lift = if (visibility == android.view.View.VISIBLE) -dp(120).toFloat() else 0f
      nextUp.animate().translationY(lift).setDuration(150).start()
      skip.animate().translationY(lift).setDuration(150).start()
    })
    PlayerSession.launching = false
    // One player screen at a time: one already up has the newest request.
    val other = PlayerSession.activity
    if (other != null && other !== this && !other.isFinishing) return finish()
    PlayerSession.activity = this
    load()
  }

  /** Plays what Rust asked for last. */
  fun load() {
    val request = PlayerSession.request ?: return finish()
    generation = PlayerSession.generation
    subtitles.clear()
    showNextUp(null)
    showSkip(null)
    val previous = player
    // A sign-in header (Jellyfin, Plex) mustn't follow a redirect from https down to plain http.
    val signedIn = request.headers.keys.any { !it.equals("User-Agent", ignoreCase = true) && !it.equals("Referer", ignoreCase = true) }
    val http = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(!signedIn)
      .setDefaultRequestProperties(request.headers)
    request.headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }?.let { http.setUserAgent(it.value) }
    // As mpv's protocol whitelist on a PC: the web, the subtitles Rust hands over (data:), and the one
    // file Orbit downloaded. An addon's playlist can't point the player at this app's files or another app's.
    val requested = android.net.Uri.parse(request.url)
    val sources = guarded(DefaultDataSource.Factory(this, http)) { uri ->
      when (uri.scheme?.lowercase()) {
        "http", "https", "data" -> true
        null, "file" -> request.local && uri.path == requested.path
        else -> false
      }
    }
    retries = 0
    rateMatched = false
    // A new file: the TV's own mode until this one's frame rate is known.
    window.attributes = window.attributes.also { it.preferredDisplayModeId = 0 }
    val exo = ExoPlayer.Builder(this, renderers())
      .setMediaSourceFactory(DefaultMediaSourceFactory(sources))
      .setLoadControl(loadControl())
      // A film: other apps' sound pauses, and the audio's route (HDMI to a receiver, say) decides passthrough.
      .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
      .build()
    exo.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_READY) {
          PlayerSession.ready = true
          if (request.matchRate && !rateMatched) {
            rateMatched = true
            matchFrameRate(exo)
          }
          // Playing again: a later dropout gets its own retries.
          retries = 0
        }
        if (state == Player.STATE_ENDED) PlayerSession.ended = true
        report()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) = report()

      // The error's code name only: its message can include the address.
      override fun onPlayerError(error: PlaybackException) {
        if (generation != PlayerSession.generation) return
        if (recover(exo, error)) return
        PlayerSession.error = error.errorCodeName
      }
    })
    view.player = exo
    player = exo
    val controlled = remoteControlled(exo)
    // An id of its own: the screen before may still be closing with its session.
    session?.let { it.player = controlled } ?: run { session = MediaSession.Builder(this, controlled).setId("orbit-player-${PlayerSession.generation}").build() }
    previous?.release()
    applyLanguages()
    applySubtitleStyle()
    request.subtitles.forEach { subtitles += subtitleConfig(it) }
    exo.setMediaItem(MediaItem.Builder().setUri(request.url).setSubtitleConfigurations(subtitles.toList()).setMediaMetadata(nowPlaying()).build(), request.startMs)
    exo.prepare()
    exo.playWhenReady = true
    PlayerSession.loaded = true
    main.removeCallbacks(tick)
    main.post(tick)
  }

  /**
   * The page's Next up card, as a button over the video during the credits: the page's label, and
   * Enter plays next through the page, as the remote's next key does. Focused, so one press does it.
   */
  fun showNextUp(label: String?) = show(nextUp, label?.let { "▶  $it" })

  /** The page's Skip button (Skip intro, recap, credits…); Enter skips through the page, which learns intros as on a PC. */
  fun showSkip(label: String?) = show(skip, label?.let { "⏭  $it" })

  private fun show(button: android.widget.Button, text: String?) {
    if (text == null) {
      if (button.hasFocus()) view.requestFocus()
      button.visibility = android.view.View.GONE
      return
    }
    button.text = text
    button.visibility = android.view.View.VISIBLE
    button.requestFocus()
  }

  private fun overlayButton(press: () -> Unit): android.widget.Button = android.widget.Button(this).apply {
    visibility = android.view.View.GONE
    isAllCaps = false
    textSize = 18f
    setTextColor(android.graphics.Color.WHITE)
    setPadding(dp(24), dp(14), dp(24), dp(14))
    val shape = { fill: Int, stroke: Int ->
      android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(28).toFloat(); setColor(fill); setStroke(dp(2), stroke) }
    }
    // Orbit's glass button, with its accent ring when focused.
    background = android.graphics.drawable.StateListDrawable().apply {
      addState(intArrayOf(android.R.attr.state_focused), shape(0xE6141210.toInt(), 0xFFE5484D.toInt()))
      addState(intArrayOf(), shape(0xB3141210.toInt(), 0x40FFFFFF))
    }
    setOnClickListener { press() }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  // Channel up/down and next/previous go to the page before Media3's controls see them: what plays
  // next (the next channel, the next episode) is Orbit's to decide, as with these keys on a PC.
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val key = when (event.keyCode) {
      KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_MEDIA_NEXT -> "MediaTrackNext"
      KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "MediaTrackPrevious"
      else -> return super.dispatchKeyEvent(event)
    }
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) PlayerSession.keys.add(key)
    return true
  }

  /** Settings' languages for the tracks Media3 picks by itself, as mpv's alang/slang on a PC. */
  fun applyLanguages() {
    val exo = player ?: return
    exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
      .setPreferredAudioLanguages(*PlayerSession.audioLanguages.toTypedArray())
      .setPreferredTextLanguages(*PlayerSession.subtitleLanguages.toTypedArray())
      .build()
  }

  /**
   * Settings' subtitle look on Media3's captions: mpv's size scale (55 at 720p) as a share of the
   * screen's height, the colour, a drop shadow, box or outline, raised by the position setting, bold.
   */
  fun applySubtitleStyle() {
    val style = PlayerSession.subtitleStyle ?: return
    val subtitles = view.subtitleView ?: return
    val color = runCatching { android.graphics.Color.parseColor(style.getString("color", "#ffffff")) }.getOrDefault(android.graphics.Color.WHITE)
    val outline = style.getInteger("outline", 0)
    val (edge, background) = when (style.getString("background", "shadow")) {
      "box" -> CaptionStyleCompat.EDGE_TYPE_NONE to 0xB3000000.toInt()
      "shadow" -> CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW to android.graphics.Color.TRANSPARENT
      else -> (if (outline > 0) CaptionStyleCompat.EDGE_TYPE_OUTLINE else CaptionStyleCompat.EDGE_TYPE_NONE) to android.graphics.Color.TRANSPARENT
    }
    val typeface = if (style.getBoolean("bold", false)) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
    subtitles.setStyle(CaptionStyleCompat(color, background, android.graphics.Color.TRANSPARENT, edge, android.graphics.Color.BLACK, typeface))
    // Media3's text size counts from the line's height, mpv's from the font's: 0.75 brings them in line.
    subtitles.setFractionalTextSize(style.getInteger("size", 55) / 720f * 0.75f)
    // Embedded styles (an ASS file's own sizes and colours) give way to the setting, as mpv's override does for plain text.
    subtitles.setApplyEmbeddedFontSizes(false)
    subtitles.setBottomPaddingFraction(0.08f + (100 - style.getInteger("position", 100)).coerceIn(0, 50) / 100f)
  }

  /**
   * Hardware decoders first; when one can't start the video, the next one is tried. Audio Android
   * can't decode or pass through (DTS, TrueHD on many boxes) goes to the FFmpeg decoder, only then.
   */
  private fun renderers() = DefaultRenderersFactory(this)
    .setEnableDecoderFallback(true)
    .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

  /**
   * Next and previous from outside (Assistant, a CEC or Bluetooth remote) go to the page, as the
   * remote's own keys do (`dispatchKeyEvent`): the next episode or channel is Orbit's to choose.
   */
  private fun remoteControlled(exo: ExoPlayer): Player = object : ForwardingPlayer(exo) {
    private val jumps = Player.Commands.Builder().addAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_PREVIOUS).build()
    override fun getAvailableCommands(): Player.Commands = super.getAvailableCommands().buildUpon().addAll(jumps).build()
    override fun isCommandAvailable(command: Int) = jumps.contains(command) || super.isCommandAvailable(command)
    override fun seekToNext() { PlayerSession.keys.add("MediaTrackNext") }
    override fun seekToPrevious() { PlayerSession.keys.add("MediaTrackPrevious") }
  }

  private fun nowPlaying(): MediaMetadata = MediaMetadata.Builder()
    .setTitle(PlayerSession.title)
    .setSubtitle(PlayerSession.detail)
    .setDisplayTitle(PlayerSession.title)
    .build()

  /** The page's title for what plays, on the item Media3 reports to Now Playing (a metadata-only change; playback carries on). */
  fun applyNowPlaying() {
    val exo = player ?: return
    val item = exo.currentMediaItem ?: return
    if (item.mediaMetadata == nowPlaying()) return
    exo.replaceMediaItem(exo.currentMediaItemIndex, item.buildUpon().setMediaMetadata(nowPlaying()).build())
  }

  /**
   * On a box with little memory (1–2 GB sticks) a smaller buffer, so Android doesn't end Orbit
   * mid-film; elsewhere Media3's defaults.
   */
  private fun loadControl(): DefaultLoadControl {
    val memory = android.app.ActivityManager.MemoryInfo()
    val manager = getSystemService(ACTIVITY_SERVICE) as android.app.ActivityManager
    manager.getMemoryInfo(memory)
    if (!manager.isLowRamDevice && memory.totalMem > 2_500_000_000L) return DefaultLoadControl()
    return DefaultLoadControl.Builder()
      .setBufferDurationsMs(15_000, 30_000, 2_500, 5_000)
      .setTargetBufferBytes(32 * 1024 * 1024)
      .setPrioritizeTimeOverSizeThresholds(false)
      .build()
  }

  private var retries = 0
  private var rateMatched = false

  /**
   * Settings → Playback → Match the TV's refresh rate (idea from Just Player and NuvioTV): the screen
   * mode at the current resolution whose rate fits the video's frame rate, the same rate first, then
   * the lowest whole multiple (a 23.976 fps film on 23.976 Hz, else 47.95). Nothing changes when the
   * file doesn't say its frame rate (often MKV). Leaving the player screen gives the TV its own mode back.
   */
  @Suppress("DEPRECATION")
  private fun matchFrameRate(exo: ExoPlayer) {
    val fps = exo.videoFormat?.frameRate?.takeIf { it > 0f } ?: return
    val display = windowManager.defaultDisplay
    val current = display.mode
    val best = display.supportedModes
      .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
      .mapNotNull { mode ->
        val multiple = mode.refreshRate / fps
        val whole = kotlin.math.round(multiple)
        val error = kotlin.math.abs(multiple - whole) / whole
        if (whole >= 1f && error < 0.01f) Triple(mode, whole, error) else null
      }
      .minWithOrNull(compareBy({ it.third > 0.0005f }, { it.second }, { it.third }))
      ?.first ?: return
    if (best.modeId != current.modeId) window.attributes = window.attributes.also { it.preferredDisplayModeId = best.modeId }
  }

  /**
   * Tries to get past `error` without bothering the page: a live stream that fell behind its window
   * rejoins it, and a dropped connection is retried a few times, waiting longer each time. Anything
   * else (or too many) goes to the page, which may try another source.
   */
  private fun recover(exo: ExoPlayer, error: PlaybackException): Boolean {
    if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
      exo.seekToDefaultPosition()
      exo.prepare()
      return true
    }
    val transient = error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
      error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
    if (!transient || retries >= MAX_RETRIES) return false
    retries += 1
    val at = exo.currentPosition
    val mine = generation
    main.postDelayed({
      if (player === exo && mine == PlayerSession.generation) {
        exo.seekTo(at)
        exo.prepare()
      }
    }, 1_000L shl (retries - 1))
    return true
  }

  /** Adds a subtitle and shows it. Media3 takes new subtitle files with the item, so it reloads in place. */
  fun addSubtitle(args: SubtitleArgs) {
    val exo = player ?: return
    val item = exo.currentMediaItem ?: return
    subtitles += subtitleConfig(args)
    val position = exo.currentPosition
    exo.setMediaItem(item.buildUpon().setSubtitleConfigurations(subtitles.toList()).build(), position)
    exo.prepare()
    // The newest one shows, as on a PC.
    exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
      .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
      .setPreferredTextLanguage(args.lang)
      .build()
  }

  private fun subtitleConfig(args: SubtitleArgs) =
    MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse("data:${args.mime};base64,${args.data}"))
      .setMimeType(args.mime)
      .setLabel(args.label)
      .setLanguage(args.lang)
      .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
      .build()

  /** `factory`'s sources, refusing to open any address `allowed` says no to. */
  private fun guarded(factory: DataSource.Factory, allowed: (android.net.Uri) -> Boolean) = DataSource.Factory {
    val inner = factory.createDataSource()
    object : DataSource by inner {
      override fun open(dataSpec: DataSpec): Long {
        if (!allowed(dataSpec.uri)) throw java.io.IOException("not allowed")
        return inner.open(dataSpec)
      }
    }
  }

  private fun report() {
    val exo = player ?: return
    if (generation != PlayerSession.generation) return
    PlayerSession.positionMs = exo.currentPosition
    PlayerSession.durationMs = exo.duration
    PlayerSession.bufferedMs = exo.bufferedPosition
    PlayerSession.paused = !exo.playWhenReady
    PlayerSession.buffering = exo.playbackState == Player.STATE_BUFFERING
    PlayerSession.height = exo.videoSize.height
    PlayerSession.speed = exo.playbackParameters.speed
  }

  override fun onStop() {
    super.onStop()
    // Leaving the screen (Home, another app) pauses, as a TV app should.
    player?.playWhenReady = false
    report()
  }

  override fun onDestroy() {
    main.removeCallbacks(tick)
    report()
    session?.release()
    session = null
    player?.release()
    player = null
    if (PlayerSession.activity === this) PlayerSession.activity = null
    if (generation == PlayerSession.generation) PlayerSession.closed = true
    super.onDestroy()
  }
}
