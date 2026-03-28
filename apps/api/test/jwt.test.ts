import { describe, expect, it } from "vitest";
import { signJwtHS256, verifyJwtHS256 } from "../src/jwt";

describe("jwt", () => {
  it("signs and verifies HS256", async () => {
    const secret = "test_secret";
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwtHS256(secret, {
      sub: "123",
      iat: now,
      exp: now + 60,
      jti: "jti",
    });
    const claims = await verifyJwtHS256(secret, token);
    expect(claims?.sub).toBe("123");
  });

  it("rejects expired token", async () => {
    const secret = "test_secret";
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwtHS256(secret, {
      sub: "123",
      iat: now - 1000,
      exp: now - 10,
      jti: "jti",
    });
    const claims = await verifyJwtHS256(secret, token);
    expect(claims).toBeNull();
  });
});

