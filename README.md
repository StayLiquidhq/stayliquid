# StayLiquid Backend API

StayLiquid is a Next.js backend for automated savings plans, CDP-managed wallets, on-chain balances, and payout orchestration across Solana and Base.

The app is backend-heavy. `app/page.tsx` is only a placeholder health page; the product surface is the API under `app/api/**/route.ts`.

## Architecture

```text
Client / Mobile App / Cron / Webhooks
        |
        v
Next.js Route Handlers
        |
        |-- CORS
        |-- Supabase Auth JWT checks
        |-- Zod validation
        |-- Idempotency wrapper for money flows
        |
        v
Supabase Postgres
        |
        |-- users
        |-- plans
        |-- wallets
        |-- transactions
        |-- processed_transactions
        |-- idempotency_keys
        |-- audit_logs
        |
        v
External money infrastructure
        |
        |-- Coinbase CDP wallets/signing
        |-- Base ERC-20 transfers
        |-- Solana SPL transfers
        |-- CDP deposit webhooks
```

Core principle: balances are not trusted from the database. Wallet balances are queried live from Base/Solana before display or payout. Supabase stores metadata, immutable ledger rows, audit rows, and idempotency state.

## Stack

| Layer | Implementation |
| --- | --- |
| Framework | Next.js App Router |
| Runtime | Node.js route handlers |
| Auth | Supabase Auth |
| Database | Supabase Postgres |
| Wallets/signing | Coinbase CDP |
| Chains | Solana, Base |
| Tokens | USDC, USDT |
| Validation | Zod |
| Lint | Oxlint |
| Tests | `tsx --test` |

Docs used by maintainers:

- Next.js LLM docs index: <https://nextjs.org/docs/llms.txt>
- Supabase LLM docs index: <https://supabase.com/llms.txt>
- Supabase Cron docs: <https://supabase.com/docs/guides/cron>

## Important Files

| File | Purpose |
| --- | --- |
| `utils/supabase.ts` | Server-side Supabase service-role client |
| `lib/supabase/serverClient.ts` | Supabase SSR client for auth callback cookies |
| `utils/cdp.ts` | Coinbase CDP client |
| `lib/CreateWallet.ts` | Creates CDP wallets for plans |
| `lib/cdp_balance.ts` | Reads Base/Solana balances |
| `lib/cdp_transfers.ts` | Executes Base/Solana transfers |
| `lib/solana.ts` | Solana RPC, SPL balances, SPL transfers |
| `lib/idempotency.ts` | Stripe-style idempotency behavior |
| `lib/audit.ts` | Non-blocking audit logging |
| `lib/geoip.ts` | Local MaxMind GeoIP lookup |
| `lib/cors.ts` | Origin allowlist CORS helpers |
| `lib/tokens.ts` | Supported chain/token config |
| `lib/selects.ts` | Explicit DB projections |
| `lib/supabase/types.ts` | Supabase generated/manual DB types |

## Environment Variables

Required for normal API operation:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SECRET_KEY=

CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=

CORS_ALLOWED_ORIGINS=https://your-frontend.example

PAYOUT_AUTH_TOKEN=
CDP_WEBHOOK_SECRET=

