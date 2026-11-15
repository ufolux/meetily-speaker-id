//! Meeting audio playback: locates a meeting's recording and lets the webview
//! stream it through the asset protocol.

use crate::database::repositories::meeting::MeetingsRepository;
use crate::state::AppState;
use log::{info, warn};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Serialize)]
pub struct MeetingAudio {
    /// Absolute path of the recording; pass it to `convertFileSrc` in the frontend.
    pub path: String,
}

/// Returns the meeting's recording, or `None` when the meeting has no audio file.
///
/// Only that single file is added to the asset-protocol scope, so the webview
/// cannot read anything else from the recordings folder.
#[tauri::command]
pub async fn api_get_meeting_audio<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<MeetingAudio>, String> {
    let pool = state.db_manager.pool();
    let meeting = MeetingsRepository::get_meeting_metadata(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to load meeting: {}", e))?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    let Some(folder) = meeting.folder_path.filter(|p| !p.trim().is_empty()) else {
        return Ok(None);
    };
    let folder = PathBuf::from(folder);
    if !folder.is_dir() {
        return Ok(None);
    }
    let audio_path = match super::retranscription::find_audio_file(&folder) {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };

    if let Err(e) = app.asset_protocol_scope().allow_file(&audio_path) {
        warn!("Could not allow meeting audio for playback: {}", e);
        return Err("Could not open the recording for playback".to_string());
    }
    info!("Meeting audio ready for playback (meeting {})", meeting_id);

    Ok(Some(MeetingAudio {
        path: audio_path.to_string_lossy().into_owned(),
    }))
}
