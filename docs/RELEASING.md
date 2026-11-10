# Releasing KromaGit

Releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml) when a version tag is pushed. Each platform builds in parallel and the installers are attached to a **draft** GitHub release, which you review and publish.

## 1. Bump the version

The version lives in three files — keep them identical:

| File | Field |
|---|---|
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/tauri.conf.json` | `"version"` |

Then refresh the lockfile (`cd src-tauri && cargo check`) and commit.

## 2. Tag and push

```bash
git tag v0.2.0
git push origin main --tags
```

The workflow can also be started by hand from the **Actions** tab (`workflow_dispatch`); that creates a draft named after the version in `tauri.conf.json`.

## 3. Publish

Open **Releases**, check the draft (one `.dmg` per Mac architecture, `.msi` + `-setup.exe` for Windows, `.AppImage` / `.deb` / `.rpm` for Linux), edit the notes and publish.

---

## Signing secrets

Every signing step is skipped — with a warning in the log — when its secrets are missing, so unsigned builds always work. Add these under **Settings → Secrets and variables → Actions**.

### macOS (Developer ID + notarization)

Requires an Apple Developer Program membership.

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Your **Developer ID Application** certificate exported from Keychain Access as `.p12`, base64-encoded: `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` — see `security find-identity -v -p codesigning` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | An [app-specific password](https://support.apple.com/102654) for that Apple ID (not your login password) |
| `APPLE_TEAM_ID` | Your 10-character Team ID |

Without `APPLE_ID` the app is signed but not notarized; Gatekeeper will still warn on first launch.

### Windows (Authenticode)

| Secret | What it is |
|---|---|
| `WINDOWS_CERTIFICATE` | Code-signing certificate as `.pfx`, base64-encoded: `certutil -encode cert.pfx cert.b64` (strip the header/footer lines) |
| `WINDOWS_CERTIFICATE_PASSWORD` | The `.pfx` password |

The workflow imports the certificate into the runner's certificate store and passes its thumbprint to Tauri (SHA-256 digest, DigiCert timestamp). Certificates that live in cloud HSMs (e.g. Azure Trusted Signing) need a custom `signCommand` instead — see the [Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

### Linux (GPG-signed AppImage)

| Secret | What it is |
|---|---|
| `LINUX_GPG_PRIVATE_KEY` | ASCII-armored private key: `gpg --armor --export-secret-keys KEYID` |
| `LINUX_GPG_PASSPHRASE` | Its passphrase |

The AppImage gets an embedded signature users can check with `./KromaGit.AppImage --appimage-signature`. `.deb` / `.rpm` packages are not signed by the bundler; distribute them through a signed repository if you need that.

## Unsigned builds

- **macOS**: right-click the app → **Open** the first time, or `xattr -dr com.apple.quarantine /Applications/KromaGit.app`.
- **Windows**: SmartScreen shows "Windows protected your PC" → **More info** → **Run anyway**.
