# NosanaScope

> An ElizaOS agent that monitors, manages, and heals your Nosana GPU deployments — deployed on the very infrastructure it watches.

NosanaScope gives Nosana builders a conversational interface to their GPU infrastructure. Ask for status, investigate anomalies, and execute fixes from the same workflow. All inference runs through the Nosana-hosted Qwen3.5-27B endpoint. No AWS. No Datadog. No centralized dependency.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Plugin Reference](#plugin-reference)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Nosana Deployment](#nosana-deployment)
- [Running Tests](#running-tests)

---

## What It Does

NosanaScope combines observability and operations in a single conversational agent:

- **Live job monitoring** — active, failed, and queued job counts injected into every agent turn automatically
- **Natural-language ops** — restart, cancel, or spawn jobs by asking in plain English, with confirmation before any destructive action
- **Proactive Telegram alerts** — the agent fires alerts when failure patterns emerge or credits run low, without being asked
- **Credit intelligence** — current balance, burn rate, and runway estimate always available
- **Node health** — inspect which Nosana nodes are serving requests and their current load
- **Metrics history** — PostgreSQL-backed snapshots power the dashboard charts and allow historical queries
- **Alert preference learning** — tell the agent your thresholds once; it remembers them across restarts via ElizaOS memory

---

## Architecture

```mermaid
flowchart TD
    subgraph NOSANA["Nosana Network"]
        AGENT["NosanaScope Agent\n(ElizaOS Runtime)"]
        QWEN["Qwen3.5-27B Inference\n(Nosana-hosted endpoint)"]
        JOBS["Other Nosana GPU Jobs\n(monitored)"]
        DB[("PostgreSQL\nMetrics Store")]
    end

    PLUGIN["plugin-nosana-ops\n7 Actions · Provider · 2 Evaluators"]
    DASH["Next.js Dashboard\n(port 3000)"]
    TG["Telegram Bot\n(proactive alerts)"]

    QWEN -->|"LLM inference"| AGENT
    AGENT <-->|"Actions + Provider"| PLUGIN
    PLUGIN -->|"nosana-kit SDK"| JOBS
    AGENT -->|"30s snapshots"| DB
    DB -->|"metrics history"| DASH
    AGENT <-->|"chat proxy"| DASH
    AGENT -->|"failure alerts"| TG
```

### Data flow

1. Background poller runs every 30 seconds — calls Nosana SDK and writes a snapshot to PostgreSQL
2. User sends a message via dashboard chat or Telegram
3. ElizaOS fires `nosanaContextProvider` before every LLM call, injecting live job state into the prompt
4. Qwen3.5 (on Nosana) generates a response and selects an action if needed
5. ElizaOS executes the matched action (e.g. `restartJob`)
6. `alertPreferenceEvaluator` post-processes the turn and stores any new preferences to memory
7. `failurePatternEvaluator` runs on a 5-minute tick and fires a Telegram alert if thresholds are crossed
8. Dashboard polls `/api/metrics` every 10 seconds and re-renders panels

---

## Plugin Reference

The core of NosanaScope is a custom ElizaOS plugin: `@nosanascope/plugin-nosana-ops`. It wraps `@nosana/sdk` directly and registers all actions, the provider, and both evaluators with the ElizaOS runtime.

### Actions

| Action | Trigger phrase examples | What it does |
|---|---|---|
| `getJobs` | "show my jobs", "what's running" | Returns all jobs with state, GPU model, duration, and estimated cost |
| `getCredits` | "what's my balance", "how many $NOS do I have" | Returns current staked credit balance with low-credit warning |
| `getMetrics` | "give me metrics", "infrastructure summary" | Aggregates active/failed/queued counts, utilization, and daily spend |
| `getNodeHealth` | "node status", "which nodes are serving" | Lists active Nosana nodes, load, GPU model, and latency |
| `restartJob` | "restart job X", "resubmit the failed job" | Cancels then re-submits a job by ID. Asks for confirmation first. |
| `cancelJob` | "cancel job X", "stop that job" | Graceful shutdown. Verifies job is running before acting. |
| `spawnJob` | "run the inference template", "start a new job" | Launches a stored job template by name from environment config |

All write actions (restart, cancel, spawn) include an explicit confirmation step — the agent will not execute destructive operations on the first message.

### Provider

**`nosanaContextProvider`** — runs before every model call and injects a live state snapshot into the LLM prompt:

```
[LIVE NOSANA STATE — 2026-04-11T14:23:01Z]
Active Jobs: 3
Failed Jobs: 1
Queued Jobs: 0
Credit Balance: 47.3 $NOS
Burn Rate: ~3.1 $NOS/hr
```

Results are cached for 30 seconds to avoid hammering the Nosana API on every streaming token.

### Evaluators

**`alertPreferenceEvaluator`** — fires after each agent turn. If the user expresses an alert preference ("notify me when any job fails", "alert me if credits drop below 20 $NOS"), it uses the LLM to extract a structured preference and stores it in ElizaOS memory. On subsequent turns, the provider reads those preferences and shapes the context accordingly.

**`failurePatternEvaluator`** — runs on a 5-minute background tick. Reads job history from PostgreSQL and compares against live state. Fires a proactive Telegram alert if:
- 3 or more jobs fail within a 30-minute window
- Credit balance drops below 10% of starting balance
- GPU utilization exceeds 95% for more than 10 consecutive minutes

---

## Quick Start

### Prerequisites

- Node.js 23+
- pnpm
- Docker Desktop (for local PostgreSQL)
- A Nosana wallet with builder credits ([claim here](https://nosana.com/builders-credits))
- A Telegram bot token ([create via BotFather](https://t.me/BotFather))

### 1. Clone and install

```bash
git clone https://github.com/hicksonhaziel/nosanascope
cd nosanascope
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then fill in your values — see [Environment Variables](#environment-variables) below.

### 3. Start local services

```bash
# Start PostgreSQL
docker compose up -d db

# Start the ElizaOS agent (port 3001)
pnpm run dev:agent

# Start the Next.js dashboard (port 3000)
pnpm run dev:dashboard
```

### 4. Open the dashboard

Visit [http://localhost:3000](http://localhost:3000). The dashboard will show live job state from your Nosana wallet within 30 seconds of the poller starting.

### 5. Connect Telegram

Start a chat with your bot on Telegram and send any message. The agent will respond using the same character and plugin as the web dashboard.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in every value before running.

| Variable | Required | Description |
|---|---|---|
| `NOSANA_RPC_URL` | ✅ | Solana RPC endpoint — use `https://api.mainnet-beta.solana.com` or a private RPC |
| `NOSANA_WALLET_PRIVATE_KEY` | ✅ | Base58-encoded private key of your Nosana-funded wallet |
| `MODEL_ENDPOINT` | ✅ | Nosana-hosted Qwen3.5 inference URL (provided in builder credits email) |
| `MODEL_NAME` | ✅ | `qwen3.5-27b-awq-4bit` |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token from BotFather — required for Telegram client and proactive alerts |
| `TELEGRAM_CHAT_ID` | ✅ | Your personal chat ID — alerts are sent here. Get it from `@userinfobot` |
| `DATABASE_URL` | ✅ | PostgreSQL connection string e.g. `postgresql://agent:password@localhost:5432/nosanascope` |
| `SPAWN_TEMPLATE_JOB_DEF` | Optional | Path to a JSON job definition file used by `spawnJob` action |
| `ALERT_RESTART_RATE_LIMIT` | Optional | Max restartJob calls per minute. Defaults to `3`. |
| `LOG_LEVEL` | Optional | `debug` for verbose output, `info` for normal. Defaults to `info`. |

> **Never commit your `.env` file.** It is listed in `.gitignore`. Use `.env.example` with placeholder values for documentation.

---

## Nosana Deployment

NosanaScope deploys as a two-container Nosana job: the ElizaOS agent and a PostgreSQL instance.

### 1. Build and push Docker images

```bash
# Agent image
docker build -t your-dockerhub-username/nosanascope-agent:latest ./agent
docker push your-dockerhub-username/nosanascope-agent:latest

# Dashboard image
docker build -t your-dockerhub-username/nosanascope-dashboard:latest ./dashboard
docker push your-dockerhub-username/nosanascope-dashboard:latest
```

### 2. Install Nosana CLI

```bash
npm install -g @nosana/cli
nosana --version
```

### 3. Configure secrets

In the Nosana Dashboard, create secrets for:
- `wallet_key` — your wallet private key
- `telegram_token` — your Telegram bot token
- `db_password` — PostgreSQL password

Reference these in `nosana_job_def.json` via `secretRef` fields (already configured in the provided file).

### 4. Submit the job

```bash
nosana job submit --file nosana_job_def.json --market nvidia-3090 --timeout 60
```

The CLI will return a job ID and a public URL. That URL is your live deployment.

### 5. Smoke test

1. Open the live URL in a browser — the dashboard should load and show job state within 60 seconds
2. Send a message in the chat panel — the agent should respond
3. Send a message to your Telegram bot — it should also respond
4. Check the Nosana Dashboard to confirm both containers are healthy

---

## Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage report
pnpm test:coverage

# Run in watch mode during development
pnpm test:watch

# CI mode (exits 0 on pass, 1 on fail)
pnpm test:ci
```

Test coverage targets: **80%+ across actions, provider, and evaluators.**

All Nosana SDK calls are mocked in tests — no live API calls are made. The mock client is located at `__tests__/__mocks__/@nosana/sdk.ts` and is auto-applied by Jest.

---

## Acknowledgements

Built for the [Nosana x ElizaOS Builders Challenge](https://earn.superteam.fun/listing/nosana-builders-elizaos-challenge).

- [ElizaOS](https://elizaos.ai) — agent framework
- [Nosana](https://nosana.com) — decentralized GPU network
- [nosana-kit](https://github.com/nosana-ci/nosana-programs) — Nosana SDK
- [Superteam Earn](https://earn.superteam.fun) — bounty platform