//! Where video is drawn: mpv's own window, kept beneath the WebView.
//!
//! On Windows mpv gets the main window as its `wid` and creates a window of
//! class `mpv` as a direct child of it, next to the WebView. (Nesting it one
//! level deeper, inside a container of ours, left the video invisible under
//! the transparent window.) A new child starts on top, so once mpv reports its
//! video output is set up, its window is pushed to the bottom; the WebView,
//! transparent while the player is open, then composites over it.
//!
//! On Linux, GTK composites a GLArea underneath WebKitGTK in the same window;
//! see surface/linux.rs. The Windows implementation below stays independent.
//!
//! On macOS mpv adds a view of its own to the window's content view, which is
//! then moved beneath the WebView; see surface/macos.rs.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, HWND_BOTTOM, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos};

    /// The main window video is embedded in.
    pub struct Surface(HWND);

    // SAFETY: the HWND is only read as a number for mpv or passed to Win32
    // calls that are safe from any thread.
    unsafe impl Send for Surface {}
    unsafe impl Sync for Surface {}

    impl Surface {
        pub fn new(parent: *mut c_void) -> Result<Self, String> {
            if parent.is_null() {
                return Err("err.player.output".into());
            }
            Ok(Self(parent))
        }

        /// The value for mpv's `wid` option.
        pub fn wid(&self) -> String {
            (self.0 as isize).to_string()
        }

        /// Puts mpv's video window beneath the WebView. Returns whether it was found.
        pub fn push_video_behind(&self) -> bool {
            let class: Vec<u16> = "mpv\0".encode_utf16().collect();
            // SAFETY: valid parent and NUL-terminated class name; searches direct children only.
            let video = unsafe { FindWindowExW(self.0, std::ptr::null_mut(), class.as_ptr(), std::ptr::null()) };
            if video.is_null() {
                return false;
            }
            // SAFETY: valid window. Async, because mpv's window belongs to mpv's thread.
            unsafe { SetWindowPos(video, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS) };
            true
        }
    }
}

#[cfg(target_os = "linux")]
#[path = "surface/linux.rs"]
mod imp;

#[cfg(target_os = "macos")]
#[path = "surface/macos.rs"]
mod imp;

#[cfg(all(not(windows), not(target_os = "linux"), not(target_os = "macos")))]
mod imp {
    use std::ffi::c_void;

    /// Embedding isn't implemented on this platform yet.
    pub struct Surface;

    impl Surface {
        pub fn new(_parent: *mut c_void) -> Result<Self, String> {
            Err("err.player.unavailable".into())
        }
        pub fn wid(&self) -> String {
            String::new()
        }
        pub fn push_video_behind(&self) -> bool {
            false
        }
    }
}

pub use imp::Surface;

/// Given the classes of the content view's subviews (back to front), which are mpv's,
/// to move beneath the rest (front-most first, so moving each to the back keeps their
/// order), and which is the page (the WebView), to get the keyboard back. macOS only.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn arrange(classes: &[&str]) -> (Vec<usize>, Option<usize>) {
    let is_mpv = |class: &&str| class.starts_with("Mpv");
    let video = (0..classes.len()).rev().filter(|&i| is_mpv(&classes[i])).collect();
    let page = classes.iter().position(|c| !is_mpv(c));
    (video, page)
}

#[cfg(any(target_os = "linux", test))]
fn framebuffer_size(width: i32, height: i32, scale: i32) -> Option<(i32, i32)> {
    if width <= 0 || height <= 0 || scale <= 0 {
        return None;
    }
    Some((width.checked_mul(scale)?, height.checked_mul(scale)?))
}

#[cfg(test)]
mod tests {
    use super::{arrange, framebuffer_size};

    #[test]
    fn framebuffer_uses_physical_pixels() {
        assert_eq!(framebuffer_size(1280, 720, 2), Some((2560, 1440)));
    }

    #[test]
    fn hidden_or_overflowing_allocations_do_not_render() {
        for (width, height, scale) in [(0, 720, 1), (1280, 0, 1), (-1, 720, 1), (1280, 720, 0), (i32::MAX, 720, 2)] {
            assert_eq!(framebuffer_size(width, height, scale), None);
        }
    }

    #[test]
    fn mpv_s_view_goes_beneath_the_page_and_the_page_gets_the_keyboard() {
        assert_eq!(arrange(&["WryWebView", "MpvEventsView"]), (vec![1], Some(0)));
    }

    #[test]
    fn video_already_beneath_the_page_is_moved_again_harmlessly() {
        assert_eq!(arrange(&["MpvEventsView", "WryWebView"]), (vec![0], Some(1)));
    }

    #[test]
    fn several_mpv_views_keep_their_order_beneath_the_page() {
        // Moved front-most first: each goes to the very back, so the back-most ends up back-most.
        assert_eq!(arrange(&["WryWebView", "MpvEventsView", "MpvVideoView"]), (vec![2, 1], Some(0)));
    }

    #[test]
    fn nothing_moves_before_mpv_has_added_its_view() {
        assert_eq!(arrange(&["WryWebView"]), (vec![], Some(0)));
        assert_eq!(arrange(&[]), (vec![], None));
    }
}
