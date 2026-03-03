# MicroSIP Architecture & Design Document

## System Overview

MicroSIP is a browser-based SIP softphone that enables voice calls through WebRTC. The application is built using React 18 and JsSIP library for protocol handling.

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  React Application                     │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │           UI Components Layer                     │ │  │
│  │  │  ┌─────────────┬──────────────┬─────────────┐    │ │  │
│  │  │  │   Dialpad   │  ActiveCall  │  Settings   │    │ │  │
│  │  │  └─────────────┴──────────────┴─────────────┘    │ │  │
│  │  │  ┌──────────────────────────────────────────┐    │ │  │
│  │  │  │      StatusBar & IncomingCall Modal       │    │ │  │
│  │  │  └──────────────────────────────────────────┘    │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │        State Management Layer (Zustand)          │ │  │
│  │  │  SIPContext: settings, status, sessions, calls   │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │           Business Logic Layer (Hooks)           │ │  │
│  │  │  useSIP: SIP protocol operations                 │ │  │
│  │  │  useAudio: Microphone & permissions              │ │  │
│  │  │  useCallTimer: Duration tracking                 │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │         Protocol & Media Layer                    │ │  │
│  │  │  JsSIP Library: SIP stack                         │ │  │
│  │  │  WebRTC API: Audio/RTC streams                    │ │  │
│  │  │  LocalStorage: Persistent settings                │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ WebSocket (WSS/WS)
                           │ RTP/SRTP (Audio)
                           │
┌─────────────────────────────────────────────────────────────┐
│                    SIP Server                               │
│   (Asterisk, FreeSWITCH, Kamailio, etc.)                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ INVITE, REGISTER, BYE
                           │
┌─────────────────────────────────────────────────────────────┐
│                 Remote SIP Devices                           │
│  (Other phones, extensions, gateways, etc.)                │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

### Component Hierarchy

```
App (Main)
├── StatusBar
│   └── Shows registration status
├── Tab Navigation
│   ├── Dialpad Tab
│   │   └── Dialpad Component
│   ├── History Tab
│   │   └── CallHistory Component
│   └── Settings Tab
│       └── Settings Component
├── ActiveCall Component (overlays tabs when session active)
├── IncomingCall Modal (overlays everything on incoming call)
└── Toaster (Global notifications)
```

## State Management Flow

```
User Interaction
        │
        ▼
Component Handler
        │
        ▼
Zustand Context Store (SIPContext)
        │
        ├── Update settings
        ├── Update status
        ├── Update session
        └── Add to history
        │
        ▼
Hook Consumer
        │
        ├── useSIP: Calls JsSIP
        ├── useAudio: Manages permissions
        └── useCallTimer: Tracks duration
        │
        ▼
Persistent Storage
        └── localStorage (auto-synced by Zustand)
```

## SIP Call Lifecycle

### Outgoing Call Sequence

```
1. User dials number → makeCall(destination)
   │
   ├── Validate registration status
   ├── Build target SIP URI
   └── Create WebRTC constraints
   │
2. ua.call(destination, options)
   │
   ├── JsSIP creates INVITE message
   ├── WebSocket sends to SIP server
   └── Local RTC peer connection created
   │
3. Server routes to destination
   │
   ├── Remote phone rings
   └── 180 Ringing response received
   │
4. Remote user answers
   │
   ├── 200 OK response with SDP answer
   ├── WebRTC offer-answer exchange
   └── ICE candidates gathered
   │
5. session.on('confirmed')
   │
   ├── Audio streams connected
   ├── Call timer starts
   └── Switch to ActiveCall screen
   │
6. Media flow
   │
   ├── Audio captured from microphone
   ├── Encoded to RTP/SRTP packets
   ├── Sent to remote peer via UDP
   └── Received audio decoded and played
   │
7. Call termination
   │
   ├── User clicks hangup
   ├── ua.bye() or session.terminate()
   ├── BYE message sent to server
   └── session.on('ended') triggered
   │
8. Cleanup
   │
   ├── RTC connections closed
   ├── Streams released
   ├── Call added to history
   └── Return to idle state
```

