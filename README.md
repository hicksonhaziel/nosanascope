# NosanaScope

NosanaScope is an ElizaOS agent that monitors, manages, and heals Nosana GPU deployments, with a real-time `/dashboard` UI and Telegram alerts. It continuously tracks deployment health, active jobs, credit balance, and estimated burn rate, then exposes that data through actions and provider context. It can also execute operational commands in plain English, including listing jobs, checking node health, restarting deployments, and spawning new deployments from a template.

## What It Does (3 Sentences)
NosanaScope gives you a natural-language control plane for your Nosana infrastructure. It combines live Nosana API reads, proactive evaluators, and a polling service that persists metrics for trend analysis and dashboard visualization. The same agent can both answer observability questions and execute guarded operational actions like restart, cancel, and spawn with confirmation workflows.

## Architecture Diagram

### Mermaid
```mermaid
flowchart LR
    User[User via Web or Telegram] --> Dash[Next.js Dashboard /dashboard]
    User --> Tg[Telegram Bot]
    Dash --> DashAPI[/dashboard/api/chat + /dashboard/api/metrics]
    DashAPI --> Agent[ElizaOS Runtime + NosanaScope Plugin]
    Tg --> Agent

    Agent --> A1[Actions]
    Agent --> P1[Provider: NOSANA_LIVE_STATE]
    Agent --> E1[Evaluators]
    Agent --> S1[Service: MetricsPoller]

    A1 --> Nosana[Nosana API via @nosana/kit]
    P1 --> Nosana
    E1 --> Nosana
    E1 --> TgAlert[Telegram Alert API]

    S1 --> Nosana
    S1 --> PG[(PostgreSQL metrics DB)]
    DashAPI --> AgentAPI[/api/metrics + messaging/]
    AgentAPI --> PG
```

### ASCII
```text
Browser (/dashboard) --> Next.js route handlers --> Eliza agent runtime
                                             |          |
                                             |          +--> nosanaContextProvider (live snapshot)
                                             |          +--> actions (jobs/credits/metrics/restart/spawn)
                                             |          +--> evaluators (alert preferences + failure detector)
                                             |
                                             +--> /api/metrics (runtime route) <-- MetricsPollerService <-- Nosana API
                                                                                     |
                                                                                     +--> PostgreSQL history

Telegram <--> Eliza runtime
Evaluator alerts --> Telegram Bot API
```

## Quick Start

### 1. Prerequisites
- Node.js 20+
- npm 10+
- Docker (for local PostgreSQL)
- At least one model provider key for Eliza runtime (for example `ELIZAOS_API_KEY`)
- Nosana API key

### 2. Install Dependencies
```bash
npm install
cd dashboard && npm install && cd ..
```

### 3. Configure Environment
```bash
cp .env.example .env
```
Update `.env` with real values, especially:
- `ELIZAOS_API_KEY`
- `NOSANA_API_KEY`
- `NOSANA_JOB_TEMPLATE` (valid JSON)
- `NOSANA_METRICS_POSTGRES_URL`
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (optional but recommended)

Create dashboard env file:
```bash
cat > dashboard/.env.local <<'ENV'
AGENT_API_BASE_URL=http://localhost:3000
ELIZA_SERVER_AUTH_TOKEN=
ELIZA_AGENT_ID=
ENV
```

### 4. Start Local PostgreSQL
```bash
docker compose up -d postgres
```

### 5. Run Agent + Dashboard
Terminal A (agent):
```bash
npm run dev
```

Terminal B (dashboard, port 3001 to avoid conflict):
```bash
cd dashboard
npm run dev -- --port 3001
```
Open `http://localhost:3001`.

## Plugin Reference

### Actions
| Action | Purpose | Typical Prompt | Safety/Notes |
|---|---|---|---|
| `GET_JOBS` | List deployments and status counts | “show my jobs” | Read-only |
| `GET_CREDITS` | Show assigned/reserved/settled/available credits | “what is my balance?” | Read-only |
| `GET_ALERT_SETTINGS` | Show saved alert preference from memory/log/cache | “what are my alert settings?” | Read-only |
| `GET_LIVE_STATE` | Return concise live state block | “live state right now” | De-duplicates if reply already contains live state |
| `GET_METRICS` | Detailed infra metrics (uptime, burn rate, utilization proxy) | “give me detailed metrics” | Read-only |
| `CANCEL_JOB` | Stop deployment with explicit confirmation | “cancel job <name>” then “yes cancel <name>” | Confirmation required |
| `RESTART_JOB` | Restart/start deployment with pending confirmation store | “restart job <name>” then “YES/NO” | Rate-limited (max 3/min per scope) |
| `SPAWN_JOB` | Create deployment from `NOSANA_JOB_TEMPLATE` and auto-start from draft/stopped | “spawn job” then “yes spawn” | Confirmation required + template validation |
| `GET_NODE_HEALTH` | Inspect serving nodes/jobs and endpoint online/offline signal | “check node health” | Read-only |

