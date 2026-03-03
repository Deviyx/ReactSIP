# sip-agent (native sidecar)

This folder contains the native UDP SIP sidecar skeleton for Electron.

## Current status

- JSON Lines protocol implemented (stdin/stdout)
- Command routing scaffolded
- PJSIP/PJSUA2 integration points created (`EngineStubs.*`)
- Runtime emits `engine_ready`

The current binary is a **stub**: SIP/media commands return `not implemented` until PJSIP wiring is added.

## Build (Windows)

```powershell
cd native\sip-agent
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

## Build with PJSIP/PJSUA2 (real SIP/RTP media)

Set `PJSIP_DIR` to your PJSIP build root (the folder containing `include/` and `lib/`).

```powershell
$env:PJSIP_DIR="C:\\deps\\pjsip"
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DSIP_AGENT_WITH_PJSIP=ON -DPJSIP_DIR="$env:PJSIP_DIR"
cmake --build build --config Release
```

Expected output:

- `native/sip-agent/build/Release/sip-agent.exe`

Electron will auto-detect the binary in development mode.

## Next integration steps

1. Replace `EngineStubs` internals with PJSUA2 endpoint/account/call/audio managers.
2. Emit real events:
   - `registration_state`
   - `incoming_call`
   - `call_state`
   - `call_media_state`
   - `audio_devices`
   - `audio_level`
3. Package `sip-agent.exe` via `electron-builder extraResources`.