### Incoming Call Sequence

```
1. Remote party calls your number
   │
   ├── SIP server receives INVITE
   └── Routes to your WebSocket connection
   │
2. Client receives INVITE
   │
   ├── ua.on('newRTCSession') triggered
   ├── Incoming call data extracted
   └── setIncomingCallData() called
   │
3. IncomingCall modal appears
   │
   ├── Shows caller ID
   ├── Ring animation (visual)
   └── Ring sound plays (optional)
   │
4. User clicks accept
   │
   ├── answerCall() called
   ├── ICE candidates gathered
   └── SDP answer created
   │
5. 200 OK sent back
   │
   ├── Server relays to caller
   ├── WebRTC peer connection establishes
   └── Audio streams negotiate
   │
6. session.on('confirmed')
   │
   ├── Audio bidirectional flow starts
   ├── ActiveCall screen shown
   └── Call duration timer begins
   │
7. Call management
   │
   ├── Can mute/unmute
   ├── Can hold/unhold
   ├── Can send DTMF tones
   └── Call duration tracked
   │
8. Call ends
   │
   ├── Either party can terminate
   ├── BYE message exchanged
   ├── session.on('ended') fires
   └── Call logged to history
```

## Hook Architecture

### useSIP Hook

**Responsibilities:**
- Initialize JsSIP user agent
- Manage SIP registration
- Handle outgoing calls
- Answer incoming calls
- Manage mute/hold state
- Send DTMF tones
- Manage RTC peer connections
- Handle call events

**Key State:**
- User agent reference
- Current session reference
- Call start time
- Local mute/hold state

**Key Functions:**
- `connect()` - Register with SIP server
- `disconnect()` - Unregister and cleanup
- `makeCall(destination)` - Initiate outgoing call
- `answerCall()` - Accept incoming call
- `hangupCall()` - Terminate call
- `muteCall()` - Toggle mute
- `holdCall()` - Toggle hold
- `sendDTMF(tone)` - Send DTMF tone

### useAudio Hook

**Responsibilities:**
- Request microphone permission
- Monitor microphone level
- Handle audio device selection
- Manage MediaStream lifecycle
- Create audio level visualization

**Key State:**
- Microphone permission status
- Microphone level (0-100)
- Available audio devices
- Current MediaStream

**Key Functions:**
- `selectDevice(deviceId)` - Switch audio input
- Auto-cleanup on unmount

### useCallTimer Hook

**Responsibilities:**
- Track call duration
- Format time display
- Update every second

**Input:**
- Start time (Date object)

**Output:**
- Formatted time string (HH:MM:SS)

## Storage Architecture

### Zustand Store Structure

```javascript
{
  // Configuration
  settings: {
    uri: "sip:1001@domain.com",
    username: "1001",
    domain: "domain.com",
    password: "***",
    display_name: "John",
    ws_servers_host: "server.com",
    ws_servers_port: "8089",
    transport: "wss",
    register: true,
    session_timers: false,
    use_preloaded_route: false,
  },

  // Connection Status
  connectionStatus: "Connected" | "Disconnected" | "Connecting" | "Error",
  registrationStatus: "Registered" | "Unregistered" | "Registering" | "Failed",
  sipUri: "sip:1001@domain.com",

  // Session Data
  session: RtcSession | null,
  incomingCallData: { id, number, displayName } | null,

  // Call State
  calls: [ { id, number, direction, status, startTime } ],
  callHistory: [ { id, number, direction, duration, timestamp, status } ],
  muted: false,
  onHold: false,

  // Actions
  setSettings(updates),
  setConnectionStatus(status),
  setRegistrationStatus(status),
  setSipUri(uri),
  setSession(session),
  setIncomingCallData(data),
  addCall(call),
  updateCall(id, updates),
  addToHistory(call),
  setMuted(bool),
  setOnHold(bool),
}
```

### localStorage Notes

- **Key**: `microsip-storage`
- **Persistence**: Automatic via Zustand persist middleware
- **Sensitive Data**: Password stored in plain text (use HTTPS in production!)
- **Size**: ~20KB typical

