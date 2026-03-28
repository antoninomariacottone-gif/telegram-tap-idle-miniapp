import { describe, expect, it } from "vitest";
import { recomputeEnergy } from "../src/game";

describe("recomputeEnergy", () => {
  it("regenerates energy in whole ticks", () => {
    const now = 10_000;
    const out = recomputeEnergy(
      now,
      { energy: 0, max_energy: 5, energy_updated_at: 0 },
      2000,
    );
    // 10s -> 5 ticks -> capped at 5
    expect(out.energy).toBe(5);
    expect(out.energyUpdatedAt).toBe(now);
  });

  it("moves timestamp forward without hitting max", () => {
    const now = 9_500;
    const out = recomputeEnergy(
      now,
      { energy: 0, max_energy: 10, energy_updated_at: 0 },
      2000,
    );
    // 9.5s -> 4 ticks
    expect(out.energy).toBe(4);
    expect(out.energyUpdatedAt).toBe(8_000);
  });
});

