# MicroSIP Setup & Configuration Guide

## Initial Setup

### Prerequisites

1. Node.js 16+ (with npm)
2. A SIP server with WebSocket support enabled
3. Valid SIP account credentials
4. Modern web browser with microphone

### Step 1: Install Dependencies

```bash
cd microsip-react-client
npm install
```

This will install:
- react & react-dom (React framework)
- jssip (SIP protocol)
- tailwindcss (CSS framework)
- react-hot-toast (notifications)
- zustand (state management)
- And development tools

### Step 2: Start Development Server

```bash
npm run dev
```

Open browser and navigate to: `http://localhost:5173/`

You should see the MicroSIP interface with three tabs: Dialpad, History, and Settings.

## Configuring Your SIP Server

### Option 1: Asterisk PBX

**Common Setup:**

```
HTTP/HTTPS Server Port: 8000 (for Asterisk web UI)
WebSocket Port: 8089 (for WebRTC)
Protocol: WSS (WebSocket Secure)
SIP Port: 5060
```

**MicroSIP Configuration:**

```
Display Name:        John's Desk Phone
Username/Extension:  1001
Password:            [Your SIP password]
Domain/Realm:        192.168.1.100 (or your Asterisk IP)
Server Host:         192.168.1.100
Server Port:         8089
Transport:           WSS
```

**Asterisk Configuration File (extensions.conf):**

```ini
[1001]
type=peer
host=dynamic
context=from-internal
auth=1001
secret=yourpassword
```

**Asterisk WebRTC Socket Configuration (pjsip.conf):**

```ini
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0:8089
```

### Option 2: FreeSWITCH

**Common Setup:**

```
Event Socket Port: 8021
WebSocket Port: 7443 (WSS) or 7 (WS)
SIP Port: 5060/5061
Protocol: WSS
```

**MicroSIP Configuration:**

```
Display Name:        John's Softphone
Username/Extension:  1001
Password:            [Your password]
Domain/Realm:        freeswitch.example.com
Server Host:         freeswitch.example.com
Server Port:         7443
Transport:           WSS
```

**FreeSWITCH Configuration (vars.xml):**

```xml
<X-PRE-PROCESS cmd="set" data="sip_port=5060"/>
<X-PRE-PROCESS cmd="set" data="sip_ip=0.0.0.0"/>
<X-PRE-PROCESS cmd="set" data="wss_port=7443"/>
<X-PRE-PROCESS cmd="set" data="ws_port=7"/>
```

### Option 3: Kamailio

**Common Setup:**

```
SIP Port: 5060
WebSocket Port: 7 (WS)
WebSocket Secure Port: 5061 (WSS)
```

**MicroSIP Configuration:**

```
Display Name:        User One
Username/Extension:  user1
Password:            user1password
Domain/Realm:        kamailio.local
Server Host:         kamailio.local
Server Port:         5061
Transport:           WSS
```

**Kamailio Configuration (kamailio.cfg):**

```
listen=tcp:0.0.0.0:5060
listen=wss:0.0.0.0:5061
listen=ws:0.0.0.0:7
```

### Option 4: Self-Hosted VoIP (Home Lab)

**Example with local network:**

```
Server Host:         192.168.1.50 (or PC hostname)
Server Port:         8089
Transport:           WS (not WSS for local testing)
Username:            extension
Password:            password
Domain:              192.168.1.50
```

## Network & Firewall Configuration

### Required Ports (Inbound)

| Port | Protocol | Purpose |
|------|----------|---------|
| 8089 | WSS/WS | WebSocket SIP signaling |
| 10000-20000 | UDP/RTP | RTP media (audio) |

### NAT Traversal

If behind NAT, enable STUN on SIP server:

**In MicroSIP**, default STUN server is: `stun:stun.l.google.com:19302`

Other STUN servers:
- `stun:stun1.l.google.com:19302`
- `stun:stun2.l.google.com:19302`
- `stun:stun3.l.google.com:19302`
- `stun:stun4.l.google.com:19302`

### Firewall Rules (Example: iptables)

```bash
# Allow SIP WebSocket
iptables -A INPUT -p tcp --dport 8089 -j ACCEPT

# Allow RTP media range
iptables -A INPUT -p udp --dport 10000:20000 -j ACCEPT

# If using HTTPS
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

## Production Deployment

### Build for Production

```bash
npm run build
```

This creates an optimized build in `dist/` folder.

### Deploy to Server

#### Using Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name sip.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Enable CORS for SIP WebSocket
    location / {
        root /var/www/microsip;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # SIP WebSocket proxy (if SIP server on same host)
    location /ws {
        proxy_pass ws://localhost:8089;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

#### Using Apache

```apache
<VirtualHost *:443>
    ServerName sip.example.com

    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem

    DocumentRoot /var/www/microsip

    <Directory /var/www/microsip>
        RewriteEngine On
        RewriteBase /
        RewriteRule ^index\.html$ - [L]
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule . /index.html [L]
    </Directory>

    # WebSocket proxy
    ProxyPass /ws ws://localhost:8089
    ProxyPassReverse /ws ws://localhost:8089
</VirtualHost>
```

#### Using Docker

**Dockerfile:**

```dockerfile
FROM node:18-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**docker-compose.yml:**

```yaml
version: '3.8'
services:
  microsip:
    build: .
    ports:
      - "80:80"
      - "443:443"
    environment:
      - SIP_SERVER=asterisk.local
      - SIP_PORT=8089
    volumes:
      - ./ssl:/etc/nginx/ssl
```

## User Configuration

### First-Time Setup

