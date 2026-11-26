import {
  createHash,
  randomInt,
  timingSafeEqual as nodeTimingSafeEqual,
} from "node:crypto";
import type { Env } from "./types.ts";

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();
const aesKeyCache = new Map<string, Promise<CryptoKey>>();

export const SESSION_TTL = 30 * 24 * 3600;
export const FRAME_TTL = 2 * 3600;

const HTTPS_COOKIE = "__Host-art_session";
const HTTP_COOKIE = "art_session";

export type TokenKind = "session" | "frame";

interface TokenPayload {
  k: TokenKind;
  exp: number;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    keyCache.set(secret, key);
  }
  return key;
}

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromB64url(str: string): Uint8Array<ArrayBuffer> {
  const pad =
    str.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((str.length + 3) % 4);
  const buf = Buffer.from(pad, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  return nodeTimingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}

export function getSessionSecret(env: Env): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.UPLOAD_TOKEN) {
    return createHash("sha256")
      .update(`session:${env.UPLOAD_TOKEN}`)
      .digest("hex");
  }
  throw new Error("SESSION_SECRET is not configured");
}

export async function signToken(
  secret: string,
  kind: TokenKind,
  ttlSeconds: number,
  data: Record<string, unknown>,
): Promise<string> {
  const payload = {
    ...data,
    k: kind,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)),
  );
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken<T extends Record<string, unknown>>(
  secret: string,
  kind: TokenKind,
  token: string | null | undefined,
): Promise<(T & TokenPayload) | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(sig),
      enc.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as TokenPayload).k !== kind ||
    typeof (payload as TokenPayload).exp !== "number" ||
    (payload as TokenPayload).exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return payload as T & TokenPayload;
}

export function cookieNameFor(request: Request): string {
  const url = new URL(request.url);
  return url.protocol === "https:" ? HTTPS_COOKIE : HTTP_COOKIE;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function buildSessionCookie(
  request: Request,
  token: string,
  ttl = SESSION_TTL,
): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  const name = secure ? HTTPS_COOKIE : HTTP_COOKIE;
  return `${name}=${token}; Path=/;${secure ? " Secure;" : ""} HttpOnly; SameSite=Lax; Max-Age=${ttl}`;
}

export function buildClearSessionCookie(request: Request): string {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  const name = secure ? HTTPS_COOKIE : HTTP_COOKIE;
  return `${name}=; Path=/;${secure ? " Secure;" : ""} HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function readSession(
  request: Request,
  env: Env,
): Promise<{ email: string } | null> {
  const name = cookieNameFor(request);
  const raw = readCookie(request, name);
  if (!raw) return null;
  const payload = await verifyToken<{ email?: unknown }>(
    getSessionSecret(env),
    "session",
    raw,
  );
  if (!payload || typeof payload.email !== "string") return null;
  return { email: payload.email };
}

export function isBearerAuthorized(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ") || !env.UPLOAD_TOKEN) return false;
  return timingSafeStringEqual(auth.slice(7), env.UPLOAD_TOKEN);
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export function ownerEmails(env: Env): string[] {
  const raw = env.OWNER_EMAIL || "";
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function primaryOwnerEmail(env: Env): string {
  return ownerEmails(env)[0] || "owner@artifacts.mclean.sh";
}

export function isOwnerEmail(email: string | null | undefined, env: Env): boolean {
  if (!email) return false;
  return ownerEmails(env).includes(email.toLowerCase());
}

export function verifySameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin) return origin === url.origin;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === url.origin;
    } catch {
      return false;
    }
  }
  return true;
}

function aesKey(secret: string): Promise<CryptoKey> {
  let key = aesKeyCache.get(secret);
  if (!key) {
    const raw = createHash("sha256")
      .update(`frame-aes:${secret}`)
      .digest();
    key = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    aesKeyCache.set(secret, key);
  }
  return key;
}

export async function encryptFrameToken(
  secret: string,
  ttlSeconds: number,
  data: { token: string; email: string | null },
): Promise<string> {
  const payload = {
    ...data,
    k: "frame" as const,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(secret),
      enc.encode(JSON.stringify(payload)),
    ),
  );
  return `${b64url(iv)}.${b64url(cipher)}`;
}

export async function decryptFrameToken(
  secret: string,
  token: string | null | undefined,
): Promise<{ token: string; email: string | null; exp: number } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [ivStr, cipherStr] = parts;
  if (!ivStr || !cipherStr) return null;
  let plain: ArrayBuffer;
  try {
    const iv = fromB64url(ivStr);
    if (iv.byteLength !== 12) return null;
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await aesKey(secret),
      fromB64url(cipherStr),
    );
  } catch {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    k?: unknown;
    token?: unknown;
    email?: unknown;
    exp?: unknown;
  };
  if (
    p.k !== "frame" ||
    typeof p.token !== "string" ||
    (p.email !== null && typeof p.email !== "string") ||
    typeof p.exp !== "number" ||
    p.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return { token: p.token, email: p.email, exp: p.exp };
}

export function hashClientIp(request: Request, secret: string): string | null {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    null;
  if (!ip) return null;
  return createHash("sha256").update(`ip:${secret}:${ip}`).digest("hex");
}

export function generateOtpCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

export function hashOtpCode(
  secret: string,
  email: string,
  code: string,
): string {
  return createHash("sha256")
    .update(`otp:${secret}:${email.toLowerCase()}:${code}`)
    .digest("hex");
}
