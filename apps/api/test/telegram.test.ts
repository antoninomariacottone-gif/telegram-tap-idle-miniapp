import { describe, expect, it } from "vitest";
import { verifyTelegramInitData } from "../src/telegram";
import { hmacSha256Hex, sha256Hex } from "../src/crypto";

describe("verifyTelegramInitData", () => {
  it("accepts valid initData", async () => {
    const botToken = "123:ABC";
    const user = encodeURIComponent(JSON.stringify({ id: 42, username: "alice", first_name: "Alice" }));
    const authDate = "1710000000";

    const params = new URLSearchParams();
    params.set("auth_date", authDate);
    params.set("query_id", "AAEAA");
    params.set("user", decodeURIComponent(user));

    const pairs: string[] = [];
    for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
    pairs.sort();
    const dataCheckString = pairs.join("\n");

    const secretKeyHex = await sha256Hex(botToken);
    const secretKeyBytes = hexToBytes(secretKeyHex).buffer;
    const hash = await hmacSha256Hex(secretKeyBytes, dataCheckString);

    const initData = `${params.toString()}&hash=${hash}`;
    const verified = await verifyTelegramInitData(initData, botToken);
    expect(verified?.user.id).toBe(42);
    expect(verified?.user.username).toBe("alice");
  });
});

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