FEES_PAYER_WALLET=
SOLANA_PLATFORM_FEES_WALLET=
BASE_PLATFORM_FEES_WALLET=
```

Optional or chain-specific:

```bash
SOLANA_RPC_URL=
USDC_MINT=
USDT_MINT=
```

Do not expose `SUPABASE_SECRET_KEY`, CDP secrets, webhook secrets, payout tokens, fee payer wallets, or platform fee wallets to a browser/client.

`SOLANA_RPC_URL` is optional because the app falls back to Solana mainnet RPC, but Solana RPC usage still exists. Coinbase CDP signs and sends transactions, while this app still uses Solana RPC to read SPL token accounts, create ATA instructions, and confirm transactions. CoinGecko is not used; stablecoin display values are derived directly from on-chain USDC/USDT balances.

## Local Development

```bash
npm install
npm run dev
```

Verification:

```bash
npx tsc --noEmit
npm run lint
npm test
```

Health check:

```bash
curl http://localhost:3000/api/health
```

## API Overview

User-authenticated routes expect a Supabase access token:

```http
Authorization: Bearer <supabase_access_token>
```

Service routes use static server-to-server tokens.

| Route | Purpose | Auth |
| --- | --- | --- |
| `POST /api/user/create` | Create/sync app user profile | Supabase JWT or callback body |
| `GET /api/plans/fetch` | Fetch user's plans and wallets | Supabase JWT |
| `POST /api/plans/create` | Create plan + CDP wallet | Supabase JWT + idempotency |
| `POST /api/plans/update` | Update plan metadata | Supabase JWT |
| `GET /api/plans/status` | Check if user has a plan | Supabase JWT |
| `POST /api/plans/break` | Early exit plan, pay user and fee | Supabase JWT + idempotency |
| `POST /api/plans/payout` | Execute recurring payout | `PAYOUT_AUTH_TOKEN` + idempotency |
| `POST /api/plans/payout-target` | Execute target-plan payout | `PAYOUT_AUTH_TOKEN` + idempotency |
| `POST /api/plans/fiat-payout-webhook` | Settle fiat payout with treasury transfer | `PAYOUT_AUTH_TOKEN` + idempotency |
| `GET /api/wallets/fetch` | Fetch live on-chain wallet balances | Supabase JWT |
| `POST /api/wallets/wallet-sweeper` | Query one live on-chain balance | Supabase JWT |
| `POST /api/wallets/update-balance` | Deposit webhook processor | `CDP_WEBHOOK_SECRET` |
| `GET /api/wallets/fetch-all` | Internal wallet address list | `x-custom-auth: PAYOUT_AUTH_TOKEN` |
| `POST /api/transactions/fetch` | Fetch wallet ledger history | Supabase JWT |
| `GET /api/health` | Database + Solana RPC health | Public |

## Main Flows

### User Signup/Login

```text
Supabase OAuth callback
  -> app/auth/callback/route.ts
  -> Supabase exchanges auth code for session
  -> /api/user/create creates or syncs public.users
  -> audit log queued with after()
  -> redirect to onboarding or dashboard
```

### Plan Creation

```text
Client -> POST /api/plans/create
  -> CORS + Supabase JWT
  -> validate plan body
  -> enforce max 4 plans
  -> claim idempotency key
  -> create CDP wallet
  -> RPC create_plan_and_wallet()
       - insert plan
       - set users.has_created_plan = true
       - insert wallet
  -> audit log
```

CDP wallet creation is external and cannot be rolled back by Postgres. The database phase after wallet creation is atomic.

### Deposit Webhook

```text
CDP webhook -> POST /api/wallets/update-balance
  -> verify webhook secret
  -> parse one or many events
  -> insert tx hash/signature into processed_transactions
  -> find wallet by address
  -> write credit row to transactions
  -> optionally check target-plan progress from live chain balance
```

The webhook logs deposits; it does not mutate wallet balances.

### Recurring Payout

```text
Scheduler -> POST /api/plans/payout
  -> verify PAYOUT_AUTH_TOKEN
  -> load plan + wallet
  -> derive key payout:<plan_id>:<slot>
  -> claim idempotency key
  -> read live on-chain balance
  -> execute CDP transfer to user's payout wallet
  -> RPC record_recurring_payout()
       - claim tx hash/signature
       - update last/next payout dates
       - insert debit ledger row
```

### Target Payout

```text
Scheduler -> POST /api/plans/payout-target
  -> verify PAYOUT_AUTH_TOKEN
  -> load active target plan + wallet
  -> claim idempotency key payout-target:<plan_id>
  -> read full live on-chain balance
  -> execute CDP transfer to user's payout wallet
  -> RPC record_target_payout()
       - claim tx hash/signature
       - mark plan completed
       - insert debit ledger row
```

### Plan Break

```text
Client -> POST /api/plans/break
  -> verify Supabase JWT
  -> verify user owns plan
  -> claim idempotency key
  -> read live on-chain balance
  -> execute split payout: 95% user, 5% treasury
  -> RPC record_plan_break()
       - claim payout tx
       - claim fee tx
       - mark plan broken
       - insert ledger rows
```

### Fiat Payout Settlement

```text
Fiat service -> POST /api/plans/fiat-payout-webhook
  -> verify PAYOUT_AUTH_TOKEN
  -> claim idempotency key fiat-payout:<fiat_transaction_id>
  -> transfer settlement tokens from user CDP wallet to treasury
  -> RPC record_fiat_payout()
       - insert debit ledger row
       - update plan status or payout schedule
