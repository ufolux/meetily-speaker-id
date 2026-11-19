//! Fragmented-MP4 support for long recordings.
//!
//! A regular MP4 keeps its sample index (`moov`) in one box whose size grows with the
//! recording length (about 4 bytes per 21 ms AAC frame, i.e. ~700 KB per hour). On macOS the
//! webview loads recordings through Tauri's asset protocol, which answers every range request
//! with at most ~1 MB. Once `moov` no longer fits in a single response, WebKit rejects the file
//! (`MediaError` code 4) and the recording cannot be played in the app (roughly after 90 min).
//!
//! Fragmented MP4 keeps `moov` tiny (the index lives in per-fragment `moof` boxes), so playback
//! no longer depends on the index size. New recordings are written that way
//! (see [`FRAGMENT_MOVFLAGS`]); existing ones are remuxed once, losslessly, by
//! [`migrate_recordings_on_startup`].

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Result};
use log::{error, info, warn};
use tauri::{AppHandle, Manager, Runtime};

use crate::database::repositories::meeting::MeetingsRepository;
use crate::state::AppState;

use super::ffmpeg::find_ffmpeg_path;

/// `-movflags` value that produces a fragmented MP4 with a tiny `moov`.
pub const FRAGMENT_MOVFLAGS: &str = "+frag_keyframe+empty_moov+default_base_moof";

/// Fragment length in microseconds (10 s). Without it every AAC packet (all keyframes) would
/// become its own fragment.
pub const FRAGMENT_DURATION_US: &str = "10000000";

/// Files whose `moov` is at least this large are migrated. The webview limit is ~1,000 KiB;
/// migrating from 512 KiB (~45 min of audio) leaves a 2x safety margin.
const MOOV_MIGRATION_THRESHOLD: u64 = 512 * 1024;

/// Delay before the migration starts so it does not compete with app startup.
const STARTUP_DELAY_SECS: u64 = 20;

/// Maximum allowed difference between source and remuxed duration.
const DURATION_TOLERANCE_SECS: f64 = 1.0;

/// Result of inspecting the top-level boxes of an MP4 file.
#[derive(Debug, PartialEq, Eq)]
enum Mp4Layout {
    /// Fragmented (has `moof` boxes): nothing to do.
    Fragmented,
    /// Progressive file with the given `moov` size in bytes.
    Progressive { moov_size: u64 },
    /// Not an MP4 container we understand (leave untouched).
    Unknown,
}

/// Walk the top-level boxes without reading `mdat` payloads.
fn inspect_layout<R: Read + Seek>(reader: &mut R) -> Result<Mp4Layout> {
    let file_len = reader.seek(SeekFrom::End(0))?;
    let mut pos = 0u64;
    let mut moov_size = None;
    let mut saw_ftyp = false;

    while pos + 8 <= file_len {
        reader.seek(SeekFrom::Start(pos))?;
        let mut header = [0u8; 8];
        reader.read_exact(&mut header)?;
        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let kind = [header[4], header[5], header[6], header[7]];

        let size = match size32 {
            0 => file_len - pos, // box extends to end of file
            1 => {
                let mut large = [0u8; 8];
                reader.read_exact(&mut large)?;
                u64::from_be_bytes(large)
            }
            n => n,
        };
        if size < 8 || pos + size > file_len {
            // Truncated or corrupt box: do not touch the file.
            return Ok(Mp4Layout::Unknown);
        }

        match &kind {
            b"ftyp" => saw_ftyp = true,
            b"moof" => return Ok(Mp4Layout::Fragmented),
            b"moov" => moov_size = Some(size),
            _ => {}
        }
        pos += size;
    }

    match (saw_ftyp, moov_size) {
        (true, Some(moov_size)) => Ok(Mp4Layout::Progressive { moov_size }),
        _ => Ok(Mp4Layout::Unknown),
    }
}

/// True if `path` is a progressive MP4 whose index is large enough to break webview playback.
pub fn needs_migration(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    match inspect_layout(&mut file) {
        Ok(Mp4Layout::Progressive { moov_size }) => moov_size >= MOOV_MIGRATION_THRESHOLD,
        _ => false,
    }
}