1. Open MicroSIP in browser
2. Go to **Settings** tab
3. Fill in:
   - Display Name (your name)
   - Username (SIP extension)
   - Password (SIP password)
   - Domain (SIP realm - usually same as server)
   - Server Host (IP or domain)
   - Server Port (usually 8089 or 7443)
   - Transport (WSS or WS)
4. Click **"Connect & Register"**
5. Wait for green "Registered" status
6. Settings are saved automatically to browser storage

### Making Your First Call

1. Ensure "Registered" status is green
2. Go to **Dialpad** tab
3. Enter phone number (e.g., 1002)
4. Click green **Call** button
5. Wait for remote phone to ring
6. When answered, you'll see **Active Call** screen with timer

### Handling Incoming Calls

1. Incoming call modal appears (even if in different tab)
2. Shows caller ID and name
3. Click green phone to **Accept**
4. Click red phone to **Reject**
5. Active call screen appears once accepted

### Using Call History

1. Go to **History** tab
2. See all recent calls grouped by date
3. Shows direction (incoming/outgoing) and duration
4. Click green phone icon to **redial** that number
5. Swipe left to remove (future feature)

## Testing with Demo Users

### Local Testing (Same PBX)

Create multiple extensions on your PBX:

```
Extension 1001 - Username: ext1001 / Password: pass1
Extension 1002 - Username: ext1002 / Password: pass2
Extension 1003 - Username: ext1003 / Password: pass3
```

Register one browser tab with 1001, another with 1002, and test calling between them.

### Testing Checklist

- [ ] Browser granting microphone permission
- [ ] WebSocket connection established
- [ ] SIP registration successful (green status)
- [ ] Can make outgoing call
- [ ] Audio transmits and receives
- [ ] Can mute/unmute
- [ ] Can hold/unhold
- [ ] Call duration timer works
- [ ] Can end call
- [ ] Can receive incoming call
- [ ] Call appears in history

## User Settings (Advanced)

### Storage

Settings are stored in browser's localStorage under key: `microsip-storage`

To clear all settings:
```javascript
localStorage.removeItem('microsip-storage');
location.reload();
```

### Configuration Object

Internal configuration stored:

```javascript
{
  settings: {
    uri: "sip:1001@192.168.1.100",
    username: "1001",
    domain: "192.168.1.100",
    password: "password",
    display_name: "John Doe",
    ws_servers_host: "192.168.1.100",
    ws_servers_port: "8089",
    transport: "wss",
    register: true,
    session_timers: false,
    use_preloaded_route: false
  },
  registrationStatus: "Registered",
  connectionStatus: "Connected",
  callHistory: [...]
}
```

## Troubleshooting Guide

### "Microphone permission denied"

**Solution:**
1. Check browser notification for permission prompt
2. Allow microphone access
3. Refresh page
4. Check browser settings: Settings > Privacy > Microphone

### "WebSocket connection failed"

**Causes & Solutions:**
1. **Wrong port**: Verify correct WSS port (usually 8089 or 7443)
2. **Server not running**: Check SIP server is running
3. **WebSocket not enabled**: Enable WebSocket on SIP server
4. **Firewall blocking**: Check firewall rules
5. **SSL certificate**: For WSS, certificate must be valid

**Test WebSocket connectivity:**

```bash
# Using wscat (install: npm install -g wscat)
wscat -c wss://your-server:8089/ws

# Or from browser console:
ws = new WebSocket('wss://your-server:8089/ws');
ws.onopen = () => console.log('Connected!');
ws.onerror = (e) => console.error('Error:', e);
```

### "Registration failed - 403 Forbidden"

**Causes:**
- Wrong credentials
- Extension doesn't exist
- Extension is disabled
- Password incorrect

**Solution:**
- Double-check username and password
- Verify extension exists on SIP server
- Use SIP client (like Linphone) to test credentials
- Check PBX admin panel

### "No audio during call"

**Checklist:**
1. Microphone working (test in system settings)
2. Remote party's speaker on
3. Volume not muted
4. WebRTC connection established (check browser dev tools)
5. Firewall allowing RTP (ports 10000-20000 UDP)

**Debug:**
```javascript
// In browser console during call
await navigator.mediaDevices.getUserMedia({audio: true})
// Check if microphone is recorded
```

### "Random disconnections"

**Solutions:**
1. Enable "Session Timers" in Settings
2. Check network stability
3. Use STUN server
4. Increase registration expiry on server
5. Check for intermediate proxies/firewalls

### "One-way audio (hear but not heard)"

**Causes:**
- NAT/firewall not configured
- STUN server not working
- RTP port blocking

**Solutions:**
1. Enable STUN on SIP server
2. Forward RTP ports (10000-20000) in router
3. Try different STUN server
4. Check NAT type in browser console

## Performance Optimization

### For High Network Latency

1. Use WSS instead of WS
2. Enable STUN
3. Reduce audio bitrate on server
4. Use lower sample rate codec (PCMU)

### For Low Bandwidth

1. Use PCMU codec (8 kHz)
2. Disable fancy WebRTC features
3. Monitor connection quality

### Browser Console Debugging

```javascript
// Enable SIP trace in code (modify useSIP.js)
trace_sip: true

// Monitor WebRTC stats in DevTools
// Network tab > WebRTC
// Check RTCStats

// Check audio context
const ctx = new AudioContext();
console.log('Sample rate:', ctx.sampleRate);
console.log('Latency:', ctx.baseLatency);
```

## Getting Help

1. **Check browser Console** (F12 > Console tab) for errors
2. **Enable SIP trace** for detailed protocol logs
3. **Test with known-working client** (Linphone, Jami)
4. **Check SIP server logs** for rejection reasons
5. **Post issue** with console errors and server config

---

**Happy Voice Calling!** 🎤📞
