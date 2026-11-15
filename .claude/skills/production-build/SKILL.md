---
name: production-build
description: Build a production (release) Meetily desktop app and installers locally on macOS, Windows or Linux, verify the output, and optionally install it over the user's copy. Use when asked to make a production/release build, a .app/.dmg, .msi/.exe installer, .deb/.AppImage, or to replace the installed Meetily with a local build. Covers the known pitfalls (llama-helper OpenSSL error, macOS proc-macro dylib error, Linux AppImage stripping, updater-key error).
---

# Production build

Builds the release desktop app from `frontend/` on the machine you are running on. Tauri does not cross-compile installers, so build each platform on that platform.

| Platform | Status of these steps |
| --- | --- |
| macOS (Apple Silicon) | Run end to end in this fork |
| Windows x64 | Taken from the repository's Windows CI workflow (`.github/workflows/build-windows.yml`) and [docs/BUILDING.md](../../../docs/BUILDING.md); not yet run in this fork |
| Linux x64 (Debian/Ubuntu) | Taken from `.github/workflows/build-linux.yml`, `frontend/build-gpu.sh` and [docs/building_in_linux.md](../../../docs/building_in_linux.md); not yet run in this fork |

When a step fails on Windows or Linux, check the matching CI workflow: it is the most reliable record of what the upstream project builds with.

Building is local and safe. **Notarizing or code signing with the user's certificates, uploading, publishing a release, or replacing the user's installed app are outward-facing or destructive: do them only when the user explicitly asks.**

## 1. Prerequisites (all platforms)

