import type { Env } from "./env";
import { DEFAULT_GAME_CONFIG, recomputeEnergy } from "./game";
import { corsHeaders, errorJson, json, readJson } from "./http";
import { signJwtHS256, verifyJwtHS256 } from "./jwt";
import { verifyTelegramInitData } from "./telegram";
import { ensureUserAndState, getGameState, getIdempotency, putIdempotency, setShadowBanned } from "./db";
import { sha256Hex } from "./crypto";

type Authed = { userId: number; banned: boolean; shadowBanned: boolean };

function getOrigin(req: Request) {
  return req.headers.get("origin");
}

function withCors(req: Request, env: Env, res: Response): Response {
  const headers = new Headers(res.headers);
  const cors = corsHeaders(env.ALLOWED_ORIGIN ?? "*", getOrigin(req));
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

async function requireAuth(req: Request, env: Env): Promise<Authed | Response> {
  const token = getBearer(req);
  if (!token) return errorJson(401, "unauthorized", "Missing bearer token");
  const claims = await verifyJwtHS256(env.JWT_SECRET, token);
  if (!claims) return errorJson(401, "unauthorized", "Invalid/expired token");
  const userId = Number(claims.sub);
  if (!Number.isFinite(userId)) return errorJson(401, "unauthorized", "Invalid token subject");
  const row = await env.DB.prepare(`SELECT banned, shadow_banned FROM users WHERE tg_id=?1`).bind(userId).first<{ banned: number; shadow_banned: number }>();
  if (!row) return errorJson(401, "unauthorized", "Unknown user");
  return { userId, banned: row.banned === 1, shadowBanned: row.shadow_banned === 1 };
}

function normalizeInt(n: unknown, fallback: number): number {
  if (typeof n !== "number") return fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function requestIdFromIdemKey(idemKey: string): string {
  // Keep request_id stable even if client uses long keys.
  return idemKey.length > 80 ? idemKey.slice(0, 80) : idemKey;
}

async function handleAuthTelegram(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ initData?: string }>(req);
  const initData = body?.initData ?? "";
  const verified = await verifyTelegramInitData(initData, env.BOT_TOKEN);
  if (!verified) return errorJson(401, "bad_init_data", "Invalid Telegram initData");

  const nowMs = Date.now();
  const userRow = await ensureUserAndState(env, nowMs, verified.user);

  if (userRow.banned === 1) return errorJson(403, "banned", "User is banned");

  const nowSec = Math.floor(nowMs / 1000);
  const claims = {
    sub: String(verified.user.id),
    iat: nowSec,
    exp: nowSec + 60 * 60,
    jti: crypto.randomUUID(),
  };
  const token = await signJwtHS256(env.JWT_SECRET, claims);
  return json({
    ok: true,
    token,
    user: {
      tgId: verified.user.id,
      username: verified.user.username ?? null,
      shadowBanned: userRow.shadow_banned === 1,
    },
  });
}

async function handleGameState(req: Request, env: Env, authed: Authed): Promise<Response> {
  if (authed.banned) return errorJson(403, "banned", "User is banned");
  const row = await getGameState(env, authed.userId);
  if (!row) return errorJson(404, "not_found", "Game state not found");
  const nowMs = Date.now();
  const energy = recomputeEnergy(nowMs, row, DEFAULT_GAME_CONFIG.regenMs);
  // Lazy-update energy timestamp to keep regen deterministic and reduce write load.
  if (energy.energyUpdatedAt !== row.energy_updated_at || energy.energy !== row.energy) {
    await env.DB.prepare(`UPDATE game_state SET energy=?1, energy_updated_at=?2, updated_at=?3 WHERE user_id=?4`)
      .bind(energy.energy, energy.energyUpdatedAt, nowMs, authed.userId)
      .run();
  }
  return json({
    ok: true,
    state: {
      coins: row.coins,
      level: row.level,
      energy: energy.energy,
      maxEnergy: row.max_energy,
      tapPower: row.tap_power,
    },
    flags: {
      shadowBanned: authed.shadowBanned,
    },
  });
}

async function handleTap(req: Request, env: Env, authed: Authed): Promise<Response> {
  if (authed.banned) return errorJson(403, "banned", "User is banned");
  const idemKey = req.headers.get("idempotency-key");
  if (!idemKey) return errorJson(400, "missing_idempotency", "Missing Idempotency-Key header");

  const existing = await getIdempotency(env, authed.userId, "tap", idemKey);
  if (existing) return json(JSON.parse(existing.response_json));

  const nowMs = Date.now();
  const body = await readJson<{ taps?: number; tz?: string }>(req);
  const requested = normalizeInt(body?.taps, 1);
  const tapsRequested = Math.max(1, Math.min(DEFAULT_GAME_CONFIG.maxTapBatch, requested));

  const row = await getGameState(env, authed.userId);
  if (!row) return errorJson(404, "not_found", "Game state not found");

  const energy = recomputeEnergy(nowMs, row, DEFAULT_GAME_CONFIG.regenMs);
  const sinceLastTap = nowMs - row.last_tap_at;
  const cooldownOk = sinceLastTap >= DEFAULT_GAME_CONFIG.minTapIntervalMs;
  const availableTaps = Math.min(tapsRequested, energy.energy);
  const allowedTaps = cooldownOk ? availableTaps : Math.min(1, availableTaps);

  // Simple sliding window anti-spam (server-side).
  const windowStart = row.tap_window_start === 0 || nowMs - row.tap_window_start > 60_000 ? nowMs : row.tap_window_start;
  const windowCount = row.tap_window_start === 0 || nowMs - row.tap_window_start > 60_000 ? 0 : row.tap_window_count;
  const nextWindowCount = windowCount + allowedTaps;

  let nextShadow = authed.shadowBanned;
  if (!nextShadow && nextWindowCount > DEFAULT_GAME_CONFIG.shadowBanTapPerMinute) {
    nextShadow = true;
    await setShadowBanned(env, authed.userId, nowMs, "tap_rate", {
      windowMs: 60_000,
      taps: nextWindowCount,
    });
  }

  if (allowedTaps <= 0) {
    const resp = {
      ok: true,
      applied: { taps: 0, coinsDelta: 0, energyDelta: 0 },
      state: {
        coins: row.coins,
        energy: energy.energy,
        maxEnergy: row.max_energy,
        tapPower: row.tap_power,
      },
      flags: { shadowBanned: nextShadow },
    };
    await putIdempotency(env, authed.userId, "tap", idemKey, resp, nowMs);
    return json(resp);
  }

  const coinsDelta = allowedTaps * row.tap_power;
  const nextCoins = row.coins + coinsDelta;
  const nextEnergy = energy.energy - allowedTaps;
  const requestId = requestIdFromIdemKey(idemKey);

  const ip = req.headers.get("cf-connecting-ip") ?? "";
  const ua = req.headers.get("user-agent") ?? "";
  const ipHash = ip ? await sha256Hex(ip) : null;
  const uaHash = ua ? await sha256Hex(ua) : null;

  // Best-effort transaction (D1 supports BEGIN/COMMIT).
  await env.DB.prepare("BEGIN").run();
  try {
    await env.DB.prepare(
      `UPDATE game_state SET
        coins=?1,
        energy=?2,
        energy_updated_at=?3,
        last_tap_at=?4,
        tap_window_start=?5,
        tap_window_count=?6,
        updated_at=?7
       WHERE user_id=?8`,
    )
      .bind(nextCoins, nextEnergy, energy.energyUpdatedAt, nowMs, windowStart, nextWindowCount, nowMs, authed.userId)
      .run();

    await env.DB.prepare(
      `INSERT INTO ledger (user_id, delta_coins, delta_energy, reason, request_id, created_at, ip_hash, ua_hash)
       VALUES (?1, ?2, ?3, 'tap', ?4, ?5, ?6, ?7)`,
    )
      .bind(authed.userId, coinsDelta, -allowedTaps, requestId, nowMs, ipHash, uaHash)
      .run();

    await env.DB.prepare("COMMIT").run();
  } catch (e) {
    await env.DB.prepare("ROLLBACK").run();
    throw e;
  }

  const resp = {
    ok: true,
    applied: { taps: allowedTaps, coinsDelta, energyDelta: -allowedTaps },
    state: {
      coins: nextCoins,
      energy: nextEnergy,
      maxEnergy: row.max_energy,
      tapPower: row.tap_power,
    },
    flags: { shadowBanned: nextShadow, cooldownOk },
  };
  await putIdempotency(env, authed.userId, "tap", idemKey, resp, nowMs);
  return json(resp);
}

async function handleUpgrade(req: Request, env: Env, authed: Authed): Promise<Response> {
  if (authed.banned) return errorJson(403, "banned", "User is banned");
  const idemKey = req.headers.get("idempotency-key");
  if (!idemKey) return errorJson(400, "missing_idempotency", "Missing Idempotency-Key header");
  const existing = await getIdempotency(env, authed.userId, "upgrade", idemKey);
  if (existing) return json(JSON.parse(existing.response_json));

  const nowMs = Date.now();
  const body = await readJson<{ upgradeId?: string }>(req);
  const upgradeId = body?.upgradeId ?? "";
  if (!upgradeId) return errorJson(400, "bad_request", "Missing upgradeId");

  const row = await getGameState(env, authed.userId);
  if (!row) return errorJson(404, "not_found", "Game state not found");

  // Two MVP upgrades.
  const upgrades = {
    tap_power: { cost: 50 * row.tap_power, apply: () => ({ tap_power: row.tap_power + 1 }) },
    max_energy: { cost: 100 * Math.floor(row.max_energy / 10), apply: () => ({ max_energy: row.max_energy + 10 }) },
  } as const;

  const upgrade = (upgrades as Record<string, { cost: number; apply: () => Record<string, number> }>)[upgradeId];
  if (!upgrade) return errorJson(400, "bad_request", "Unknown upgradeId");
  if (row.coins < upgrade.cost) return errorJson(400, "insufficient_coins", "Not enough coins");

  const patch = upgrade.apply();
  const nextCoins = row.coins - upgrade.cost;
  await env.DB.prepare("BEGIN").run();
  try {
    const cols = Object.keys(patch);
    const setSql = cols.map((c, i) => `${c}=?${i + 1}`).join(", ");
    const values = cols.map((c) => patch[c] as number);
    await env.DB.prepare(`UPDATE game_state SET coins=?${values.length + 1}, ${setSql}, updated_at=?${values.length + 2} WHERE user_id=?${values.length + 3}`)
      .bind(...values, nextCoins, nowMs, authed.userId)
      .run();
    await env.DB.prepare(
      `INSERT INTO ledger (user_id, delta_coins, delta_energy, reason, request_id, created_at)
       VALUES (?1, ?2, 0, ?3, ?4, ?5)`,
    )
      .bind(authed.userId, -upgrade.cost, `upgrade:${upgradeId}`, requestIdFromIdemKey(idemKey), nowMs)
      .run();
    await env.DB.prepare("COMMIT").run();
  } catch (e) {
    await env.DB.prepare("ROLLBACK").run();
    throw e;
  }

  const next = await getGameState(env, authed.userId);
  const resp = {
    ok: true,
    applied: { upgradeId, cost: upgrade.cost },
    state: {
      coins: next?.coins ?? nextCoins,
      energy: next?.energy ?? row.energy,
      maxEnergy: next?.max_energy ?? row.max_energy,
      tapPower: next?.tap_power ?? row.tap_power,
    },
  };
  await putIdempotency(env, authed.userId, "upgrade", idemKey, resp, nowMs);
  return json(resp);
}

async function handleLeaderboard(_req: Request, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT u.tg_id as tgId, u.username as username, g.coins as coins
     FROM users u
     JOIN game_state g ON g.user_id = u.tg_id
     WHERE u.banned=0
     ORDER BY g.coins DESC
     LIMIT 50`,
  ).all<{ tgId: number; username: string | null; coins: number }>();

  return json({ ok: true, rows: rows.results ?? [] });
}

async function handleWalletLink(req: Request, env: Env, authed: Authed): Promise<Response> {
  if (authed.banned) return errorJson(403, "banned", "User is banned");
  const body = await readJson<{ tonAddress?: string; proof?: unknown }>(req);
  const tonAddress = (body?.tonAddress ?? "").trim();
  if (!tonAddress) return errorJson(400, "bad_request", "Missing tonAddress");
  const nowMs = Date.now();
  await env.DB.prepare(
    `INSERT INTO wallets (user_id, ton_address, linked_at, proof_json)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id) DO UPDATE SET ton_address=excluded.ton_address, linked_at=excluded.linked_at, proof_json=excluded.proof_json`,
  )
    .bind(authed.userId, tonAddress, nowMs, body?.proof ? JSON.stringify(body.proof) : null)
    .run();
  return json({ ok: true, linked: true, tonAddress });
}

async function handleRewardsEligibility(_req: Request, env: Env, authed: Authed): Promise<Response> {
  if (authed.banned) return errorJson(403, "banned", "User is banned");
  if (authed.shadowBanned) return json({ ok: true, status: "INELIGIBLE", reason: "shadow_banned" });
  const active = await env.DB.prepare(
    `SELECT id, starts_at, ends_at, budget_nano, status FROM reward_periods
     WHERE status='ACTIVE' AND budget_nano > 0
     ORDER BY ends_at DESC LIMIT 1`,
  ).first<{ id: number; starts_at: number; ends_at: number; budget_nano: number; status: string }>();
  if (!active) return json({ ok: true, status: "PAUSED", reason: "no_funded_period" });
  return json({ ok: true, status: "ELIGIBLE", periodId: active.id, maxClaimNano: 0 });
}

async function handleRewardsClaim(_req: Request, _env: Env, _authed: Authed): Promise<Response> {
  // Intentionally paused until a funded reward_period is created & admin flow is implemented.
  return json({ ok: true, status: "PAUSED", reason: "payouts_not_enabled" });
}

async function handleMissions(_req: Request, _env: Env, _authed: Authed): Promise<Response> {
  // Placeholder for daily/weekly missions (kept server-authoritative).
  return json({
    ok: true,
    missions: [],
  });
}

async function handleMissionClaim(_req: Request, _env: Env, _authed: Authed): Promise<Response> {
  return errorJson(400, "not_implemented", "Missions not enabled yet");
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204 });
  if (method === "GET" && path === "/health") return json({ ok: true });
  if (method === "POST" && path === "/auth/telegram") return await handleAuthTelegram(req, env);
  if (method === "GET" && path === "/leaderboard") return await handleLeaderboard(req, env);

  const authed = await requireAuth(req, env);
  if (authed instanceof Response) return authed;

  if (method === "GET" && path === "/game/state") return await handleGameState(req, env, authed);
  if (method === "POST" && path === "/game/tap") return await handleTap(req, env, authed);
  if (method === "POST" && path === "/game/upgrade") return await handleUpgrade(req, env, authed);
  if (method === "POST" && path === "/wallet/link") return await handleWalletLink(req, env, authed);
  if (method === "GET" && path === "/rewards/eligibility") return await handleRewardsEligibility(req, env, authed);
  if (method === "POST" && path === "/rewards/claim") return await handleRewardsClaim(req, env, authed);
  if (method === "GET" && path === "/missions") return await handleMissions(req, env, authed);
  if (method === "POST" && path === "/missions/claim") return await handleMissionClaim(req, env, authed);

  return errorJson(404, "not_found", "Route not found");
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const res = await route(req, env);
      return withCors(req, env, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return withCors(req, env, errorJson(500, "internal", msg));
    }
  },
};
