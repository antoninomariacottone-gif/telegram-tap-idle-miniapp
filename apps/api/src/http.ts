export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorJson(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, { status });
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function corsHeaders(allowedOrigin: string | undefined, requestOrigin: string | null): HeadersInit {
  const origin = allowedOrigin ?? "";
  const allow = origin === "*" ? (requestOrigin ?? "*") : origin;
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,idempotency-key",
    "access-control-allow-credentials": "true",
    "vary": "origin",
  };
}

