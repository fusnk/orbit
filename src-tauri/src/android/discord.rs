//! Android TV has no desktop Discord IPC service. Keep command compatibility
//! without opening a pipe, starting a worker, or publishing activity.

pub struct Discord;

impl Discord {
    pub fn new() -> Self {
        Self
    }
}

#[tauri::command]
pub fn discord_set_activity(discord: tauri::State<'_, Discord>, presence: serde_json::Value) -> Result<(), String> {
    let _ = (discord, presence);
    Ok(())
}

#[tauri::command]
pub fn discord_clear(discord: tauri::State<'_, Discord>) -> Result<(), String> {
    let _ = discord;
    Ok(())
}
