---
name: production-build
description: Build a production (release) Meetily desktop app and installer locally, verify the bundle, and optionally install it over the user's copy. Use when asked to make a production/release build, a .app/.dmg/installer, or to replace the installed Meetily with a local build. Covers the macOS release-build pitfalls (llama-helper OpenSSL error, broken proc-macro dylibs, updater-key error).
---

# Production build

Builds the release desktop app from `frontend/`. Tested on Apple Silicon macOS; for Windows and Linux follow [docs/BUILDING.md](../../../docs/BUILDING.md) and [docs/building_in_linux.md](../../../docs/building_in_linux.md) for prerequisites, and use the same overall flow.

Building is local and safe. **Notarizing, uploading, publishing a release, or replacing the user's installed app are outward-facing or destructive: do them only when the user explicitly asks.**

## 1. Prerequisites

- Rust, Node.js, and pnpm 9.15.9 (`npx -y pnpm@9.15.9 ...` works if a different pnpm is installed).
- Frontend dependencies, from `frontend/`:

  ```bash
  pnpm install --frozen-lockfile
  ```

- Know the host target triple:

  ```bash
  rustc -vV | grep host
  ```

## 2. Stage the release `llama-helper` sidecar

The Tauri bundle requires `frontend/src-tauri/binaries/llama-helper-<host-triple>` (gitignored). Build it in **release** mode from the repository root, then copy it:

```bash
cargo build -p llama-helper --release
```

```bash
cp target/release/llama-helper frontend/src-tauri/binaries/llama-helper-aarch64-apple-darwin
```

Use the real host triple from step 1 in the filename (`.exe` suffix on Windows). If the helper build fails, stop: never copy a placeholder binary.

**macOS: `X509_NAME` compile error in `cpp-httplib`.** Homebrew's OpenSSL 4 is being picked up. Build against OpenSSL 3 instead; if CMake already cached the wrong one, clean that crate first:

```bash
cargo clean -p llama-cpp-sys-2
```

```bash
OPENSSL_ROOT_DIR=/opt/homebrew/opt/openssl@3 CMAKE_PREFIX_PATH=/opt/homebrew/opt/openssl@3 cargo build -p llama-helper --release
```

## 3. Build the app

From `frontend/`:

```bash
CARGO_PROFILE_RELEASE_STRIP=false pnpm run tauri:build
```

`tauri:build` runs `scripts/tauri-auto.js`, which auto-detects a GPU feature (Apple Silicon → `coreml`; macOS builds always enable Whisper's Metal backend; override with `TAURI_GPU_FEATURE`). It also runs `pnpm build` for the Next.js export.

**Why `CARGO_PROFILE_RELEASE_STRIP=false`.** `frontend/src-tauri/.cargo/config.toml` force-sets `MACOSX_DEPLOYMENT_TARGET=14.2`. On recent macOS toolchains, Cargo's default release stripping combined with a deployment target produces proc-macro dylibs the loader rejects. Symptoms:

- `error[E0463]: can't find crate for ctor_proc_macro` (or another `*_macro` / `*_derive` crate)
- `dlopen(... .dylib): ... mis-aligned LINKEDIT string pool`

Disabling strip avoids it (the binary keeps its symbol table and is slightly larger; behaviour is unchanged). Passing `--target`, overriding `RUSTFLAGS`, or cleaning individual crates does **not** fix it. If you hit these errors after a build without the variable, rerun with it; Cargo rebuilds the affected crates because the profile changed.

**Expected final error.** The build ends with:

```
Error A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

`tauri.conf.json` enables updater artifacts signed with the upstream project's key. Without that private key only signing the updater archive (`meetily.app.tar.gz`) fails; the `.app` and `.dmg` are already complete. The command exits non-zero because of this, so check the bundle output rather than the exit code. Never generate or substitute signing keys without the user's agreement.

## 4. Outputs and verification (macOS)

- App: `target/release/bundle/macos/meetily.app`
- Installer: `target/release/bundle/dmg/meetily_<version>_aarch64.dmg`

`target/` is at the repository root (Cargo workspace), not under `frontend/`.

Verify before reporting success:

```bash
codesign --verify --deep --strict target/release/bundle/macos/meetily.app && echo signature-ok
```

```bash
ls target/release/bundle/macos/meetily.app/Contents/MacOS/
```

Expect `meetily`, `llama-helper`, and `ffmpeg`. Confirm the bundle timestamp is from this build, and check the version and bundle id with `PlistBuddy -c "Print CFBundleShortVersionString" -c "Print CFBundleIdentifier"` on `Contents/Info.plist`.

The local build is **ad-hoc signed** (`signingIdentity: "-"`), not notarized. It runs fine on the machine that built it; to distribute it, it must be signed with a Developer ID certificate and notarized, which needs the user's Apple credentials (they must store them themselves, e.g. with `xcrun notarytool store-credentials`).

## 5. Installing over the user's copy (only when asked)

The bundle id is `com.meetily.ai`, so the build replaces the installed Meetily and uses its data directory (`~/Library/Application Support/com.meetily.ai` on macOS).

1. **Back up the database** (safe while the app runs):

   ```bash
   cd ~/Library/Application\ Support/com.meetily.ai && sqlite3 meeting_minutes.sqlite ".backup 'meeting_minutes.sqlite.backup-$(date +%Y%m%d-%H%M%S)'"
   ```

2. **Ask the user to quit Meetily** (check with `pgrep -fl "MacOS/meetily"`). Do not force-quit it: it may be recording.
3. Move the existing `/Applications/meetily.app` aside as a backup (do not delete it), then copy the new bundle into `/Applications`.
4. Launch it and confirm it starts. Tell the user:
   - macOS will ask again for microphone and screen/system-audio recording permission, because the signature changed.
   - The first launch applies new database migrations; after that an older Meetily build refuses to open the database (sqlx reports a missing migration). Restore the backup to go back.
   - The updater still points at upstream releases. They should decline update prompts if their build contains changes upstream lacks.

## 6. Report

State exactly what ran, the artifacts produced (paths, version), verification results, the platform, and anything skipped (e.g. not notarized, updater signature not produced, live features not exercised).
