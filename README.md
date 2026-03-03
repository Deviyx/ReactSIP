# ReactSIP Desktop

ReactSIP is a compact SIP softphone desktop app built with React + Electron.

Current focus:
- SIP registration/calls
- Native UDP audio engine on Windows (sidecar `sip-agent.exe`)
- Audio devices/volume controls
- Clean compact UI
- GitHub Releases + auto-update support

## Status

This is an early version. Core features are working, but behavior and UI may still change.

## Main Features

- SIP account registration (username/password/domain)
- Outgoing and incoming calls
- Hangup, hold, mute, DTMF, transfer
- Call history
- Audio input/output device selection
- Input/output volume sliders
- Native SIP/RTP media path for UDP on Windows
- Installer + portable builds
- Auto-update from GitHub Releases (installer build)

## Tech Stack

- React 18
- Vite 5
- Electron 24
- Zustand
- `electron-builder`
- `electron-updater`

## Requirements

- Windows 10/11 x64
- Node.js 20+
- npm
- SIP server credentials (host/domain, user, password)

## Run Locally

```bash
npm install
npm run electron-dev
```

## Build

```bash
npm run electron-build
```

Output folder:
- `release/`

Main artifacts:
- `ReactSIP Setup <version>.exe` (installer)
- `ReactSIP <version>.exe` (portable)
- `latest.yml` (used by auto-update)

## Native SIP Agent (UDP media)

The app uses a native sidecar:
- `native/sip-agent/bin/sip-agent.exe`

Build scripts:
- `npm run native:setup:pjsip`
- `npm run native:build:pjproject`
- `npm run native:build:pjsip`
- `npm run native:sync-agent`

If you already have `sip-agent.exe` in `native/sip-agent/bin/`, `electron-build` will package it.

## Auto-Update (GitHub Releases)

Configured via:
- `electron-builder.json` (`publish` provider GitHub)
- `public/electron.js` (`electron-updater`)

Notes:
- Auto-update is intended for the installer (`NSIS`) distribution.
- Portable build usually does not auto-update.

## Release Flow (Recommended)

1. Update app version in `package.json`.
2. Commit and push to `main`.
3. Create and push a tag:

```bash
git tag v0.0.3
git push origin v0.0.3
```

4. GitHub Actions workflow (`.github/workflows/release.yml`) builds and publishes assets to the Release.

## Configuration

Basic account fields in Settings:
- Display Name
- Username
- Password
- Domain/IP

Advanced:
- Transport (`udp`, `ws`, `wss`)
- Local SIP port
- RTP range
- STUN (optional)
- Show/Hide Debug tab

## Troubleshooting

### White screen after install

- Ensure build uses relative assets (`vite.config.js` with `base: './'`).
- Rebuild and reinstall latest executable.

### `Cannot find module 'electron-updater'`

- Ensure `electron-updater` is in `dependencies` (not only `devDependencies`).
- Rebuild installer and reinstall.
- App now has safe fallback if updater module is unavailable.

### Workflow fails on `npm ci`

- Sync `package-lock.json` with `package.json`:
  - run `npm install`
  - commit both files

### No audio in call

- Confirm native engine is being used (UDP mode on Windows).
- Check microphone permission and selected devices.
- Validate SIP/PBX RTP configuration and firewall.

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

## Security Note

Current dev builds may show Electron CSP warnings. Tighten CSP and Electron security settings before production hardening.

## License

Project license not finalized yet.