## WebRTC Configuration

### Constraints

```javascript
{
  audio: {
    echoCancellation: true,    // Remove echo feedback
    noiseSuppression: true,    // Reduce background noise
    autoGainControl: false,    // Manual control for SIP
  }
}
```

### STUN/TURN Servers

```javascript
{
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ]
    },
    // Optional TURN for restricted networks
    {
      urls: ['turn:turnserver.com:3478'],
      username: 'user',
      credential: 'pass'
    }
  ],
  rtcpMuxPolicy: 'require',  // Multiplex RTP and RTCP
}
```

## Security Architecture

### Transport Security
- **WSS (Recommended)**: TLS encrypted WebSocket
- **WS**: Unencrypted (development/testing only)

### SIP Credentials
- **Digest Authentication**: Built-in to JsSIP
- **Password Hashing**: Server-side responsibility
- **Rate Limiting**: Recommended on SIP server

### Browser Security
- **Sandboxing**: JavaScript runs in browser sandbox
- **CORS**: Handled by server CORS headers
- **CSP Headers**: Can be enforced by server

### Data Privacy
- **Settings**: Stored unencrypted in localStorage
- **Audio**: Encrypted via SRTP (media layer)
- **Credentials**: Never logged or exposed

## Performance Optimization

### Bundle Size
- React + Hooks: ~40KB (prod, gzipped)
- JsSIP: ~200KB
- BrotliCSS + Tailwind: ~30KB
- **Total**: ~270KB

### Memory Usage
- Idle state: ~30MB
- Active call: ~50-70MB
- Long sessions: Monitor for leaks

### Connection Pooling
- Single WebSocket connection
- Multiplexed SIP messages
- RTC peer connection per call

### Lazy Loading
- Components loaded on-demand
- Styles included via Tailwind
- No code splitting (small app)

## Error Handling Strategy

### Network Errors
```
WebSocket Error
    ↓
setConnectionStatus('Error')
    ↓
Show toast notification
    ↓
Auto-retry after delay
```

### SIP Errors
```
Registration Failed (403)
    ↓
setRegistrationStatus('Registration Failed')
    ↓
Show error message
    ↓
User can correct credentials
    ↓
Retry registration
```

### Media Errors
```
Microphone Denied
    ↓
setMicPermission(false)
    ↓
Show warning bar
    ↓
Offer browser settings link
```

## Testing Architecture

### Unit Tests
- Component rendering
- Hook behavior
- Store state changes
- Utility functions

### Integration Tests
- Component interaction
- State flow
- Event handling

### End-to-End Tests
- Full call flow (if SIP server available)
- Registration process
- Call history

## Accessibility Considerations

- Color contrast (WCAG AA) in dark theme
- Keyboard navigation support
- Focus indicators on buttons
- ARIA labels on interactive elements
- Touch-friendly button sizes (44px minimum)

## Browser Compatibility

### Required APIs
- WebRTC (getUserMedia, RTCPeerConnection)
- WebSocket
- ES6+ JavaScript features
- localStorage API
- Fetch API

### Tested Browsers
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Deployment Considerations

### Pre-deployment Checklist
- [ ] Test with actual SIP server
- [ ] Verify STUN reachability
- [ ] Enable compression
- [ ] Configure CORS headers
- [ ] Set up SSL certificates
- [ ] Verify firewall rules
- [ ] Test on production network

### Monitoring
- WebSocket connection health
- Registration success rate
- Call completion rate
- Audio quality metrics
- Error rate tracking

## Future Architecture Improvements

1. **State Persistence**: Implement proper session storage
2. **Call Recording**: Add server-side or P2P recording
3. **Conference Support**: Multi-party calls
4. **Presence Status**: Show availability indicators
5. **Message Service**: SMS/chat alongside calling
6. **Service Worker**: Progressive Web App (PWA) support
7. **Encryption**: E2E encryption for credentials
8. **Analytics**: Anonymous usage metrics
9. **Internationalization**: Multi-language support
10. **Mobile Native**: React Native version

---

This architecture provides a scalable, maintainable foundation for a browser-based SIP softphone.