/// True if `path` is a fragmented MP4.
pub fn is_fragmented(path: &Path) -> bool {
    File::open(path)
        .ok()
        .and_then(|mut f| inspect_layout(&mut f).ok())
        == Some(Mp4Layout::Fragmented)
}

/// Extract the container duration (seconds) from `ffmpeg -i <file>` output.
fn parse_duration(ffmpeg_stderr: &str) -> Option<f64> {
    let rest = ffmpeg_stderr.split("Duration: ").nth(1)?;
    let stamp = rest.split(',').next()?.trim();
    let mut parts = stamp.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn ffmpeg_command(ffmpeg: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(ffmpeg);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn probe_duration(ffmpeg: &Path, file: &Path) -> Result<f64> {
    // `ffmpeg -i` without an output exits non-zero but still prints the stream info.
    let output = ffmpeg_command(ffmpeg).arg("-hide_banner").arg("-i").arg(file).output()?;
    parse_duration(&String::from_utf8_lossy(&output.stderr))
        .ok_or_else(|| anyhow!("could not read duration of {}", file.display()))
}

/// Losslessly remux `path` into a fragmented MP4 and replace it atomically.
///
/// The original is only replaced after ffmpeg succeeded and the result has the same duration
/// and a plausible size, so a failure at any point leaves the original untouched.
pub fn migrate_file(path: &Path) -> Result<()> {
    let ffmpeg = find_ffmpeg_path().ok_or_else(|| anyhow!("FFmpeg not found"))?;
    let temp: PathBuf = path.with_file_name(".audio.fragmented.tmp.mp4");
    let _ = std::fs::remove_file(&temp);

    let result = (|| -> Result<()> {
        let output = ffmpeg_command(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(path)
            .args([
                "-map", "0:a", "-c", "copy",
                "-movflags", FRAGMENT_MOVFLAGS,
                "-frag_duration", FRAGMENT_DURATION_US,
                "-f", "mp4",
            ])
            .arg(&temp)
            .output()?;
        if !output.status.success() {
            return Err(anyhow!("ffmpeg remux failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        // The result must really be fragmented, or the migration would repeat forever.
        let mut remuxed = File::open(&temp)?;
        if inspect_layout(&mut remuxed)? != Mp4Layout::Fragmented {
            return Err(anyhow!("remuxed file is not fragmented"));
        }

        let src_len = std::fs::metadata(path)?.len();
        let dst_len = std::fs::metadata(&temp)?.len();
        // Remuxing only moves the index around, so sizes must stay within a couple of percent.
        if dst_len < src_len.saturating_mul(98) / 100 || dst_len > src_len.saturating_mul(102) / 100 {
            return Err(anyhow!("remuxed size {} is implausible for source size {}", dst_len, src_len));
        }

        let src_dur = probe_duration(&ffmpeg, path)?;
        let dst_dur = probe_duration(&ffmpeg, &temp)?;
        if (src_dur - dst_dur).abs() > DURATION_TOLERANCE_SECS {
            return Err(anyhow!("duration mismatch: {:.2}s vs {:.2}s", src_dur, dst_dur));
        }

        // Atomic replace (fails harmlessly on Windows if the file is currently open).
        std::fs::rename(&temp, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Migrate every saved meeting recording that needs it. Returns (migrated, failed).
fn migrate_folders(folders: Vec<PathBuf>) -> (usize, usize) {
    let (mut migrated, mut failed) = (0, 0);
    for folder in folders {
        // A `.checkpoints` folder means a recording or crash recovery is still in flight.
        if !folder.is_dir() || folder.join(".checkpoints").exists() {
            continue;
        }
        let Ok(audio) = super::retranscription::find_audio_file(&folder) else {
            continue;
        };
        let ext = audio.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "mp4" | "m4a") || !needs_migration(&audio) {
            continue;
        }

        info!("Migrating long recording to fragmented MP4: {}", audio.display());
        match migrate_file(&audio) {
            Ok(()) => {
                migrated += 1;
                info!("Migrated recording: {}", audio.display());
            }
            Err(e) => {
                failed += 1;
                // Not fatal: the original is intact and the next launch retries.
                warn!("Could not migrate recording {}: {}", audio.display(), e);
            }
        }
    }
    (migrated, failed)
}

/// Background, idempotent migration of existing long recordings. Safe to run at every launch:
/// it only reads box headers of files that are already fragmented or small.
pub async fn migrate_recordings_on_startup<R: Runtime>(app: AppHandle<R>) {
    tokio::time::sleep(std::time::Duration::from_secs(STARTUP_DELAY_SECS)).await;

    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let folders = match MeetingsRepository::get_all_folder_paths(state.db_manager.pool()).await {
        Ok(folders) => folders,
        Err(e) => {
            error!("Recording migration skipped, could not list meetings: {}", e);
            return;
        }
    };

    let result = tokio::task::spawn_blocking(move || migrate_folders(folders)).await;
    match result {
        Ok((0, 0)) => {}
        Ok((migrated, failed)) => info!("Recording migration finished: {} migrated, {} failed", migrated, failed),
        Err(e) => error!("Recording migration task crashed: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn boxed(kind: &[u8; 4], payload_len: usize) -> Vec<u8> {
        let mut b = ((payload_len + 8) as u32).to_be_bytes().to_vec();
        b.extend_from_slice(kind);
        b.extend(std::iter::repeat(0u8).take(payload_len));
        b
    }

    #[test]
    fn detects_progressive_layout_and_moov_size() {
        let mut data = boxed(b"ftyp", 12);
        data.extend(boxed(b"mdat", 1000));
        data.extend(boxed(b"moov", 600 * 1024));
        let layout = inspect_layout(&mut Cursor::new(data)).unwrap();
        assert_eq!(layout, Mp4Layout::Progressive { moov_size: 600 * 1024 + 8 });
    }

    #[test]
    fn detects_fragmented_layout() {
        let mut data = boxed(b"ftyp", 12);
        data.extend(boxed(b"moov", 700));
        data.extend(boxed(b"moof", 100));
        data.extend(boxed(b"mdat", 1000));
        assert_eq!(inspect_layout(&mut Cursor::new(data)).unwrap(), Mp4Layout::Fragmented);
    }

    #[test]
    fn truncated_or_foreign_files_are_left_alone() {
        let mut truncated = boxed(b"ftyp", 12);
        truncated.extend(boxed(b"mdat", 1000));
        truncated.truncate(truncated.len() - 10);
        assert_eq!(inspect_layout(&mut Cursor::new(truncated)).unwrap(), Mp4Layout::Unknown);
        assert_eq!(inspect_layout(&mut Cursor::new(b"RIFFxxxxWAVE".to_vec())).unwrap(), Mp4Layout::Unknown);
    }

    #[test]
    fn parses_ffmpeg_duration() {
        let text = "Input #0, mov,mp4\n  Duration: 02:35:03.02, start: 0.000000, bitrate: 166 kb/s";
        let d = parse_duration(text).unwrap();
        assert!((d - 9303.02).abs() < 0.001);
        assert!(parse_duration("no duration here").is_none());
    }

    /// End-to-end with real ffmpeg: a long progressive file is detected, remuxed, and the audio
    /// is unchanged. Skipped when ffmpeg is unavailable.
    #[test]
    fn migrates_long_recording_losslessly() {
        let Some(ffmpeg) = find_ffmpeg_path() else {
            eprintln!("ffmpeg not available, skipping");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("audio.mp4");
        // 3000 s of 48 kHz AAC => ~140k frames => moov above the 512 KiB threshold.
        let status = ffmpeg_command(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=3000:c=pink:r=48000:a=0.1"])
            .args(["-c:a", "aac", "-b:a", "64k", "-f", "mp4"])
            .arg(&audio)
            .status()
            .unwrap();
        assert!(status.success());
        assert!(needs_migration(&audio));
        let before = probe_duration(&ffmpeg, &audio).unwrap();

        migrate_file(&audio).unwrap();

        assert!(!needs_migration(&audio));
        assert_eq!(inspect_layout(&mut File::open(&audio).unwrap()).unwrap(), Mp4Layout::Fragmented);
        let after = probe_duration(&ffmpeg, &audio).unwrap();
        assert!((before - after).abs() <= DURATION_TOLERANCE_SECS);
        assert!(!dir.path().join(".audio.fragmented.tmp.mp4").exists());
    }
}
