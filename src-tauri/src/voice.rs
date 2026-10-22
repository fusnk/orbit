//! Voice search on Android TV: Android's own speech prompt (it handles the microphone, so Orbit asks for
//! no permission), heard words back to Search. Not on a PC.

/// What was heard, cleaned to one plain line; None when nothing was (cancelled, silence).
#[tauri::command]
pub async fn search_listen(prompt: String) -> Result<Option<String>, String> {
    let prompt: String = prompt.chars().filter(|c| !c.is_control()).take(120).collect();
    #[cfg(target_os = "android")]
    return {
        // The prompt waits for the person; not on one of the async runtime's few threads.
        let heard = tauri::async_runtime::spawn_blocking(move || crate::player::android::listen(&prompt)).await.map_err(|_| "unavailable")??;
        Ok(heard.map(|text| text.chars().filter(|c| !c.is_control()).take(200).collect::<String>().trim().to_owned()).filter(|text| !text.is_empty()))
    };
    #[cfg(not(target_os = "android"))]
    {
        let _ = prompt;
        Err("unsupported".into())
    }
}
