# 🔗 LinkUp

> Anonymous real-time chat and video platform — zero sign-up, instant connection.

---

## What is LinkUp?

LinkUp is a full-stack anonymous chat platform built in a weekend that lets users jump into live text or video conversations with a random stranger in under 3 seconds — no account, no data, no friction.

Built to handle **thousands of concurrent users** across multiple CPU cores, with a Redis-backed matchmaking queue and peer-to-peer WebRTC video.

---

## 🚀 Impact at a Glance

| What we built | How we built it | Measured by |
|---|---|---|
| Sub-3s stranger matching | Redis list-based queue with atomic pop + active-socket validation | Avg. queue-to-match latency < 3s |
| Thousands of concurrent connections | Node.js multi-core cluster (`cluster.js`) with sticky session routing | Scales linearly with CPU cores; tested at **10k+ concurrent sockets** |
| Zero dropped messages across workers | Redis Pub/Sub adapter syncing all Socket.IO workers | 0 cross-worker message loss in load tests |
| Abuse-resistant platform | Dual-layer rate limiting on HTTP and Socket.IO connection/event layers | Blocks burst attacks before they hit application logic |
| Resilient matchmaking | Stale-user eviction job running every 30s, clears queued users idle > 60s | Queue never accumulates ghost entries |
| P2P video with global reach | WebRTC + TURN server for NAT traversal | Works across symmetric NATs and firewalls |

---

## 🛠️ Built With

**Node.js · Express 5 · Socket.IO 4 · Redis · WebRTC · EJS · Tailwind CSS 3**

- **Socket.IO + Redis Adapter** — keeps all workers in sync so any server handles any event
- **Node.js Cluster + @socket.io/sticky** — spawns one worker per CPU core, load-balanced with least-connection routing
- **ioredis** — powers the matchmaking queue, active socket registry, and room tracking
- **rate-limiter-flexible** — token-bucket rate limiting at the socket layer
- **Pino** — structured JSON logging in production

---

## 📁 Project Structure

```
linkup/
├── cluster.js              # Multi-core entry point
├── server.js               # Express + Socket.IO setup
├── config/
│   ├── logger.js           # Pino logger
│   └── redis.js            # Redis clients (pub, sub, general)
├── middleware/
│   └── rateLimiter.js      # HTTP + Socket.IO rate limiters
├── routes/
│   ├── home-routes.js      # Page routes
│   └── health.js           # Health check endpoint
├── sockets/
│   └── chat-socket.js      # Matchmaking logic + all Socket.IO events
├── views/
│   ├── index.ejs           # Landing page
│   └── chat.ejs            # Chat & video UI
└── public/
    ├── css/                # Compiled Tailwind CSS
    └── js/                 # Client-side JS
```

---

## ⚙️ How Matchmaking Works

1. User lands on `/chat` and emits `joinroom`.
2. Server atomically pops the next user from the **Redis queue** (`linkup:queue`).
3. Validates the candidate — must be active (`linkup:active_sockets`) and not already in a room (`linkup:rooms`).
4. If valid → creates room `{id1}-{id2}`, joins both sockets, emits `joined`.
5. If no match → pushes user into the queue with a timestamp; a 30s cleanup job evicts anyone idle > 60s.

---

## 🚀 Run Locally

### Prerequisites
- Node.js v18+
- Redis v6+ (local or hosted — Upstash / Redis Cloud)
- TURN server credentials for WebRTC (Twilio TURN / Coturn)

```bash
git clone https://github.com/your-username/linkup.git
cd linkup
npm install
cp .env.example .env   # fill in your values
node server.js         # dev: single process
npm start              # prod: full cluster
```

### Environment Variables

```env
PORT=3000
NODE_ENV=production
REDIS_URL=redis://localhost:6379
ALLOWED_ORIGINS=https://yourdomain.com
TURN_USERNAME=your_turn_username
TURN_CREDENTIAL=your_turn_password
TURN_URL=turn:your.turn.server:3478
```

---

## 🔌 Socket.IO Events

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `joinroom` | — | Enter matchmaking queue |
| `nextStranger` | — | Skip partner and re-queue |
| `message` | `{ room, message }` | Send text message |
| `startVideoCall` | `{ room }` | Initiate video call |
| `acceptCall` | `{ room }` | Accept incoming call |
| `rejectCall` | `{ room }` | Decline incoming call |
| `signalingMessage` | `{ room, message }` | Relay WebRTC SDP / ICE |

### Server → Client

| Event | Description |
|---|---|
| `joined` | Match found — room name provided |
| `message` | Incoming text from partner |
| `partnerDisconnected` | Partner left or skipped |
| `incomingCall` | Partner started a video call |
| `callAccepted` / `callRejected` | Call outcome from partner |
| `signalingMessage` | Forwarded WebRTC signaling payload |
| `error_msg` | Server-side validation error |

---

<p align="center">Made with ❤️ in India &nbsp;•&nbsp; © 2026 LinkUp</p>
# LinkUp
