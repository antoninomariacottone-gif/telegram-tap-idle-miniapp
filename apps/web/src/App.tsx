import { useEffect, useMemo, useState } from "react";
import { TonConnectButton, TonConnectUIProvider, useTonAddress } from "@tonconnect/ui-react";

type GameState = {
  coins: number;
  level: number;
  energy: number;
  maxEnergy: number;
  tapPower: number;
};

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: { code: string; message: string } };
type LeaderRow = { tgId: number; username: string | null; coins: number };

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        HapticFeedback?: { impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void };
      };
    };
  }
}

function apiBase() {
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8787";
}

function tonManifestUrl() {
  return (import.meta.env.VITE_TONCONNECT_MANIFEST_URL as string | undefined) ?? `${location.origin}/tonconnect-manifest.json`;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  return (await res.json()) as T;
}

function AppInner() {
  const [token, setToken] = useState<string | null>(() => {
    const t = localStorage.getItem("token");
    return t && t.length > 10 ? t : null;
  });
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[] | null>(null);

  const tonAddress = useTonAddress();
  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    tg?.ready?.();
    tg?.expand?.();
  }, [tg]);

  useEffect(() => {
    if (token) localStorage.setItem("token", token);
    else localStorage.removeItem("token");
  }, [token]);

  async function login() {
    setError(null);
    setLoading(true);
    try {
      const initData = tg?.initData ?? "";
      const out = await apiFetch<ApiOk<{ token: string }> | ApiErr>("/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ initData }),
      });
      if (!out.ok) throw new Error(out.error.message);
      setToken(out.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function refreshState(activeToken: string) {
    const out = await apiFetch<ApiOk<{ state: GameState }> | ApiErr>("/game/state", { method: "GET", token: activeToken });
    if (!out.ok) throw new Error(out.error.message);
    setState(out.state);
  }

  useEffect(() => {
    if (!token) return;
    refreshState(token).catch((e) => setError(e instanceof Error ? e.message : "Failed to load state"));
    const id = setInterval(() => refreshState(token).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, [token]);

  async function tap() {
    if (!token) return;
    setError(null);
    try {
      tg?.HapticFeedback?.impactOccurred?.("light");
      const out = await apiFetch<ApiOk<{ state: GameState }> | ApiErr>("/game/tap", {
        method: "POST",
        token,
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({ taps: 1 }),
      });
      if (!out.ok) throw new Error(out.error.message);
      setState(out.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tap failed");
    }
  }

  async function buyTapPower() {
    if (!token) return;
    setError(null);
    try {
      const out = await apiFetch<ApiOk<{ state: GameState }> | ApiErr>("/game/upgrade", {
        method: "POST",
        token,
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({ upgradeId: "tap_power" }),
      });
      if (!out.ok) throw new Error(out.error.message);
      setState(out.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upgrade failed");
    }
  }

  async function linkWallet() {
    if (!token) return;
    if (!tonAddress) {
      setError("Connetti prima il wallet TON");
      return;
    }
    setError(null);
    try {
      const out = await apiFetch<ApiOk<{ linked: boolean }> | ApiErr>("/wallet/link", {
        method: "POST",
        token,
        body: JSON.stringify({ tonAddress }),
      });
      if (!out.ok) throw new Error(out.error.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet link failed");
    }
  }

  async function loadLeaderboard() {
    setError(null);
    try {
      const out = await apiFetch<ApiOk<{ rows: LeaderRow[] }> | ApiErr>("/leaderboard", { method: "GET" });
      if (!out.ok) throw new Error(out.error.message);
      setLeaderboard(out.rows.slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Leaderboard failed");
    }
  }

  return (
    <div className="container">
      <header className="header">
        <div className="title">Tap/Idle</div>
        <TonConnectButton />
      </header>

      {!token && (
        <div className="card">
          <div className="subtitle">Accesso</div>
          <p className="muted">Apri la Mini App dentro Telegram per usare `initData` reale.</p>
          <button className="btn primary" disabled={loading} onClick={login}>
            Connetti Telegram
          </button>
        </div>
      )}

      {token && !state && (
        <div className="card">
          <div className="subtitle">Caricamento…</div>
        </div>
      )}

      {token && state && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="statLabel">Coins</div>
              <div className="statValue">{state.coins}</div>
            </div>
            <div className="stat">
              <div className="statLabel">Energy</div>
              <div className="statValue">
                {state.energy}/{state.maxEnergy}
              </div>
            </div>
            <div className="stat">
              <div className="statLabel">Tap</div>
              <div className="statValue">x{state.tapPower}</div>
            </div>
          </div>

          <div className="actions">
            <button className="btn primary big" onClick={tap} disabled={state.energy <= 0}>
              TAP
            </button>
            <button className="btn" onClick={buyTapPower}>
              Upgrade tap
            </button>
            <button className="btn" onClick={linkWallet} disabled={!tonAddress}>
              Link wallet
            </button>
            <button className="btn" onClick={loadLeaderboard}>
              Leaderboard
            </button>
          </div>

          {leaderboard && (
            <div className="card">
              <div className="subtitle">Top 10</div>
              <ol className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                {leaderboard.map((r) => (
                  <li key={r.tgId}>
                    {r.username ?? `user:${r.tgId}`} — {r.coins}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {error && <div className="error">{error}</div>}

      <footer className="footer">
        <div className="muted">API: {apiBase()}</div>
      </footer>
    </div>
  );
}

export default function App() {
  const manifest = useMemo(() => tonManifestUrl(), []);
  return (
    <TonConnectUIProvider manifestUrl={manifest}>
      <AppInner />
    </TonConnectUIProvider>
  );
}
