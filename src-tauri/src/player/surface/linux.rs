//! GTK owns GL and compositing on both X11 and Wayland; mpv creates no window.
use std::cell::RefCell;
use std::ffi::{c_char, c_int, c_void};
use std::ptr::NonNull;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::player::mpv::{Handle, Mpv};
use gtk::prelude::*;
use tauri::WebviewWindow;

thread_local! {
    // GTK objects and mpv's render context never leave the main thread.
    static NATIVE: RefCell<Option<Native>> = const { RefCell::new(None) };
}

/// Thread-safe token only, with no GTK or GL pointers.
pub struct Surface;
struct Native {
    area: gtk::GLArea,
    mpv: Option<Arc<Mpv>>,
    renderer: Option<Renderer>,
    dirty: Arc<AtomicBool>,
    redraw: Option<glib::SourceId>,
}

impl Surface {
    /// Called from Tauri setup on its GTK thread.
    pub fn new_linux(window: &WebviewWindow) -> Result<Self, String> {
        let host = window
            .default_vbox()
            .map_err(|_| "err.player.output")?;
        let children = host.children();
        if children.is_empty() {
            return Err("err.player.output".into());
        }
        let area = gtk::GLArea::new();
        area.set_required_version(3, 2);
        area.set_use_es(false);
        area.set_auto_render(false);
        area.set_hexpand(true);
        area.set_vexpand(true);
        area.set_can_focus(false);
        let overlay = gtk::Overlay::new();
        overlay.add(&area);
        let page = gtk::Box::new(gtk::Orientation::Vertical, 0);
        page.set_hexpand(true);
        page.set_vexpand(true);
        for child in children {
            host.remove(&child);
            page.pack_start(&child, true, true, 0);
        }
        overlay.add_overlay(&page);
        host.pack_start(&overlay, true, true, 0);
        area.connect_render(|area, _| {
            NATIVE.with(|slot| {
                if let Some(native) = slot.borrow_mut().as_mut() {
                    native.render(area);
                }
            });
            glib::Propagation::Stop
        });
        area.connect_realize(|area| {
            NATIVE.with(|slot| {
                if let Some(native) = slot.borrow_mut().as_mut()
                    && let Err(error) = native.initialize(area)
                {
                    crate::diagnostics::warn(&format!("Linux video surface: {error}"));
                }
            });
        });
        // Normal signal handler runs before GTK's default destroys its context.
        area.connect_unrealize(|area| {
            area.make_current();
            NATIVE.with(|slot| {
                if let Some(native) = slot.borrow_mut().as_mut() {
                    native.renderer.take();
                }
            });
        });
        area.connect_resize(|_, _, _| {
            NATIVE.with(|slot| {
                if let Some(native) = slot.borrow().as_ref() {
                    native.dirty.store(true, Ordering::Release);
                }
            });
        });
        let dirty = Arc::new(AtomicBool::new(true));
        // mpv's callback only sets an atomic. A GTK source coalesces updates;
        // it never queues GTK operations from mpv's internal threads.
        let redraw = glib::timeout_add_local(Duration::from_millis(8), || {
            NATIVE.with(|slot| {
                if let Some(native) = slot.borrow().as_ref()
                    && native.area.is_mapped()
                    && native.dirty.swap(false, Ordering::AcqRel)
                {
                    native.area.queue_render();
                }
            });
            glib::ControlFlow::Continue
        });
        NATIVE.with(|slot| {
            *slot.borrow_mut() = Some(Native {
                area,
                mpv: None,
                renderer: None,
                dirty,
                redraw: Some(redraw),
            });
        });
        overlay.show_all();
        // Tauri can finish setup before the first map; realize the widget while
        // no registry borrow is held (the realize signal borrows it itself).
        NATIVE
            .with(|slot| slot.borrow().as_ref().map(|native| native.area.clone()))
            .ok_or("err.player.output")?
            .realize();
        Ok(Self)
    }

    /// Linux initializes its engine during Tauri setup. Worker commands reuse
    /// it; never wait for the main thread while holding the engine mutex.
    pub fn attach(&self, mpv: Arc<Mpv>) -> Result<(), String> {
        if !gtk::is_initialized_main_thread() {
            return Err("err.player.output".into());
        }
        NATIVE.with(|slot| {
            let mut slot = slot.borrow_mut();
            let native = slot.as_mut().ok_or("err.player.output")?;
            native.mpv = Some(mpv);
            let area = native.area.clone();
            let result = native.initialize(&area);
            if result.is_err() {
                native.mpv.take();
            }
            result
        })
    }

    /// Called on the GTK thread before the client handle's final drop.
    pub fn shutdown(&self) {
        NATIVE.with(|slot| {
            if let Some(mut native) = slot.borrow_mut().take() {
                if let Some(source) = native.redraw.take() {
                    source.remove();
                }
                native.area.make_current();
                native.renderer.take();
                native.mpv.take();
            }
        });
    }

    pub fn push_video_behind(&self) -> bool {
        // GTK Overlay supplies permanent stacking; no child needs restacking.
        true
    }
}

impl Native {
    fn initialize(&mut self, area: &gtk::GLArea) -> Result<(), String> {
        if self.renderer.is_some() || self.mpv.is_none() {
            return Ok(());
        }
        if !area.is_realized() {
            return Err("err.player.output".into());
        }
        area.make_current();
        if area.error().is_some() {
            return Err("err.player.output".into());
        }
        let mpv = self.mpv.as_ref().ok_or("player unavailable")?;
        self.renderer = Some(Renderer::new(mpv, self.dirty.clone())?);
        self.dirty.store(true, Ordering::Release);
        Ok(())
    }