### Provider
| Provider | Purpose |
|---|---|
| `NOSANA_LIVE_STATE` | Injects cached live snapshot (jobs, failures, queue, credits, burn rate) before model response |

### Evaluators
| Evaluator | Purpose |
|---|---|
| `ALERT_PREFERENCE_EVALUATOR` | Extracts alert preferences from conversation and persists them |
| `FAILURE_PATTERN_EVALUATOR` | Runs every turn + 5-minute ticker for failure burst/low-credit detection and proactive alerts |

## JSDoc Coverage
Every action, provider, and evaluator export has a JSDoc block including `@param`, `@returns`, and `@example`.

- Actions: `src/plugins/nosana-ops/actions/*.ts`
- Provider: `src/plugins/nosana-ops/providers/nosanaContext.ts`
- Evaluators: `src/plugins/nosana-ops/evaluators/*.ts`

## Environment Variables

| Variable | Required | Example | Used By | Notes |
|---|---|---|---|---|
| `ELIZAOS_API_KEY` | Yes* | `eliza_...` | Agent runtime | Needed unless using another configured model provider |
| `PGLITE_DATA_DIR` | No | `.eliza/.elizadb` | Core runtime | Local DB path |
| `LOG_LEVEL` | No | `info` | Core runtime | Runtime logging level |
| `NOSANA_API_KEY` | Yes | `nos_...` | Actions/provider/evaluators/poller | Required for Nosana API access |
| `NOSANA_JOB_TEMPLATE` | Yes | JSON object string | `SPAWN_JOB`, startup validator | Must include `name`, `market`, `strategy`, `replicas`, `timeout`, `job_definition` |
| `NOSANA_METRICS_POSTGRES_URL` | Recommended | `postgresql://agent:...` | Metrics poller + `/api/metrics` | Defaults to local compose DB pattern |
| `POSTGRES_URL` | Optional | `postgresql://...` | Base Eliza runtime | Depends on runtime setup |
| `NOSANA_DEBUG_EVALUATORS` | No | `false` | Evaluators | Enables verbose evaluator logs |
| `TELEGRAM_BOT_TOKEN` | Optional | `<bot-token>` | Telegram alerts | Must be paired with `TELEGRAM_CHAT_ID` |
| `TELEGRAM_CHAT_ID` | Optional | `<chat-id>` | Telegram alerts | Must be paired with `TELEGRAM_BOT_TOKEN` |
| `AGENT_API_BASE_URL` | Yes (dashboard) | `http://localhost:3000` | `/dashboard` API routes | Proxy target for metrics/chat |
| `ELIZA_SERVER_AUTH_TOKEN` | Optional | `<token>` | `/dashboard` chat proxy | Sent as `X-API-KEY` |
| `ELIZA_AGENT_ID` | Optional | UUID | `/dashboard` chat proxy | If absent, dashboard picks active agent |

## `/dashboard` Guide
The dashboard is in `dashboard/` and includes:
- Job Status panel from latest persisted snapshot jobs
- GPU panel (utilization, VRAM proxy, temperature estimate)
- Credit burn chart over time
- Chat panel using proxy route to Eliza messaging API

See `dashboard/README.md` for dashboard-specific setup.

## Nosana Deployment Guide

### 1. Build and push the agent image
```bash
docker build -t <dockerhub-user>/nosanascope-agent:latest .
docker push <dockerhub-user>/nosanascope-agent:latest
```

### 2. Prepare runtime secrets on Nosana
Set secrets/vars in your Nosana deployment for:
- `NOSANA_API_KEY`
- `ELIZAOS_API_KEY` (or your active model-provider key)
- `NOSANA_JOB_TEMPLATE`
- `NOSANA_METRICS_POSTGRES_URL`
- optional Telegram vars

