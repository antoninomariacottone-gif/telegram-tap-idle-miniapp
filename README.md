# Telegram Tap/Idle Mini App (TON-ready)

Monorepo con:
- `apps/web`: Telegram Mini App (Vite + React + TS)
- `apps/api`: Cloudflare Worker API + D1 (SQLite) “server-authoritative”

## Requisiti
- Node.js 20+
- Un Bot Telegram (hai già il bot) e il relativo `BOT_TOKEN`
- Un account Cloudflare (free tier va bene)

## Setup rapido (dev locale)
1) Installa dipendenze:
   - `npm install`

2) API (Worker) — configura secrets (Cloudflare):
   - `cd apps/api`
   - `npx wrangler secret put BOT_TOKEN`
   - `npx wrangler secret put JWT_SECRET`

3) D1 (una volta sola) — crea DB e applica migrazioni:
   - `npx wrangler d1 create tap_idle_db`
   - Copia `database_id` in `apps/api/wrangler.toml`
   - `npx wrangler d1 migrations apply tap_idle_db --local`

4) Avvia tutto:
   - dalla root: `npm run dev`

5) Telegram BotFather:
   - Imposta WebApp domain (HTTPS) puntando al tuo deploy Pages (in dev puoi usare browser).

Apri `apps/web` in Telegram (o browser) e usa l’URL `wrangler dev` come API base.

## Deploy (costo ~0)
- Frontend: Cloudflare Pages (build Vite)
- API: Cloudflare Workers (wrangler deploy)
- DB: D1

### TON Connect
- Aggiorna `apps/web/public/tonconnect-manifest.json` (`url` e `iconUrl`) quando hai il dominio definitivo.

## Nota sicurezza
Questo progetto è “economicamente resistente” (server-authoritative + ledger + idempotency + shadow-ban), ma **non esiste 100% sicurezza** se c’è valore economico: serve monitoraggio e tuning continuo.
