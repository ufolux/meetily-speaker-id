<div align="center">
    <img src="docs/Meetily-6.png" style="border-radius: 10px;" alt="Meetily" />
    <h1>Meetily Speaker ID</h1>
    <p><b>A local, privacy-first AI meeting assistant that knows who said what.</b></p>
</div>

This is a fork of [Meetily](https://github.com/Zackriya-Solutions/meetily), the open-source desktop app. Meetings are still captured, transcribed and summarised on your own machine. This fork adds:

- **[Speaker identification](#speaker-identification):** every transcript line is labelled with its speaker, and you can rename speakers.
- **[Recording playback](#recording-playback):** play a meeting's recording while the transcript follows along, and click any line to jump to that moment.
- **[Search](#search-in-transcripts-and-summaries):** find text in a meeting's transcript and its AI summary.

## Speaker identification

Transcripts are split into speaker turns, labelled **Me**, **Speaker 1**, **Speaker 2** and so on. You can give each speaker a real name.

- **Live recordings.** When both microphone and system audio are captured, speech that comes mainly from your microphone is labelled **Me**. Other voices are grouped by voiceprint, so remote participants get their own labels, and so do people in the same room as you.
- **Import and re-transcribe.** Imported audio and re-transcribed meetings are split wherever the speaker changes before transcription. Long stretches of back-and-forth conversation are attributed line by line.
- **Rename and merge.** On a meeting's page, click a speaker chip or use the **Speakers** bar to rename a speaker for that meeting. If one person was split into two speakers, merge them.
- **Copy and AI summaries.** Copied transcripts and the text sent for AI summaries are prefixed with speaker names, so summaries can say who decided what and who owns each action item.
- **Fully local.** Voiceprints come from a small on-device model (3D-Speaker CAM++, Chinese + English, 28 MB). The model is downloaded once from Hugging Face and checked against a pinned SHA-256 hash, and all speaker processing runs on your computer.

### Turning it on

1. Open **Settings → Transcription** and find **Speaker Identification**.
2. Leave **Identify speakers** switched on, then click **Download** next to the voice model.
3. Record, import, or re-transcribe (**Enhance**) a meeting.

Without the voice model, recordings that capture system audio are still split into **Me** and **Others**. Microphone-only recordings, imports and re-transcriptions need the model.

### Known limitations

- The voice-matching thresholds were calibrated on one real two-person meeting. Meetings with more people, or with very similar voices, may occasionally split one person in two (fix it with **merge**) or combine two voices.
- When two people talk at the same time, that speech gets a single label.
- Imports and re-transcriptions work from the mixed recording, so they label speakers by voice only and never use **Me**.
- Speaker names reset when a meeting is re-transcribed, because the speaker numbering is recalculated.
- Live speaker labelling has not yet been validated with real devices across platforms.

## Recording playback

Each meeting's page has a player above the transcript.

- **Play along.** Play/pause, skip back or forward 10 seconds, drag the seek bar, and change speed from 0.75× to 2×.
- **Transcript follows.** The line being played is highlighted and kept in view. Scroll away to read something else; following resumes a few seconds later.
- **Click to jump.** Click any line's text or timestamp to move the recording to that point. Playback doesn't start until you press Play, so you can line it up first. Selecting text to copy it doesn't move the recording.
- **Private.** The recording is played straight from the meeting's folder on disk; the app is only given access to that one file.

Meetings without a saved recording show no player. Recordings in a format the built-in player can't decode (for example some `.ogg` or `.wma` imports) show a message instead.

## Search in transcripts and summaries

- **Transcript.** Click 🔍 at the top of the transcript, or press **⌘F** (Ctrl+F on Windows/Linux). Every match is highlighted, the current one in orange, with a count such as `3/12`. **Enter** goes to the next match, **Shift+Enter** to the previous one, and **Esc** closes the search. Long transcripts are loaded in full first, so no match is missed. Search ignores case and works with Chinese and other non-Latin text.
- **Summary.** Click 🔍 at the top of the summary, or press **⌘F** while working in the summary. Matches are highlighted without changing the summary, and the results update as you edit or regenerate it. A phrase split across different formatting (for example half of it in bold) isn't found.

## Other features

These features come from Meetily itself:

- Real-time local transcription with **Whisper** or **Parakeet**.
- AI summaries with **Ollama** (local), Claude, Groq, OpenRouter, OpenAI, or any OpenAI-compatible endpoint.
- Microphone and system-audio capture with mixing.
- Import existing audio files, and re-transcribe meetings with a different model or language.
- GPU acceleration: Metal/CoreML on macOS, Vulkan on Windows, configurable source builds on Linux.

## Building from source

This fork does not publish installers; build it yourself on the platform you want to run it on (Tauri doesn't cross-compile installers). You need Rust, Node.js, pnpm 9.15.9 and CMake, plus the platform packages in [BUILDING.md](docs/BUILDING.md).

### Let an AI coding agent build it

The repository ships a [`production-build`](.claude/skills/production-build/SKILL.md) skill that walks an agent such as Claude Code through a release build on **macOS, Windows or Linux**: staging the `llama-helper` sidecar, the right build command for the platform, the known build errors and their fixes, checking the output, and (only when you ask) installing over your current Meetily after backing up its database.

Open the repository in the agent and ask, for example:

> Build a production version of Meetily for this machine.

> Build the Windows installer and install it over my current Meetily.

In Claude Code you can also run `/production-build`. Other agents can be pointed at the skill file directly, or at [AGENTS.md](AGENTS.md), which links to it. The macOS steps have been run end to end in this fork; the Windows and Linux steps follow the project's CI workflows and haven't been run in this fork yet.

### Build it yourself

1. Build and stage the `llama-helper` sidecar from the repository root (on Windows, set the variable with `$env:CMAKE_DISABLE_FIND_PACKAGE_OpenSSL="TRUE"` and copy `llama-helper.exe` to `llama-helper-<host-triple>.exe`):

   ```bash
   CMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE cargo build -p llama-helper --release
   ```

   ```bash
   mkdir -p frontend/src-tauri/binaries && cp target/release/llama-helper frontend/src-tauri/binaries/llama-helper-$(rustc -vV | sed -n 's/host: //p')
   ```

2. From `frontend/`, install dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

3. Run the app in development mode with `pnpm run tauri:dev`, or make a production build:

   | Platform | Command (from `frontend/`) | Output (under the repository-root `target/release/bundle/`) |
   | --- | --- | --- |
   | macOS | `CARGO_PROFILE_RELEASE_STRIP=false pnpm run tauri:build` | `macos/meetily.app`, `dmg/*.dmg` |
   | Windows | `pnpm run tauri:build` | `nsis/*-setup.exe`, `msi/*.msi` |
   | Linux | `NO_STRIP=true pnpm run tauri:build` | `deb/*.deb`, `appimage/*.AppImage` |

   The build ends with an error about `TAURI_SIGNING_PRIVATE_KEY`. That only affects the updater signature (it needs the upstream project's key); the app and installers are already built. See the [skill](.claude/skills/production-build/SKILL.md) for why the macOS and Linux variables are needed, GPU options and other troubleshooting, and [GPU acceleration](docs/GPU_ACCELERATION.md) for Whisper acceleration.

> **Sharing data with an existing install:** this build uses the same app ID and database as Meetily. On first launch it adds a `meeting_speakers` table to your meetings database, and after that an older Meetily build will refuse to open the database. Back up the `meeting_minutes.sqlite` file in the app data folder first if you plan to switch back.

## How it works

- **Live:** the audio pipeline records microphone and system-audio energy for each speech segment and tags the segment with its dominant source. The audio itself is still mixed as before. Each segment's voiceprint is matched against the speakers heard so far, with matching kept separate for microphone and system audio.
- **Batch:** overlapping 3-second windows (one every 1.5 s) are voiceprinted and grouped across the whole recording by average similarity. Segments are cut where the speaker changes, and each piece is transcribed separately.
- **Storage:** `transcripts.speaker` stores a stable speaker ID (`me`, `others` or `speaker_N`). Custom names live in a separate `meeting_speakers` table, so renaming never rewrites transcripts.

The speaker code lives in [`frontend/src-tauri/src/speaker/`](frontend/src-tauri/src/speaker/). See [architecture](docs/architecture.md#speaker-identification) for details. Playback is served by [`audio/playback.rs`](frontend/src-tauri/src/audio/playback.rs) through Tauri's asset protocol; search runs entirely in the frontend.

## License and credits

MIT, as in the original project: see [LICENSE.md](LICENSE.md). This fork is based on Meetily by Zackriya Solutions.

- Speaker embeddings: the [3D-Speaker](https://github.com/modelscope/3D-Speaker) CAM++ model, in the ONNX export published by [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx).
- Speech recognition: [Whisper.cpp](https://github.com/ggerganov/whisper.cpp), and NVIDIA's **Parakeet** in the [ONNX conversion by istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx).
- Upstream Meetily also credits [Screenpipe](https://github.com/mediar-ai/screenpipe) and [transcribe-rs](https://crates.io/crates/transcribe-rs).