- Rust (stable), Node.js, and pnpm 9.15.9 (`npm install -g pnpm@9.15.9`, or `npx -y pnpm@9.15.9 ...` if another pnpm is installed).
- CMake (whisper.cpp and llama.cpp are built from source).
- Platform packages: see [macOS](#macos), [Windows](#windows) or [Linux](#linux) below.
- Frontend dependencies, from `frontend/`:

  ```bash
  pnpm install --frozen-lockfile
  ```

- The host target triple, which names the sidecar binaries:

  ```bash
  rustc -vV
  ```

  Use the value after `host:`, e.g. `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`.

`frontend/src-tauri/build.rs` downloads the other bundled binaries itself on first build: the `ffmpeg` sidecar, and on Windows the ONNX Runtime DLLs into `frontend/src-tauri/binaries/onnxruntime/`. The first build therefore needs network access.

## 2. Stage the release `llama-helper` sidecar (all platforms)

The bundle requires `frontend/src-tauri/binaries/llama-helper-<host-triple>` (`.exe` on Windows; the folder is gitignored). Build it in **release** mode from the repository root, with OpenSSL disabled: llama.cpp's bundled `cpp-httplib` does not compile against OpenSSL 4 (`X509_NAME` errors), and the helper never uses HTTPS. The CI workflows build it the same way.

macOS / Linux:

```bash
CMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE cargo build -p llama-helper --release
```

```bash
mkdir -p frontend/src-tauri/binaries && cp target/release/llama-helper frontend/src-tauri/binaries/llama-helper-<host-triple>
```

Windows (PowerShell):

```powershell
$env:CMAKE_DISABLE_FIND_PACKAGE_OpenSSL = "TRUE"; cargo build -p llama-helper --release
```

```powershell
New-Item -ItemType Directory -Force frontend/src-tauri/binaries; Copy-Item target/release/llama-helper.exe frontend/src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe
```

Replace `<host-triple>` with the real value from step 1. If the helper build fails, stop: never copy a placeholder binary.

If an earlier build already cached OpenSSL in CMake, clean that crate first with `cargo clean -p llama-cpp-sys-2`. On macOS, building against Homebrew's OpenSSL 3 also works: `OPENSSL_ROOT_DIR=/opt/homebrew/opt/openssl@3 CMAKE_PREFIX_PATH=/opt/homebrew/opt/openssl@3 cargo build -p llama-helper --release`.

The helper is CPU-only here, as in CI. Its optional features are `metal`, `cuda` and `vulkan`; never pass Whisper's `coreml`, `hipblas` or `openblas` to it.

## 3. Build the app

From `frontend/`, the build is `pnpm run tauri:build`, plus the platform settings below. It runs `scripts/tauri-auto.js`, which picks a Whisper GPU feature (`scripts/auto-detect-gpu.js`; override with `TAURI_GPU_FEATURE`, empty string for CPU-only) and runs `pnpm build` for the Next.js export first.

`target/` is at the repository root (Cargo workspace), not under `frontend/` or `frontend/src-tauri/`.

### Expected final error (all platforms)

The build ends with:

```
Error A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

`tauri.conf.json` enables updater artifacts signed with the upstream project's key. Without that private key only the updater archive/signature fails; the app and installers are already complete. The command exits non-zero because of this, so check the bundle output rather than the exit code. Never generate or substitute signing keys without the user's agreement.

### macOS

Needs Xcode Command Line Tools and `brew install cmake`.

```bash
CARGO_PROFILE_RELEASE_STRIP=false pnpm run tauri:build
```

Auto-detection picks `coreml` on Apple Silicon (`metal` on Intel); Whisper's Metal backend is always on for macOS.

**Why `CARGO_PROFILE_RELEASE_STRIP=false`.** `frontend/src-tauri/.cargo/config.toml` force-sets `MACOSX_DEPLOYMENT_TARGET=14.2`. On recent macOS toolchains, Cargo's default release stripping combined with a deployment target produces proc-macro dylibs the loader rejects. Symptoms:

- `error[E0463]: can't find crate for ctor_proc_macro` (or another `*_macro` / `*_derive` crate)
- `dlopen(... .dylib): ... mis-aligned LINKEDIT string pool`

Disabling strip avoids it (the binary keeps its symbol table and is slightly larger; behaviour is unchanged). Passing `--target`, overriding `RUSTFLAGS`, or cleaning individual crates does **not** fix it. If you hit these errors after a build without the variable, rerun with it; Cargo rebuilds the affected crates because the profile changed.

Outputs:

- `target/release/bundle/macos/meetily.app`
- `target/release/bundle/dmg/meetily_<version>_<arch>.dmg`

### Windows

Needs, in addition to step 1:

- Visual Studio Build Tools with the **Desktop development with C++** workload (MSVC + Windows SDK). Use the `x86_64-pc-windows-msvc` Rust toolchain.
- CMake on `PATH`.
- WebView2 runtime (preinstalled on Windows 10/11).
- Optional, for GPU Whisper: the Vulkan SDK (`VULKAN_SDK` set). Distribution builds use Vulkan; without it the local build is CPU-only, which works on any x64 CPU.

From `frontend/` in PowerShell:

```powershell
pnpm run tauri:build
```

To match the upstream installer's Vulkan build, set the feature explicitly (requires the Vulkan SDK):

```powershell
$env:TAURI_GPU_FEATURE = "vulkan"; pnpm run tauri:build
```

**Portable builds.** A plain local build optimises whisper.cpp for the build machine's CPU, so the installer may crash on older CPUs. For an installer meant for other computers, do what CI does: set `CMAKE_PROJECT_INCLUDE` to the absolute path of `.github/force-portable-ggml.cmake` and `RUSTFLAGS` to `-C target-cpu=x86-64-v2` before building. `WHISPER_NATIVE=OFF` or plain `GGML_*` variables are not replacements.

Outputs:

- `target/release/bundle/nsis/meetily_<version>_x64-setup.exe`
- `target/release/bundle/msi/meetily_<version>_x64_en-US.msi`
- `target/release/meetily.exe`

The local build is unsigned, so SmartScreen warns when the installer runs. Signing needs the user's own code-signing certificate.

### Linux

Debian/Ubuntu packages used by CI (Fedora/Arch equivalents in [docs/building_in_linux.md](../../../docs/building_in_linux.md)):

```bash
sudo apt-get update && sudo apt-get install -y build-essential cmake git curl wget file libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libasound2-dev libopenblas-dev libx11-dev libxtst-dev libxrandr-dev fuse libfuse2
```

From `frontend/`:

```bash
NO_STRIP=true pnpm run tauri:build
```

`NO_STRIP=true` stops the AppImage bundler from stripping symbols, which otherwise breaks the AppImage at runtime (`frontend/build-gpu.sh` sets it for the same reason). Auto-detection picks `cuda` (NVIDIA + CUDA toolkit), `hipblas` (ROCm), `vulkan` (needs `VULKAN_SDK` and `BLAS_INCLUDE_DIRS`), `openblas` (needs `BLAS_INCLUDE_DIRS`) or CPU. CI ships `openblas`; for CUDA, set `CMAKE_CUDA_ARCHITECTURES` to the GPU's compute capability (e.g. `86`) first. `frontend/build-gpu.sh` wraps steps 2–3 (helper, staging, build) in one script.

Outputs:

- `target/release/bundle/deb/meetily_<version>_amd64.deb`
- `target/release/bundle/appimage/meetily_<version>_amd64.AppImage`

If the AppImage step fails on `linuxdeploy`/FUSE, make sure `libfuse2` is installed; the `.deb` is produced before it.

## 4. Verify before reporting success

Confirm the artifacts exist and their timestamps are from this build, then:

- **macOS:** `codesign --verify --deep --strict target/release/bundle/macos/meetily.app && echo signature-ok`; `ls target/release/bundle/macos/meetily.app/Contents/MacOS/` should list `meetily`, `llama-helper` and `ffmpeg`; check the version and bundle id with `/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" -c "Print CFBundleIdentifier" target/release/bundle/macos/meetily.app/Contents/Info.plist`. The build is **ad-hoc signed** (`signingIdentity: "-"`), not notarized: it runs on the machine that built it; distributing it needs a Developer ID certificate and notarization with the user's Apple credentials, which they must store themselves (e.g. `xcrun notarytool store-credentials`).
- **Windows:** the installers exist; `target/release/` contains `meetily.exe` and the bundled sidecars (`llama-helper*.exe`, `ffmpeg*.exe`), and `frontend/src-tauri/binaries/onnxruntime/onnxruntime.dll` was downloaded.
- **Linux:** `dpkg-deb --info target/release/bundle/deb/meetily_*.deb` shows the version and dependencies; the AppImage is executable (`chmod +x` if needed).

## 5. Installing over the user's copy (only when asked)

The bundle id is `com.meetily.ai`, so the build replaces the installed Meetily and uses its data directory:

| Platform | Data directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.meetily.ai` |
| Windows | `%APPDATA%\com.meetily.ai` |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/com.meetily.ai` |

1. **Ask the user to quit Meetily.** Do not force-quit it: it may be recording. Check it has exited (`pgrep -fl "MacOS/meetily"` on macOS, `pgrep -fl meetily` on Linux, `Get-Process meetily` on Windows).
2. **Back up `meeting_minutes.sqlite`** from the data directory, e.g. `sqlite3 meeting_minutes.sqlite ".backup 'meeting_minutes.sqlite.backup-<timestamp>'"`, or copy the file once the app has exited.
3. Install:
   - **macOS:** move `/Applications/meetily.app` aside as a backup (do not delete it), then copy the new bundle into `/Applications`.
   - **Windows:** run the NSIS `-setup.exe`; it upgrades the existing install in place.
   - **Linux:** `sudo apt install ./target/release/bundle/deb/meetily_<version>_amd64.deb`, or run the AppImage directly.
4. Launch it and confirm it starts. Tell the user:
   - macOS asks again for microphone and screen/system-audio recording permission, because the signature changed.
   - If the build adds database migrations, the first launch applies them, and after that an older Meetily build refuses to open the database (sqlx reports a missing migration). Restore the backup to go back.
   - The updater still points at upstream releases. They should decline update prompts if their build contains changes upstream lacks.

## 6. Report

State exactly what ran, the platform, the artifacts produced (paths, version), verification results, and anything skipped (e.g. not notarized or code-signed, updater signature not produced, CPU-only instead of GPU, live features not exercised).
