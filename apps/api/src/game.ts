export interface GameConfig {
  regenMs: number;
  maxTapBatch: number;
  minTapIntervalMs: number;
  shadowBanTapPerMinute: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  regenMs: 2000,
  maxTapBatch: 10,
  minTapIntervalMs: 250,
  shadowBanTapPerMinute: 300,
};

export interface GameStateRow {
  coins: number;
  level: number;
  energy: number;
  max_energy: number;
  tap_power: number;
  energy_updated_at: number;
  last_tap_at: number;
  tap_window_start: number;
  tap_window_count: number;
}

export interface RecomputedEnergy {
  energy: number;
  energyUpdatedAt: number;
}

export function recomputeEnergy(nowMs: number, state: Pick<GameStateRow, "energy" | "max_energy" | "energy_updated_at">, regenMs: number): RecomputedEnergy {
  const elapsed = Math.max(0, nowMs - state.energy_updated_at);
  const regen = Math.floor(elapsed / regenMs);
  if (regen <= 0) return { energy: state.energy, energyUpdatedAt: state.energy_updated_at };
  const nextEnergy = Math.min(state.max_energy, state.energy + regen);
  // Move the timestamp forward by whole regen ticks unless we hit max.
  const nextUpdatedAt = nextEnergy >= state.max_energy ? nowMs : state.energy_updated_at + regen * regenMs;
  return { energy: nextEnergy, energyUpdatedAt: nextUpdatedAt };
}

