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

#[cfg(all(not(windows), not(target_os = "linux")))]
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

#[cfg(any(target_os = "linux", test))]
fn framebuffer_size(width: i32, height: i32, scale: i32) -> Option<(i32, i32)> {
    if width <= 0 || height <= 0 || scale <= 0 {
        return None;
    }
    Some((width.checked_mul(scale)?, height.checked_mul(scale)?))
}

#[cfg(test)]
mod tests {
    use super::framebuffer_size;

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
}
