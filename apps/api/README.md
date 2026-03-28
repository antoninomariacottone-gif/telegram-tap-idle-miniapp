# API (Cloudflare Worker + D1)

## Endpoints
- `POST /auth/telegram` `{ initData }` → JWT
- `GET /game/state` (auth)
- `POST /game/tap` (auth + `Idempotency-Key`)
- `POST /game/upgrade` (auth + `Idempotency-Key`)
- `GET /leaderboard`
- `POST /wallet/link` (auth)
- `GET /rewards/eligibility` (auth)
- `POST /rewards/claim` (auth, attualmente `PAUSED`)

## Dev
- `npm run dev` (porta `8787`)
- Crea/applica migrazioni D1: `wrangler d1 migrations apply tap_idle_db --local`

