import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "./crypto";

export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  raw: string;
}

// Telegram WebApp initData verification:
// - initData is query-string-like key=value&...
// - hash param is hex of HMAC-SHA256(secret_key, data_check_string)
// - secret_key = SHA256(bot_token)
// - data_check_string: all params except hash, sorted by key, joined as "k=v" with "\n"
export async function verifyTelegramInitData(initData: string, botToken: string): Promise<VerifiedInitData | null> {
  if (!initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.join("\n");

  const secretKeyHex = await sha256Hex(botToken);
  const secretKeyBytes = hexToBytes(secretKeyHex).buffer;
  const expectedHex = await hmacSha256Hex(secretKeyBytes, dataCheckString);
  if (!timingSafeEqualHex(expectedHex, hash)) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    return null;
  }
  if (!user?.id || typeof user.id !== "number") return null;
  return { user, raw: initData };
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

