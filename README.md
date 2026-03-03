# ReactSIP Desktop

> ⚠️ **Proof of Concept** — This is an ambitious study project. It is fully functional, but not designed for production use.

ReactSIP is a compact SIP desktop softphone built with React + Electron as a deep-dive study project on VoIP communication, Electron desktop architecture, and native audio engine integration. The goal is not to compete with commercial solutions, but to explore and truly understand every layer of the stack — from the SIP protocol and RTP all the way through the native C process up to the React UI.

Despite being a PoC, **all core features are implemented and working**: SIP registration, voice calls, audio control, DTMF, transfer, call history, and more.

---

## Why does this project exist?

This repo was born out of a desire to genuinely understand how a modern softphone works — without relying on third-party SDKs that hide the complexity. Every technical decision here was made with learning in mind:

- How does the SIP protocol actually work in practice (REGISTER, INVITE, BYE, re-INVITE)?
- How do you integrate a native C process as an Electron sidecar?
- How do you manage reactive call state with Zustand?
- How do you package and distribute an Electron app with auto-update via GitHub Releases?

---

## Status

Functional proof of concept. Core features are working, but the codebase is still evolving — behavior and UI may change at any time.

---

## Main Features

- SIP account registration (username/password/domain)
- Outgoing and incoming calls
- Hangup, hold, mute, DTMF, transfer
- Call history
- Audio input/output device selection
- Input/output volume sliders
- Native SIP/RTP media path via UDP on Windows (sidecar `sip-agent.exe`)
- Installer + portable builds
- Auto-update from GitHub Releases (installer build)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 18 + Vite 5 |
| Desktop shell | Electron 24 |
| State | Zustand |
| Build/distribution | electron-builder + electron-updater |
| Native audio engine | PJSIP (C) via `sip-agent.exe` sidecar |

---

## Requirements

- Windows 10/11 x64
- Node.js 20+
- npm
- SIP server credentials (host/domain, user, password)

---

## Run Locally

```bash
npm install
npm run electron-dev
```

---

## Build

```bash
npm run electron-build
```

Output in `release/`:

- `ReactSIP Setup <version>.exe` — installer
- `ReactSIP <version>.exe` — portable
- `latest.yml` — used by auto-update

---

## Native SIP Agent (UDP media)

One of the most interesting aspects of this PoC is the integration with a native C sidecar based on PJSIP, responsible for the actual media path (SIP + RTP) on Windows. This allows bypassing Electron's limitations when dealing with low-latency UDP.

**Binary location:** `native/sip-agent/bin/sip-agent.exe`

**Build scripts:**

```bash
npm run native:setup:pjsip
npm run native:build:pjproject
npm run native:build:pjsip
npm run native:sync-agent
```

If you already have `sip-agent.exe` in `native/sip-agent/bin/`, `electron-build` will package it automatically.

---

## Auto-Update (GitHub Releases)

Configured via:
- `electron-builder.json` (GitHub provider)
- `public/electron.js` (`electron-updater`)

Notes:
- Auto-update is intended for the installer (`NSIS`) distribution.
- Portable build usually does not auto-update.

---

## Release Flow (Recommended)

1. Update the version in `package.json`.
2. Commit and push to `main`.
3. Create and push a tag:

```bash
git tag v0.0.3
git push origin v0.0.3
```

4. The GitHub Actions workflow (`.github/workflows/release.yml`) builds and publishes assets to the Release automatically.

---

## Configuration

**Basic account fields (Settings):**
- Display Name
- Username
- Password
- Domain/IP

**Advanced:**
- Transport (`udp`, `ws`, `wss`)
- Local SIP port
- RTP range
- STUN (optional)
- Show/Hide Debug tab

---

## Troubleshooting

### White screen after install
- Ensure the build uses relative assets (`vite.config.js` with `base: './'`).
- Rebuild and reinstall the latest executable.

### `Cannot find module 'electron-updater'`
- Ensure `electron-updater` is in `dependencies` (not only `devDependencies`).
- Rebuild the installer and reinstall.
- The app has a safe fallback if the updater module is unavailable.

### Workflow fails on `npm ci`
- Sync `package-lock.json` with `package.json`:
  ```bash
  npm install
  # commit both files
  ```

### No audio in call
- Confirm the native engine is being used (UDP mode on Windows).
- Check microphone permission and selected devices.
- Validate your SIP/PBX RTP configuration and firewall rules.

---

## Project Structure

```text
microsip-react-client/
  public/
    electron.js
    preload.js
  src/
    components/
    context/
    hooks/
    assets/
  native/
    sip-agent/
  scripts/
  electron-builder.json
  vite.config.js
  package.json
```

---

## Security Note

Dev builds may show Electron CSP warnings. Tighten CSP and Electron security settings before any production hardening.

---

## License

Project license not finalized yet.

---

*ReactSIP is a study project — technical contributions, issues, and discussions are welcome.*
