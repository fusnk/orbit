# Linux playback groundwork

Orbit includes an experimental GTK/OpenGL video surface for Linux. Linux playback hasn't been tested on a real Linux desktop yet, and there are no Linux installers. The Ubuntu CI job builds and tests it; desktop playback tests on X11 and Wayland come next.

## Approach

Use libmpv's OpenGL render API in a GTK3 `GtkGLArea`, as the main child of a `GtkOverlay`. The existing WebKitGTK view stays above it. When Orbit opens its player, the existing transparent WebView/background behavior exposes video while the same HTML controls receive keyboard, pointer and controller input.

| Option | Benefits | Problems | Decision |
| --- | --- | --- | --- |
| X11 child window with `wid` | Small extension of the Windows embedding model | X11-specific handles; native child stacking and toolkit compositing vary; no equivalent generic Wayland window ID | Not the default |
| libmpv render API + GtkGLArea | One toolkit-owned surface for GTK's X11 and Wayland backends; no external window positioning | GL context lifetime, framebuffer sizing and main-thread ownership need care; hardware interop needs separate validation | Implemented groundwork |
| Separate borderless mpv window | Useful diagnostic fallback outside the app | Wayland restricts global positioning/stacking; focus, minimize, monitors and fullscreen can drift | Not implemented |

The render API is the strongest fit for Orbit's existing single-window UI. GTK owns the native backend and composition instead of Orbit maintaining two independently positioned windows. This is a design choice that still needs runtime validation with WebKitGTK and graphics drivers.

### Reference projects and primary documentation

- [mpv render API](https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h) recommends rendering into an application-managed target, describes callback/thread restrictions, and requires freeing the render context before the client handle.
- [mpv OpenGL parameters](https://github.com/mpv-player/mpv/blob/master/include/mpv/render_gl.h) define the current-context requirement and FBO data. Linux hardware decoding can need native display parameters, which this initial implementation does not supply.
- [GTK3 GLArea](https://docs.gtk.org/gtk3/class.GLArea.html) owns its GL context and exposes realize/render/unrealize signals.
- [Tauri WebviewWindow](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html#method.default_vbox) exposes the GTK container on Linux; GTK handles must stay on the main thread.
- [Jellyfin Desktop MpvVideoItem](https://github.com/jellyfin/jellyfin-desktop/blob/master/src/player/MpvVideoItem.cpp) uses Qt/mpvqt with `vo=libmpv`. Orbit takes the principle of toolkit-integrated rendering, not its Qt implementation.
- [MaxVideoPlayer Linux renderer](https://github.com/MaxMB15/MaxVideoPlayer/blob/main/crates/tauri-plugin-mpv/src/linux.rs) uses a Wayland subsurface with EGL and libmpv rendering, including a native Wayland display. Its Linux renderer explicitly leaves X11 to a separate-window fallback. Orbit uses GTK's GLArea instead of copying that platform stack.

No implementation code was copied from those projects.

## Implemented

- Linux-only code is isolated in `src-tauri/src/player/surface/linux.rs`; the Windows HWND/`wid` surface is retained.
- Linux sets `vo=libmpv` and initializes its engine on GTK's setup thread. It does not set `wid`. This avoids a command worker holding the engine lock while waiting for the GUI thread.
- GTK widgets, GL calls and the render context stay in main-thread state. The thread-safe surface token contains no GTK/GL pointers.
- The mpv update callback only marks an atomic flag. A GTK source coalesces updates and queues rendering. Render uses GTK's active framebuffer and checked physical pixel dimensions, including scale factor.
- Context cleanup happens before mpv destruction. Realize/unrealize handlers manage context recreation. Initialization errors leave the rest of the app usable and fail playback rather than creating an uncontrolled extra window.
- Linux `build.rs` probes system mpv, GL and EGL with pkg-config. Runtime loading uses the probed system directory's `libmpv.so.2`, including the thumbnail player's common loader. No Windows DLL is loaded on Linux.
- `setup:libmpv` checks system pkg-config on Linux without downloading a bundled library. The Windows download/checksum path is unchanged.
- Native Ubuntu CI installs the development libraries and runs locked Cargo check, tests and Clippy.

GTK/GLib are direct Linux dependencies matching versions already used by Tauri. pkg-config is the build-time discovery dependency. These are needed for native rendering and system linking, not a new frontend framework.

## Platform resources

The base `tauri.conf.json` includes shared fonts. Windows DLL/EXE resources are confined to the existing `tauri.windows.conf.json`, which Tauri selects only for Windows; Linux does not inherit that platform file. System libmpv is not bundled into an AppImage. Linux packaging/dependency declarations and distribution testing remain future work.

## Build on Ubuntu 24.04

Install Rust (1.88 minimum; current stable recommended), Node.js compatible with Vite (24 is used in CI), and pnpm 12.6.0. Then install native dependencies:

```sh
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libwebkit2gtk-4.1-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libmpv-dev \
  libgl-dev libegl-dev
pnpm install --frozen-lockfile
pnpm run setup:libmpv
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri dev
```

Use a native Linux terminal and compiler, including inside WSL; do not use Windows Cargo against Linux system packages. `pkg-config --modversion mpv` should work before building. `libmpv-dev` supplies headers/link metadata; the runtime package supplies `libmpv.so.2`.

## Desktop test plan

Use a real Linux machine or VM with 3D acceleration and a supported GL 3.2 context. Run the same build separately in an X11 session (`GDK_BACKEND=x11 pnpm tauri dev`) and native Wayland (`GDK_BACKEND=wayland pnpm tauri dev`). XWayland alone does not validate native Wayland.

In another terminal run `node examples/addon/server.js`, then install Orbit's example addon at `http://127.0.0.1:7000/manifest.json`. It provides public-domain/Creative Commons media without a private provider account. A permitted local video is also suitable.

Check video orientation, audio, subtitles, seek, pause, source changes and EOF. Verify transparent controls remain clickable and readable, resizing and HiDPI scaling, fullscreen, minimize/restore, tray behavior and shutdown while playing. Repeat with software decoding first, then hardware decoding enabled. Try both Mesa and proprietary graphics drivers before claiming broad support.

For WSL2, install an Ubuntu distribution with WSLg from Windows and run the Linux commands inside it. WSLg provides a useful initial Wayland test but does not replace native Linux/VM checks for compositor, GPU and fullscreen behavior.

## Known gaps

- Linux playback hasn't been tested on a real Linux desktop yet. Headless CI proves compilation/tests only, not GL playback.
- Native display handles for zero-copy hardware decoding, HDR/color management and compositor-specific presentation timing are not implemented/tested. Software or copy-back decoding is the initial validation path.
- WebKitGTK transparency, GL driver compatibility, focus, tray/minimize and fullscreen need the desktop test matrix above.
- There is no X11 `wid` or separate-window fallback; if GL initialization fails, playback reports an error.
- macOS playback remains unimplemented.
- Linux trailer resolution still uses the existing Windows-oriented yt-dlp resource path. There is no system yt-dlp resolver or Linux updater; direct media playback is the intended first test.
- Linux installers, system-library relocation/distribution requirements and signing are not release-ready. Existing Windows release workflows are not expanded to publish Linux artifacts.