```

## Idempotency

Money routes use `lib/idempotency.ts` and the `idempotency_keys` table.

Behavior:

| Case | Result |
| --- | --- |
| First request | Claims key and runs handler |
| Duplicate while first request is running | `409 Request is already being processed` |
| Same key + same payload after completion | Replays stored response |
| Same key + different payload | `409` |
| Handler returns `4xx` | Releases key so the client can retry after fixing input |
| Handler returns `5xx` | Stores/replays response to avoid repeating possible external side effects |

Replay responses include:

```http
Idempotent-Replayed: true
```

## Cron Jobs

There are two separate scheduling concerns.

### 1. Database cron: idempotency cleanup

This is already handled inside Supabase Postgres with `pg_cron`.

Supabase Cron uses the `pg_cron` extension. Jobs are stored in `cron.job`; run history is stored in `cron.job_run_details`. A migration enabled a job named `idempotency-reaper`:

```sql
select public.reap_idempotency_keys();
```

Schedule:

```cron
*/15 * * * *
```

Meaning: every 15 minutes, Postgres deletes expired idempotency rows. This job does not call the Next.js app and has zero network dependency.

Useful checks in Supabase SQL editor:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'idempotency-reaper';
```

```sql
select *
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname = 'idempotency-reaper'
)
order by start_time desc
limit 20;
```

### 2. Payout cron: trigger payout endpoints

The payout scheduler is not implemented as code in this repo. The app exposes secure service endpoints that a scheduler must call:

| Job | Endpoint | When to call |
| --- | --- | --- |
| Recurring payout | `POST /api/plans/payout` | When an active recurring plan's `next_payout_date <= now()` |
| Target payout | `POST /api/plans/payout-target` | When an active target plan is ready to pay out |

Recurring payout request:

```bash
curl -X POST "https://your-api.example/api/plans/payout" \
  -H "Authorization: Bearer $PAYOUT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan_id":"<plan_uuid>"}'
```

Target payout request:

```bash
curl -X POST "https://your-api.example/api/plans/payout-target" \
  -H "Authorization: Bearer $PAYOUT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan_id":"<plan_uuid>"}'
```

Recommended payout scheduler design:

```text
Every minute or every 5 minutes
  -> query active plans due for payout
  -> call /api/plans/payout for each due recurring crypto plan
  -> call /api/plans/payout-target for each target plan that is ready
  -> rely on endpoint idempotency to prevent duplicate sends
```

The endpoints derive deterministic idempotency keys, so a duplicated scheduler run should not double-pay:

- Recurring payout key: `payout:<plan_id>:<next_payout_date_or_date>`
- Target payout key: `payout-target:<plan_id>`

If you want payouts fully inside Supabase scheduling, use Supabase Cron to run SQL that either calls an Edge Function/API over HTTP or invokes a database function that queues payout work. Do not put CDP secrets inside database SQL.

## Realtime Wallet Updates

The app uses Supabase Realtime instead of a custom Next.js WebSocket server.

When any row is inserted into `transactions`, a database trigger inserts a user-scoped row into `wallet_events`. Supabase Realtime broadcasts that row over its managed WebSocket connection. Frontends subscribe to their own events and re-fetch the affected wallet balance from the API.

Database objects:

| Object | Purpose |
| --- | --- |
| `wallet_events` | Per-user realtime event stream |
| `transactions_wallet_event_after_insert` | Trigger after transaction insert |
| `enqueue_wallet_transaction_event()` | Finds wallet owner and writes the event |

Frontend subscription shape:

```ts
const channel = supabase
  .channel("wallet-events")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "wallet_events",
      filter: `user_id=eq.${user.id}`,
    },
    async (payload) => {
      const walletId = payload.new.wallet_id;
      await refreshWalletBalance(walletId);
    }
  )
  .subscribe();
```

RLS only allows authenticated users to select their own `wallet_events`, so connected users receive only their wallet updates.

## Database Atomicity

Local DB writes for money flows use Postgres RPCs so related DB mutations commit or roll back together:

| RPC | Atomic DB phase |
| --- | --- |
| `create_plan_and_wallet` | plan insert + user flag + wallet insert |
| `record_recurring_payout` | tx claim + schedule update + ledger insert |
| `record_target_payout` | tx claim + complete plan + ledger insert |
| `record_plan_break` | tx claims + broken status + ledger rows |
| `record_fiat_payout` | ledger row + status/schedule update |

External transfers cannot be rolled back. The architecture handles this with idempotency, transaction-hash dedupe, and atomic persistence after successful transfer.

## Security Notes

- API routes use the Supabase service role key, so route-level ownership checks are critical.
- Browser clients should only send Supabase access tokens, never service keys.
- Service endpoints must only be called from trusted schedulers/workers.
- Webhook endpoints should be upgraded to provider-native signature/HMAC verification if CDP exposes it for this integration.
- A full recovery-point worker is still not implemented; if a process dies after an external transfer but before DB completion, manual reconciliation or a future completer is required.

## Scripts

```bash
npm run dev      # Next.js dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Oxlint
npm run lint:fix # Oxlint autofix
npm test         # Node test runner via tsx
```
