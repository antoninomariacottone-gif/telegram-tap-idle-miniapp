import type { Env } from "./env";

export async function ensureUserAndState(env: Env, nowMs: number, user: { id: number; username?: string; first_name?: string; last_name?: string }) {
  await env.DB.prepare(
    `INSERT INTO users (tg_id, username, first_name, last_name, created_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(tg_id) DO UPDATE SET
       username=excluded.username,
       first_name=excluded.first_name,
       last_name=excluded.last_name,
       last_seen_at=excluded.last_seen_at`,
  )
    .bind(user.id, user.username ?? null, user.first_name ?? null, user.last_name ?? null, nowMs)
    .run();

  await env.DB.prepare(
    `INSERT INTO game_state (user_id, energy_updated_at, updated_at)
     VALUES (?1, ?2, ?2)
     ON CONFLICT(user_id) DO NOTHING`,
  )
    .bind(user.id, nowMs)
    .run();

  const userRow = await env.DB.prepare(`SELECT tg_id, banned, shadow_banned FROM users WHERE tg_id=?1`).bind(user.id).first<{
    tg_id: number;
    banned: number;
    shadow_banned: number;
  }>();
  return userRow ?? { tg_id: user.id, banned: 0, shadow_banned: 0 };
}

export async function getGameState(env: Env, userId: number) {
  return await env.DB.prepare(
    `SELECT coins, level, energy, max_energy, tap_power, energy_updated_at, last_tap_at, tap_window_start, tap_window_count
     FROM game_state WHERE user_id=?1`,
  )
    .bind(userId)
    .first<{
      coins: number;
      level: number;
      energy: number;
      max_energy: number;
      tap_power: number;
      energy_updated_at: number;
      last_tap_at: number;
      tap_window_start: number;
      tap_window_count: number;
    }>();
}

export async function setShadowBanned(env: Env, userId: number, nowMs: number, kind: string, metadata: unknown) {
  await env.DB.prepare(`UPDATE users SET shadow_banned=1 WHERE tg_id=?1`).bind(userId).run();
  await env.DB.prepare(`INSERT INTO abuse_events (user_id, kind, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(userId, kind, JSON.stringify(metadata), nowMs)
    .run();
}

export async function getIdempotency(env: Env, userId: number, endpoint: string, idemKey: string) {
  return await env.DB.prepare(`SELECT response_json FROM idempotency WHERE user_id=?1 AND endpoint=?2 AND idem_key=?3`)
    .bind(userId, endpoint, idemKey)
    .first<{ response_json: string }>();
}

export async function putIdempotency(env: Env, userId: number, endpoint: string, idemKey: string, response: unknown, nowMs: number) {
  await env.DB.prepare(
    `INSERT INTO idempotency (user_id, endpoint, idem_key, response_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(userId, endpoint, idemKey, JSON.stringify(response), nowMs)
    .run();
}

