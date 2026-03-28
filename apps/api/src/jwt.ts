import { base64UrlDecodeToBytes, base64UrlEncode } from "./crypto";

type JsonObject = Record<string, unknown>;

export interface JwtClaims extends JsonObject {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8Bytes(data));
  return new Uint8Array(sig);
}

export async function signJwtHS256(secret: string, claims: JwtClaims): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(utf8Bytes(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(utf8Bytes(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sig = await hmacSign(secret, signingInput);
  const encodedSig = base64UrlEncode(sig);
  return `${signingInput}.${encodedSig}`;
}

export async function verifyJwtHS256(secret: string, token: string): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  // We only support HS256; header check is optional but cheap.
  try {
    const headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encodedHeader)));
    if (headerJson?.alg !== "HS256") return null;
  } catch {
    return null;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = await hmacSign(secret, signingInput);
  const provided = base64UrlDecodeToBytes(encodedSig);
  if (provided.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided[i] ^ expected[i];
  if (diff !== 0) return null;

  let payload: JwtClaims;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encodedPayload)));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.sub !== "string") return null;
  return payload;
}

