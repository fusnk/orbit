//! Linux: keeps the screen from dimming, locking or sleeping while a video
//! plays. On Windows and macOS mpv does this itself (`stop-screensaver`,
//! on by default) through its own video window; on Linux mpv draws through
//! the render API into Orbit's window (`vo=libmpv`) and has no window of its
//! own to do it with, so Orbit asks the desktop over D-Bus instead.
//!
//! `org.freedesktop.ScreenSaver` is asked first (KDE, Xfce, most others);
//! where it's missing (GNOME) the desktop portal's `Inhibit` is. Both release
//! the hold when Orbit's bus connection closes, so a crash or exit can't leave
//! the screen awake.
//!
//! The calls run on a task of their own: the player's event thread only
//! queues what it wants and never waits for the bus.

use std::collections::HashMap;
use std::sync::OnceLock;

use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use zbus::Connection;
use zbus::zvariant::{OwnedObjectPath, Value};

const REASON: &str = "Playing a video";
/// The portal's flag for "the session would go idle".
const PORTAL_IDLE: u32 = 8;

static WORKER: OnceLock<UnboundedSender<bool>> = OnceLock::new();

/// Whether the screen should stay awake (a video playing). Called only when that changes.
pub fn set(awake: bool) {
    let tx = WORKER.get_or_init(|| {
        let (tx, rx) = unbounded_channel();
        tauri::async_runtime::spawn(run(rx));
        tx
    });
    let _ = tx.send(awake);
}

/// What releases the hold.
enum Held {
    ScreenSaver(u32),
    Portal(OwnedObjectPath),
}

async fn run(mut rx: UnboundedReceiver<bool>) {
    let mut connection: Option<Connection> = None;
    let mut held: Option<Held> = None;
    while let Some(mut awake) = rx.recv().await {
        // Only the latest wish matters.
        while let Ok(next) = rx.try_recv() {
            awake = next;
        }
        if awake == held.is_some() {
            continue;
        }
        if connection.is_none() {
            connection = Connection::session().await.inspect_err(|e| crate::diagnostics::warn(&format!("idle inhibit: {e}"))).ok();
        }
        let Some(c) = connection.as_ref() else { continue };
        if awake {
            held = inhibit(c).await;
        } else if let Some(h) = held.take()
            && let Err(e) = release(c, h).await
        {
            crate::diagnostics::warn(&format!("idle inhibit: {e}"));
        }
    }
}

async fn inhibit(c: &Connection) -> Option<Held> {
    let screensaver = c
        .call_method(Some("org.freedesktop.ScreenSaver"), "/org/freedesktop/ScreenSaver", Some("org.freedesktop.ScreenSaver"), "Inhibit", &("Orbit", REASON))
        .await
        .and_then(|reply| reply.body().deserialize::<u32>());
    if let Ok(cookie) = screensaver {
        return Some(Held::ScreenSaver(cookie));
    }
    // No parent window to name ("").
    let options = HashMap::from([("reason", Value::from(REASON))]);
    match c
        .call_method(Some("org.freedesktop.portal.Desktop"), "/org/freedesktop/portal/desktop", Some("org.freedesktop.portal.Inhibit"), "Inhibit", &("", PORTAL_IDLE, options))
        .await
        .and_then(|reply| reply.body().deserialize::<OwnedObjectPath>())
    {
        Ok(handle) => Some(Held::Portal(handle)),
        Err(e) => {
            crate::diagnostics::warn(&format!("idle inhibit: no screensaver service or portal ({e})"));
            None
        }
    }
}

async fn release(c: &Connection, held: Held) -> zbus::Result<()> {
    match held {
        Held::ScreenSaver(cookie) => c.call_method(Some("org.freedesktop.ScreenSaver"), "/org/freedesktop/ScreenSaver", Some("org.freedesktop.ScreenSaver"), "UnInhibit", &(cookie,)).await,
        Held::Portal(handle) => c.call_method(Some("org.freedesktop.portal.Desktop"), handle.as_ref(), Some("org.freedesktop.portal.Request"), "Close", &()).await,
    }
    .map(drop)
}