    fn render(&mut self, area: &gtk::GLArea) {
        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
        let Some((width, height)) = super::framebuffer_size(
            area.allocated_width(),
            area.allocated_height(),
            area.scale_factor(),
        ) else {
            return;
        };
        // GTK binds its own framebuffer before render. FBO 0 would miss GTK's
        // composited texture, so render into the active framebuffer instead.
        let mut framebuffer = 0;
        // SAFETY: render signal guarantees a current GL context; writable int.
        unsafe { glGetIntegerv(0x8CA6, &mut framebuffer) };
        let mut fbo = OpenGlFbo {
            fbo: framebuffer,
            width,
            height,
            internal_format: 0,
        };
        let mut flip_y: c_int = 1;
        let mut params = [
            RenderParam {
                kind: 3,
                data: (&mut fbo as *mut OpenGlFbo).cast(),
            },
            RenderParam {
                kind: 4,
                data: (&mut flip_y as *mut c_int).cast(),
            },
            RenderParam::end(),
        ];
        // SAFETY: live context, original GL context current, render_gl.h params
        // live through this synchronous call. No blocking client API calls here.
        unsafe {
            mpv_render_context_update(renderer.context.as_ptr());
            mpv_render_context_render(renderer.context.as_ptr(), params.as_mut_ptr());
        }
    }
}

#[repr(C)]
struct RenderContext {
    _private: [u8; 0],
}
#[repr(C)]
struct RenderParam {
    kind: c_int,
    data: *mut c_void,
}
impl RenderParam {
    fn end() -> Self {
        Self {
            kind: 0,
            data: std::ptr::null_mut(),
        }
    }
}
#[repr(C)]
struct OpenGlInit {
    get_proc_address: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    context: *mut c_void,
}
#[repr(C)]
struct OpenGlFbo {
    fbo: c_int,
    width: c_int,
    height: c_int,
    internal_format: c_int,
}

struct Renderer {
    context: NonNull<RenderContext>,
    // mpv keeps this pointer until context_free completes.
    dirty: Arc<AtomicBool>,
}

impl Renderer {
    fn new(mpv: &Mpv, dirty: Arc<AtomicBool>) -> Result<Self, String> {
        let mut init = OpenGlInit {
            get_proc_address,
            context: std::ptr::null_mut(),
        };
        let mut params = [
            RenderParam {
                kind: 1,
                data: c"opengl".as_ptr().cast_mut().cast(),
            },
            RenderParam {
                kind: 2,
                data: (&mut init as *mut OpenGlInit).cast(),
            },
            RenderParam::end(),
        ];
        let mut context = std::ptr::null_mut();
        // SAFETY: initialized client; GTK GL context current; terminated params
        // matching the system libmpv render API.
        let result =
            unsafe { mpv_render_context_create(&mut context, mpv.handle(), params.as_mut_ptr()) };
        if result < 0 {
            return Err(format!(
                "couldn't initialize mpv OpenGL rendering: {}",
                mpv.error_text(result)
            ));
        }
        let context = NonNull::new(context).ok_or("mpv returned no render context")?;
        let renderer = Self { context, dirty };
        // SAFETY: userdata lives until context_free finishes callbacks.
        unsafe {
            mpv_render_context_set_update_callback(
                context.as_ptr(),
                Some(update),
                Arc::as_ptr(&renderer.dirty).cast_mut().cast(),
            )
        };
        Ok(renderer)
    }
}

impl Drop for Renderer {
    fn drop(&mut self) {
        // SAFETY: main-thread caller makes the original GL context current;
        // free waits for any in-flight update callback before releasing userdata.
        unsafe { mpv_render_context_free(self.context.as_ptr()) };
    }
}

unsafe extern "C" fn update(data: *mut c_void) {
    // SAFETY: Renderer owns this allocation until context_free returns.
    unsafe { &*data.cast::<AtomicBool>() }.store(true, Ordering::Release);
}

unsafe extern "C" fn get_proc_address(_: *mut c_void, name: *const c_char) -> *mut c_void {
    // GDK can use EGL (Wayland or X11) or GLX (X11). Select the backend with
    // the current context; GLVND dispatches to its driver.
    // SAFETY: current GTK GL context; mpv supplies a NUL-terminated GL name.
    unsafe {
        if !eglGetCurrentContext().is_null() {
            eglGetProcAddress(name)
        } else {
            glXGetProcAddressARB(name.cast())
        }
    }
}

#[link(name = "mpv")]
unsafe extern "C" {
    fn mpv_render_context_create(
        context: *mut *mut RenderContext,
        mpv: *mut Handle,
        params: *mut RenderParam,
    ) -> c_int;
    fn mpv_render_context_set_update_callback(
        context: *mut RenderContext,
        callback: Option<unsafe extern "C" fn(*mut c_void)>,
        data: *mut c_void,
    );
    fn mpv_render_context_update(context: *mut RenderContext) -> u64;
    fn mpv_render_context_render(context: *mut RenderContext, params: *mut RenderParam) -> c_int;
    fn mpv_render_context_free(context: *mut RenderContext);
}
#[link(name = "GL")]
unsafe extern "C" {
    fn glXGetProcAddressARB(name: *const u8) -> *mut c_void;
    fn glGetIntegerv(name: u32, value: *mut c_int);
}
#[link(name = "EGL")]
unsafe extern "C" {
    fn eglGetCurrentContext() -> *mut c_void;
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
}