### 3. Example Nosana job definition
```json
{
  "version": "1",
  "type": "container",
  "meta": { "trigger": "api" },
  "ops": [
    {
      "op": "container/run",
      "id": "nosanascope-agent",
      "args": {
        "image": "<dockerhub-user>/nosanascope-agent:latest",
        "gpu": true,
        "expose": 3000,
        "cmd": ["node", "dist/src/index.js"],
        "env": [
          { "name": "NOSANA_API_KEY", "value": "$NOSANA_API_KEY" },
          { "name": "ELIZAOS_API_KEY", "value": "$ELIZAOS_API_KEY" },
          { "name": "NOSANA_JOB_TEMPLATE", "value": "$NOSANA_JOB_TEMPLATE" },
          { "name": "NOSANA_METRICS_POSTGRES_URL", "value": "$NOSANA_METRICS_POSTGRES_URL" },
          { "name": "TELEGRAM_BOT_TOKEN", "value": "$TELEGRAM_BOT_TOKEN" },
          { "name": "TELEGRAM_CHAT_ID", "value": "$TELEGRAM_CHAT_ID" }
        ]
      }
    }
  ]
}
```

### 4. Deploy and record your live URL
After launch, copy your public deployment URL and update:
- README “Project Description” section below
- social post links

### 5. Optional dashboard deployment
Deploy `dashboard/` separately (for example on Vercel), set:
- `AGENT_API_BASE_URL` to your live Eliza agent URL
- `ELIZA_SERVER_AUTH_TOKEN` if your Eliza server requires auth

## 300-Word Project Description (Submission Copy)
NosanaScope is an ElizaOS agent built to monitor, operate, and protect Nosana GPU deployments in production. Instead of separating observability from operations, it combines both in one conversational interface, so you can ask for status, investigate anomalies, and execute fixes from the same workflow. The result is an infrastructure assistant that stays useful during normal traffic and during incidents.

The custom plugin, `@nosanascope/plugin-nosana-ops`, integrates directly with `@nosana/kit` and exposes practical actions for daily operations: list deployments, check credits, return live state, inspect node health, compute detailed metrics, restart safely, cancel safely, and spawn from a validated template. A provider injects a fresh state snapshot into every model turn, including active jobs, failed jobs, queue estimate, available credits, and burn-rate estimate. Two evaluators extend behavior after each interaction: one learns alert preferences from natural language, and the other detects failure bursts or low-credit risk and can push proactive Telegram alerts.

Beyond chat, NosanaScope runs a metrics poller service that captures snapshots on a fixed interval, persists them to PostgreSQL, and exposes a metrics history route for downstream clients. The `/dashboard` Next.js app consumes that history to render job panels, GPU/VRAM/temperature proxies, and burn-rate charts, then routes chat messages back to the live agent through server-side proxy endpoints.

Operational safeguards are built in: explicit confirmation flows for destructive actions, restart rate limiting, strict environment validation, and test coverage for actions, provider behavior, evaluators, and configuration validation.

The project is intentionally Nosana-native: it monitors Nosana workloads, reasons over Nosana cost signals, and is designed to run as a Nosana-deployed service. That alignment matters for builders who want fewer centralized dependencies and clearer operational ownership. Judges and teams can reproduce the full stack locally, then ship the same workflow to a live decentralized environment without middleware layers.

GitHub: https://github.com/hicksonhaziel/nosanascope
Live Nosana deployment URL: <PASTE_YOUR_LIVE_NOSANA_URL_HERE>

Word count: 300

## Social Post (Submission Day)
Use this post template and attach **real screenshots from `/dashboard`** (header metrics + chart + chat panel):

```text
Just shipped NosanaScope for the @Nosana_AI x @elizaOS builders challenge.

NosanaScope is an ElizaOS agent that monitors and manages Nosana GPU deployments, with a live dashboard and proactive Telegram alerts.

✅ Real-time deployment/job state
✅ Credit burn + runway visibility
✅ Natural-language restart/cancel/spawn workflows
✅ Node health and failure-pattern detection
✅ Alert preference learning from conversation

GitHub: https://github.com/hicksonhaziel/nosanascope
Live: <PASTE_YOUR_LIVE_NOSANA_URL_HERE>

#Nosana #ElizaOS #Solana #BuildOnNosana #OpenClaw
```

Suggested screenshots to attach:
1. `/dashboard` top section showing Active / Failed / Credits pills
2. Credit burn chart with recent trend
3. Chat panel with a real “restart job” exchange

## Final Repo Check

| Check | Status | Notes |
|---|---|---|
| Public fork/repo | ⚠️ Manual verify | Confirm GitHub visibility is public |
| No API keys in tracked code | ✅ Verified locally | Secret-pattern scan found no hardcoded keys |
| `.env.example` complete | ✅ Verified | Includes Nosana, template, Telegram, and evaluator vars |
| Starred 4 Nosana repos | ⚠️ Manual verify | `agent-challenge`, `nosana-programs`, `nosana-kit`, `nosana-cli` |
| README renders on GitHub | ✅ Expected | Standard Markdown sections/tables/code blocks |

## Testing
```bash
npm run test:unit
```

For dashboard build validation:
```bash
cd dashboard
npm run build
```
