# NosanaScope Dashboard

The `/dashboard` app is a Next.js 16 frontend for NosanaScope. It visualizes persisted metrics from the agent (`/api/metrics`) and exposes a chat panel that proxies user messages to the Eliza messaging API.

## What You See
- Header KPIs: active jobs, failed jobs, credit balance
- Job status panel from latest snapshot payload jobs
- GPU metrics panel (utilization/VRAM/temp proxies)
- Credit burn chart over time
- Chat interface wired to live agent sessions

## Local Development

### 1. Install
```bash
cd dashboard
npm install
```

### 2. Configure Environment
Create `dashboard/.env.local`:
```bash
AGENT_API_BASE_URL=http://localhost:3000
ELIZA_SERVER_AUTH_TOKEN=
ELIZA_AGENT_ID=
```

### 3. Run
Use port `3001` when the agent is on `3000`:
```bash
npm run dev -- --port 3001
```
Open `http://localhost:3001`.

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AGENT_API_BASE_URL` | Yes | `http://localhost:3000` | Base URL for upstream Eliza agent API |
| `ELIZA_SERVER_AUTH_TOKEN` | Optional | empty | Sent as `X-API-KEY` to protected Eliza endpoints |
| `ELIZA_AGENT_ID` | Optional | auto-detect active agent | Forces dashboard chat to a specific agent UUID |

## API Routes in Dashboard

### `GET /api/metrics`
- Proxies to `${AGENT_API_BASE_URL}/api/metrics`
- Forwards query string (for example `hours=24`)
- Returns upstream JSON and status

### `POST /api/chat`
- Creates or reuses a messaging session with the Eliza backend
- Sends user message to `/api/messaging/sessions/:id/messages`
- Polls recent session history for final assistant output
- Returns `{ ok, sessionId, agentId, userId, message }`

## Build Check
```bash
npm run build
```

## Troubleshooting
- `Unable to load metrics`: verify agent is running and `AGENT_API_BASE_URL` is correct.
- `No active agent available`: set `ELIZA_AGENT_ID` explicitly or start the agent runtime.
- `401/403 from chat proxy`: set `ELIZA_SERVER_AUTH_TOKEN` to match your Eliza server auth config.
