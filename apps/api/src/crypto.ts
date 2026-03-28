export async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bufferToHex(digest);
}

export async function hmacSha256Hex(keyBytes: ArrayBuffer, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return bufferToHex(sig);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  const b64 = toBase64(bytes);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlDecodeToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((b64url.length + 3) % 4);
  return fromBase64(b64);
}

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str);
  }
  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer as typeof Buffer | undefined;
  if (!B) throw new Error("No base64 encoder available");
  return B.from(bytes).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer as typeof Buffer | undefined;
  if (!B) throw new Error("No base64 decoder available");
  return new Uint8Array(B.from(b64, "base64"));
}
