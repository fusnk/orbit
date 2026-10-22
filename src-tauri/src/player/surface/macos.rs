//! macOS: mpv gets the window's content view (an `NSView*`) as its `wid` and adds
//! a view of its own to it (`MpvEventsView`, holding the `MpvVideoView` it draws
//! in), on top of the WebView. Once mpv reports its video output is set up, that
//! view is moved beneath the WebView, which is transparent while the player is
//! open, and the WebView gets the keyboard back (mpv's view takes it on start).
//!
//! AppKit is only touched on the main thread, through the Objective-C runtime
//! itself: libobjc is part of every Mac, and Tauri already links AppKit.

use std::ffi::{CStr, c_char, c_void};

use tauri::WebviewWindow;

type Id = *mut c_void;
type Sel = *mut c_void;

#[link(name = "objc", kind = "dylib")]
unsafe extern "C" {
    fn sel_registerName(name: *const c_char) -> Sel;
    fn object_getClassName(object: Id) -> *const c_char;
    fn objc_msgSend();
}

/// `NSWindowBelow`, for `addSubview:positioned:relativeTo:`.
const BELOW: isize = -1;

/// `objc_msgSend` as a function of the given type.
macro_rules! msg {
    ($ty:ty) => {{
        // SAFETY: objc_msgSend is called with the exact argument and return types of the method.
        unsafe { std::mem::transmute::<unsafe extern "C" fn(), $ty>(objc_msgSend) }
    }};
}

fn sel(name: &CStr) -> Sel {
    // SAFETY: a NUL-terminated selector name; registering one is thread-safe.
    unsafe { sel_registerName(name.as_ptr()) }
}

/// `[receiver name]` for a method returning an object.
unsafe fn object(receiver: Id, name: &CStr) -> Id {
    // SAFETY: forwarded to the caller: `name` takes no arguments and returns an object.
    unsafe { msg!(unsafe extern "C" fn(Id, Sel) -> Id)(receiver, sel(name)) }
}

fn class_name(object: Id) -> String {
    // SAFETY: `object` is a live object; the runtime returns its class's NUL-terminated name.
    unsafe { CStr::from_ptr(object_getClassName(object)) }.to_string_lossy().into_owned()
}

/// The window's content view video is embedded in.
pub struct Surface {
    window: WebviewWindow,
    /// The content view's address: only dereferenced on the main thread.
    view: usize,
}

impl Surface {
    /// Called during setup, on the main thread, after the WebView is in the window.
    pub fn new_macos(window: &WebviewWindow) -> Result<Self, String> {
        let ns_window = window.ns_window().map_err(|_| "err.player.output")?;
        // SAFETY: on the main thread; `contentView` is a plain getter on a live NSWindow.
        let view = unsafe { object(ns_window, c"contentView") };
        if view.is_null() {
            return Err("err.player.output".into());
        }
        Ok(Self { window: window.clone(), view: view as usize })
    }

    /// The value for mpv's `wid` option: the content view's address.
    pub fn wid(&self) -> String {
        self.view.to_string()
    }

    /// Puts mpv's view beneath the WebView, on the main thread. Returns whether that was queued.
    pub fn push_video_behind(&self) -> bool {
        let view = self.view;
        // SAFETY: the content view lives as long as the window; this runs on the main thread.
        self.window.run_on_main_thread(move || unsafe { put_video_behind(view as Id) }).is_ok()
    }
}

/// See `push_video_behind`. Main thread only.
unsafe fn put_video_behind(parent: Id) {
    // SAFETY (all calls): AppKit methods with these exact types, on live views, on the main thread.
    unsafe {
        // A copy: the subviews can be moved while it's read.
        let subviews = object(parent, c"subviews");
        if subviews.is_null() {
            return;
        }
        let count = msg!(unsafe extern "C" fn(Id, Sel) -> usize)(subviews, sel(c"count"));
        let views: Vec<Id> = (0..count).map(|i| msg!(unsafe extern "C" fn(Id, Sel, usize) -> Id)(subviews, sel(c"objectAtIndex:"), i)).collect();
        let classes: Vec<String> = views.iter().map(|&v| class_name(v)).collect();
        let (video, page) = super::arrange(&classes.iter().map(String::as_str).collect::<Vec<_>>());
        for i in video {
            let view = views[i];
            // Kept alive while AppKit takes it out and puts it back.
            object(view, c"retain");
            msg!(unsafe extern "C" fn(Id, Sel, Id, isize, Id))(parent, sel(c"addSubview:positioned:relativeTo:"), view, BELOW, std::ptr::null_mut());
            msg!(unsafe extern "C" fn(Id, Sel))(view, sel(c"release"));
        }
        let window = object(parent, c"window");
        if let Some(page) = page
            && !window.is_null()
        {
            msg!(unsafe extern "C" fn(Id, Sel, Id) -> i8)(window, sel(c"makeFirstResponder:"), views[page]);
        }
    }
}
