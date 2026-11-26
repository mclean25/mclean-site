import {
  FRAME_TTL,
  SESSION_TTL,
  buildClearSessionCookie,
  buildSessionCookie,
  generateOtpCode,
  getSessionSecret,
  hashOtpCode,
  isBearerAuthorized,
  isOwnerEmail,
  normalizeEmail,
  primaryOwnerEmail,
  readSession,
  signToken,
  verifySameOrigin,
  verifyToken,
} from "./auth.ts";
import { sendLoginCode, sendShareInvite } from "./mail.ts";
import type { Store } from "./store.ts";
import type {
  ArtifactBundle,
  ArtifactRecord,
  Env,
  ViewerUser,
} from "./types.ts";
import {
  renderDashboardPage,
  renderLoginPage,
  renderViewerPage,
} from "./ui.ts";

export { Store } from "./store.ts";

const MAX_BODY = 16 * 1024 * 1024;
const MAX_JSON_BODY = 256 * 1024;
const MAX_FILES = 500;
const TOKEN_RE = /^[a-f0-9]{64}$/;

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};

const SHELL_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const ARTIFACT_CSP =
  "sandbox allow-scripts allow-downloads allow-modals allow-forms";

function reply(
  body: BodyInit | null,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { ...BASE_HEADERS, ...extra },
  });
}

function jsonReply(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return reply(JSON.stringify(data), status, {
    "Content-Type": "application/json; charset=utf-8",
    ...extra,
  });
}

function htmlReply(
  html: string,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return reply(html, status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": SHELL_CSP,
    "X-Frame-Options": "DENY",
    ...extra,
  });
}

function hasControlChar(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function validPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 500 &&
    !path.startsWith("/") &&
    !hasControlChar(path) &&
    !/[\\?#]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

async function boundedBody(
  request: Request,
  maxBytes = MAX_BODY,
): Promise<string> {
  if (!request.body) throw new Error("Empty request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Payload exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

async function readJsonBody(
  request: Request,
  maxBytes = MAX_JSON_BODY,
): Promise<Record<string, unknown>> {
  const raw = await boundedBody(request, maxBytes);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

function validateBundle(
  bundle: unknown,
): { fileCount: number; totalBytes: number; bundle: ArtifactBundle } | null {
  if (!bundle || typeof bundle !== "object") return null;
  const candidate = bundle as Partial<ArtifactBundle>;
  if (
    !Array.isArray(candidate.files) ||
    candidate.files.length < 1 ||
    candidate.files.length > MAX_FILES ||
    !validPath(candidate.entry)
  ) {
    return null;
  }
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of candidate.files) {
    if (
      !file ||
      typeof file !== "object" ||
      !validPath(file.path) ||
      paths.has(file.path) ||
      typeof file.type !== "string" ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.type) ||
      typeof file.data !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) ||
      Buffer.from(file.data, "base64").toString("base64") !== file.data
    ) {
      return null;
    }
    paths.add(file.path);
    bytes += Buffer.byteLength(file.data, "base64");
  }
  if (!paths.has(candidate.entry) || bytes > 10 * 1024 * 1024) return null;
  return {
    fileCount: candidate.files.length,
    totalBytes: bytes,
    bundle: candidate as ArtifactBundle,
  };
}

function getStore(env: Env): DurableObjectStub<Store> {
  return env.STORE.get(env.STORE.idFromName("main"));
}

async function getCurrentUser(
  request: Request,
  env: Env,
  store: DurableObjectStub<Store>,
): Promise<ViewerUser | null> {
  const session = await readSession(request, env);
  if (!session) return null;
  const user = await store.getUser(session.email);
  const email = session.email.toLowerCase();
  return {
    email,
    name: user?.name || email.split("@")[0] || "Viewer",
    isOwner: isOwnerEmail(email, env),
  };
}

async function ensureArtifact(
  token: string,
  env: Env,
  store: DurableObjectStub<Store>,
): Promise<ArtifactRecord | null> {
  const existing = await store.getArtifact(token);
  if (existing) return existing;
  const object = await env.FILES.get(`shares/${token}`);
  if (!object) return null;
  const bundle = await object.json<Partial<ArtifactBundle>>();
  let totalBytes = 0;
  if (Array.isArray(bundle.files)) {
    for (const f of bundle.files) {
      if (typeof f.data === "string") {
        totalBytes += Buffer.byteLength(f.data, "base64");
      }
    }
  }
  return store.ensureArtifact({
    token,
    entry: bundle.entry || "index.html",
    fileCount: Array.isArray(bundle.files) ? bundle.files.length : 0,
    totalBytes,
  });
}

async function canViewArtifact(
  artifact: ArtifactRecord | null,
  user: Pick<ViewerUser, "email" | "isOwner"> | null,
  bearer: boolean,
  store: DurableObjectStub<Store>,
): Promise<boolean> {
  if (!artifact) return false;
  if (bearer || user?.isOwner) return true;
  if (artifact.publicLink) return true;
  if (user && (await store.isSharedWith(artifact.token, user.email))) {
    return true;
  }
  return false;
}

function serveBundleFile(
  request: Request,
  bundle: ArtifactBundle,
  rawSubpath: string,
): Response {
  let path: string;
  try {
    path = decodeURIComponent(rawSubpath);
  } catch {
    return reply("Not found", 404);
  }
  if (path === "") path = bundle.entry;
  if (path.endsWith("/")) path += "index.html";
  if (!validPath(path)) return reply("Not found", 404);
  const file = bundle.files.find((f) => f.path === path);
  if (!file) return reply("Not found", 404);
  const data = Buffer.from(file.data, "base64");
  return reply(request.method === "HEAD" ? null : data, 200, {
    "Content-Type": file.type,
    "Content-Length": String(data.byteLength),
    // Artifact scripts run in an opaque origin and cannot access cookies or shell state.
    "Content-Security-Policy": ARTIFACT_CSP,
  });
}

function safeNext(next: string | null): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;
  const store = getStore(env);
  const bearer = isBearerAuthorized(request, env);

  // CSRF check for cookie-authenticated mutations.
  if (
    !bearer &&
    (method === "POST" ||
      method === "PUT" ||
      method === "PATCH" ||
      method === "DELETE") &&
    !verifySameOrigin(request)
  ) {
    return jsonReply({ error: "Cross-origin request blocked" }, 403);
  }

  // --- Auth API ---

  if (pathname === "/api/me") {
    const user = await getCurrentUser(request, env, store);
    if (method === "GET") {
      return jsonReply({ user });
    }
    if (method === "PATCH") {
      if (!user) return jsonReply({ error: "Unauthorized" }, 401);
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch {
        return jsonReply({ error: "Invalid JSON" }, 400);
      }
      const name = typeof body.name === "string" ? body.name : "";
      const updated = await store.updateUserName(user.email, name);
      return jsonReply({
        user: {
          email: updated.email,
          name: updated.name,
          isOwner: user.isOwner,
        },
      });
    }
    return reply("Method not allowed", 405);
  }

  if (pathname === "/api/auth/request-code" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonReply({ error: "Invalid JSON" }, 400);
    }
    const email = normalizeEmail(body.email);
    if (!email) {
      return jsonReply({ error: "Enter a valid email address." }, 400);
    }
    const code = generateOtpCode();
    const secret = getSessionSecret(env);
    const codeHash = hashOtpCode(secret, email, code);
    const created = await store.createLoginCode(email, codeHash);
    if (!created.ok) {
      return jsonReply({ error: created.error }, created.status);
    }
    try {
      await sendLoginCode(env, email, code, url.origin);
    } catch {
      console.error(JSON.stringify({ event: "login_email_failed" }));
      return jsonReply(
        { error: "Could not send sign-in email right now. Please try again." },
        502,
      );
    }
    return jsonReply({ ok: true });
  }

  if (pathname === "/api/auth/verify-code" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonReply({ error: "Invalid JSON" }, 400);
    }
    const email = normalizeEmail(body.email);
    const code =
      typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    if (!email || !/^\d{8}$/.test(code)) {
      return jsonReply({ error: "Enter your email and 8-digit code." }, 400);
    }
    const secret = getSessionSecret(env);
    const codeHash = hashOtpCode(secret, email, code);
    const verified = await store.verifyLoginCode(email, codeHash);
    if (!verified.ok) {
      return jsonReply({ error: verified.error }, verified.status);
    }
    const sessionToken = await signToken(secret, "session", SESSION_TTL, {
      email,
    });
    const user: ViewerUser = {
      email: verified.user.email,
      name: verified.user.name,
      isOwner: isOwnerEmail(verified.user.email, env),
    };
    return jsonReply({ ok: true, user }, 200, {
      "Set-Cookie": buildSessionCookie(request, sessionToken, SESSION_TTL),
    });
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    return jsonReply({ ok: true }, 200, {
      "Set-Cookie": buildClearSessionCookie(request),
    });
  }

  // --- Upload / Delete Shares API (/api/shares/:token) ---

  const shareApi = pathname.match(/^\/api\/shares\/([a-f0-9]{64})$/);
  if (shareApi) {
    const token = shareApi[1];
    const key = `shares/${token}`;

    if (method === "DELETE") {
      const user = bearer ? null : await getCurrentUser(request, env, store);
      if (!bearer && !user?.isOwner) return reply("Unauthorized", 401);
      await env.FILES.delete(key);
      await store.deleteArtifact(token);
      return reply(null, 204);
    }

    if (method !== "PUT") return reply("Method not allowed", 405);
    if (!bearer) return reply("Unauthorized", 401);

    let payload: unknown;
    try {
      const rawBody = await boundedBody(request, MAX_BODY);
      payload = JSON.parse(rawBody);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid request payload";
      return reply(message, message.includes("exceeds") ? 413 : 400);
    }

    const validated = validateBundle(payload);
    if (!validated) return reply("Invalid artifact bundle", 400);
    const { bundle, fileCount, totalBytes } = validated;

    let shareEmails: string[] | undefined;
    if (bundle.shares !== undefined) {
      if (!Array.isArray(bundle.shares)) {
        return reply("Invalid shares list", 400);
      }
      shareEmails = [];
      for (const candidate of bundle.shares) {
        const normalized = normalizeEmail(candidate);
        if (!normalized) {
          return reply(`Invalid share email: ${String(candidate)}`, 400);
        }
        shareEmails.push(normalized);
      }
    }

    // Store only the clean static bundle in R2.
    const r2Body = JSON.stringify({
      entry: bundle.entry,
      files: bundle.files,
    });
    const object = await env.FILES.put(key, r2Body, {
      httpMetadata: { contentType: "application/json" },
      ...(request.headers.get("If-None-Match") === "*"
        ? { onlyIf: { etagDoesNotMatch: "*" } }
        : {}),
    });
    if (!object) return reply("Share already exists", 409);

    const ownerEmail = primaryOwnerEmail(env);
    const { artifact, newlyAddedShares } = await store.upsertArtifact({
      token,
      title: typeof bundle.title === "string" ? bundle.title : undefined,
      entry: bundle.entry,
      publicLink:
        typeof bundle.publicLink === "boolean" ? bundle.publicLink : undefined,
      fileCount,
      totalBytes,
      shares: shareEmails,
      invitedBy: ownerEmail,
    });

    const shareUrl = `${url.origin}/s/${token}/`;
    if (newlyAddedShares.length && bundle.notify !== false) {
      const ownerProfile = await store.getUser(ownerEmail);
      const sharedBy = ownerProfile?.name || "Alex";
      await Promise.allSettled(
        newlyAddedShares.map((to) =>
          sendShareInvite(
            env,
            to,
            { title: artifact.title, url: shareUrl, sharedBy },
            url.origin,
          ),
        ),
      );
    }

    return jsonReply({ url: shareUrl, artifact }, 200);
  }

  // --- Artifacts List API (/api/artifacts) ---

  if (pathname === "/api/artifacts" && method === "GET") {
    const user = bearer ? null : await getCurrentUser(request, env, store);
    if (!bearer && !user) return jsonReply({ error: "Unauthorized" }, 401);
    const artifacts = await store.listArtifacts({
      email: user?.email || null,
      isOwner: Boolean(bearer || user?.isOwner),
    });
    return jsonReply({ artifacts });
  }

  // --- Artifact Detail / Update API (/api/artifacts/:token) ---

  const artifactApi = pathname.match(/^\/api\/artifacts\/([a-f0-9]{64})$/);
  if (artifactApi) {
    const token = artifactApi[1];
    const user = bearer ? null : await getCurrentUser(request, env, store);
    const artifact = await ensureArtifact(token, env, store);
    if (!artifact) return jsonReply({ error: "Not found" }, 404);

    if (method === "GET") {
      if (!(await canViewArtifact(artifact, user, bearer, store))) {
        return jsonReply(
          { error: user ? "Forbidden" : "Unauthorized" },
          user ? 403 : 401,
        );
      }
      const comments = await store.listComments(token);
      const shares =
        bearer || user?.isOwner ? await store.listShares(token) : undefined;
      return jsonReply({ artifact, comments, ...(shares ? { shares } : {}) });
    }

    if (method === "PATCH") {
      if (!bearer && !user?.isOwner) {
        return jsonReply({ error: "Forbidden" }, user ? 403 : 401);
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch {
        return jsonReply({ error: "Invalid JSON" }, 400);
      }
      const updated = await store.updateArtifact(token, {
        title: typeof body.title === "string" ? body.title : undefined,
        publicLink:
          typeof body.publicLink === "boolean" ? body.publicLink : undefined,
      });
      return jsonReply({ artifact: updated });
    }

    return reply("Method not allowed", 405);
  }

  // --- Artifact Shares Management API (/api/artifacts/:token/shares[/:email]) ---

  const sharesApi = pathname.match(
    /^\/api\/artifacts\/([a-f0-9]{64})\/shares(?:\/([^/]+))?$/,
  );
  if (sharesApi) {
    const token = sharesApi[1];
    const targetEmailParam = sharesApi[2];
    const user = bearer ? null : await getCurrentUser(request, env, store);
    if (!bearer && !user?.isOwner) {
      return jsonReply({ error: "Forbidden" }, user ? 403 : 401);
    }
    const artifact = await ensureArtifact(token, env, store);
    if (!artifact) return jsonReply({ error: "Not found" }, 404);

    if (method === "GET" && !targetEmailParam) {
      return jsonReply({ shares: await store.listShares(token) });
    }

    if (method === "POST" && !targetEmailParam) {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch {
        return jsonReply({ error: "Invalid JSON" }, 400);
      }
      const email = normalizeEmail(body.email);
      if (!email) {
        return jsonReply({ error: "Enter a valid email address." }, 400);
      }
      const invitedBy = user?.email || primaryOwnerEmail(env);
      const result = await store.addShare(token, email, invitedBy);
      if (result.added && body.notify !== false) {
        const shareUrl = `${url.origin}/s/${token}/`;
        const sharedBy = user?.name || "Alex";
        try {
          await sendShareInvite(
            env,
            email,
            { title: artifact.title, url: shareUrl, sharedBy },
            url.origin,
          );
        } catch {
          console.error(JSON.stringify({ event: "share_invite_email_failed" }));
        }
      }
      return jsonReply(result, result.added ? 201 : 200);
    }

    if (method === "DELETE" && targetEmailParam) {
      let email: string | null;
      try {
        email = normalizeEmail(decodeURIComponent(targetEmailParam));
      } catch {
        email = null;
      }
      if (!email) return jsonReply({ error: "Invalid email" }, 400);
      const result = await store.removeShare(token, email);
      return jsonReply(result);
    }

    return reply("Method not allowed", 405);
  }

  // --- Comments API (/api/artifacts/:token/comments[/:id]) ---

  const commentsApi = pathname.match(
    /^\/api\/artifacts\/([a-f0-9]{64})\/comments(?:\/([^/]+))?$/,
  );
  if (commentsApi) {
    const token = commentsApi[1];
    const commentId = commentsApi[2];
    const user = bearer ? null : await getCurrentUser(request, env, store);
    const artifact = await ensureArtifact(token, env, store);
    if (!artifact) return jsonReply({ error: "Not found" }, 404);

    if (!(await canViewArtifact(artifact, user, bearer, store))) {
      return jsonReply(
        { error: user ? "Forbidden" : "Unauthorized" },
        user ? 403 : 401,
      );
    }

    if (method === "GET" && !commentId) {
      return jsonReply({ comments: await store.listComments(token) });
    }

    if (method === "POST" && !commentId) {
      if (!bearer && !user) {
        return jsonReply({ error: "Sign in to comment." }, 401);
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch {
        return jsonReply({ error: "Invalid JSON" }, 400);
      }
      const created = await store.createComment({
        token,
        parentId: typeof body.parentId === "string" ? body.parentId : null,
        authorEmail: bearer ? primaryOwnerEmail(env) : user!.email,
        authorName: bearer
          ? typeof body.authorName === "string" && body.authorName.trim()
            ? body.authorName.trim()
            : "Agent"
          : user!.name,
        authorKind: bearer ? "agent" : "user",
        body: body.body,
        pinX: body.pinX ?? null,
        pinY: body.pinY ?? null,
        pinLabel: body.pinLabel ?? null,
      });
      if (!created.ok) {
        return jsonReply({ error: created.error }, created.status);
      }
      return jsonReply(
        { comment: created.comment, comments: created.comments },
        201,
      );
    }

    if (method === "PATCH" && commentId) {
      if (!bearer && !user) {
        return jsonReply({ error: "Sign in to update comments." }, 401);
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch {
        return jsonReply({ error: "Invalid JSON" }, 400);
      }
      const existing = await store.getComment(token, commentId);
      if (!existing) return jsonReply({ error: "Comment not found." }, 404);
      const canEditBody = Boolean(
        bearer || user?.isOwner || user?.email === existing.authorEmail,
      );
      const updated = await store.updateComment({
        token,
        id: commentId,
        body: body.body,
        resolved:
          typeof body.resolved === "boolean" ? body.resolved : undefined,
        actorEmail: bearer ? primaryOwnerEmail(env) : user!.email,
        canEditBody,
      });
      if (!updated.ok) {
        return jsonReply({ error: updated.error }, updated.status);
      }
      return jsonReply({
        comment: updated.comment,
        comments: updated.comments,
      });
    }

    if (method === "DELETE" && commentId) {
      if (!bearer && !user) {
        return jsonReply({ error: "Unauthorized" }, 401);
      }
      const existing = await store.getComment(token, commentId);
      if (!existing) return jsonReply({ error: "Comment not found." }, 404);
      if (!bearer && !user!.isOwner && user!.email !== existing.authorEmail) {
        return jsonReply({ error: "Forbidden" }, 403);
      }
      const deleted = await store.deleteComment(token, commentId);
      if (!deleted.ok) {
        return jsonReply({ error: deleted.error }, deleted.status);
      }
      return jsonReply({ ok: true, comments: deleted.comments });
    }

    return reply("Method not allowed", 405);
  }

  // --- Only GET/HEAD beyond this point ---

  if (method !== "GET" && method !== "HEAD") {
    return reply("Not found", 404);
  }

  // --- Sandboxed Frame Content (/f/:frameToken/:path*) ---

  const frameMatch = pathname.match(
    /^\/f\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/.*)?$/,
  );
  if (frameMatch) {
    const payload = await verifyToken<{ token?: unknown; email?: unknown }>(
      getSessionSecret(env),
      "frame",
      frameMatch[1],
    );
    if (
      !payload ||
      typeof payload.token !== "string" ||
      !TOKEN_RE.test(payload.token)
    ) {
      return reply("Not found", 404);
    }
    if (!frameMatch[2]) {
      return reply(null, 302, { Location: `/f/${frameMatch[1]}/` });
    }
    const artifact = await ensureArtifact(payload.token, env, store);
    if (!artifact) return reply("Not found", 404);
    const frameUser =
      typeof payload.email === "string" && payload.email
        ? { email: payload.email, isOwner: isOwnerEmail(payload.email, env) }
        : null;
    if (!(await canViewArtifact(artifact, frameUser, false, store))) {
      return reply("Forbidden", 403);
    }
    const object = await env.FILES.get(`shares/${payload.token}`);
    if (!object) return reply("Not found", 404);
    const bundle = await object.json<ArtifactBundle>();
    return serveBundleFile(request, bundle, frameMatch[2].slice(1));
  }

  // --- Dashboard & Login Pages ---

  if (pathname === "/" || pathname === "/login") {
    const user = await getCurrentUser(request, env, store);
    const next = safeNext(url.searchParams.get("next"));
    if (pathname === "/login") {
      if (user) return reply(null, 302, { Location: next });
      return htmlReply(renderLoginPage({ next }));
    }
    if (!user) {
      return htmlReply(renderLoginPage({ next: "/" }));
    }
    const artifacts = await store.listArtifacts({
      email: user.email,
      isOwner: user.isOwner,
    });
    return htmlReply(renderDashboardPage({ user, artifacts }));
  }

  // --- Share Viewer & Sub-assets (/s/:token/...) ---

  const shareMatch = pathname.match(/^\/s\/([a-f0-9]{64})(\/.*)?$/);
  if (!shareMatch || !TOKEN_RE.test(shareMatch[1])) {
    return reply("Not found", 404);
  }
  const token = shareMatch[1];
  if (!shareMatch[2]) {
    return reply(null, 302, { Location: `/s/${token}/${url.search}` });
  }

  const artifact = await ensureArtifact(token, env, store);
  if (!artifact) return reply("Not found", 404);

  const user = await getCurrentUser(request, env, store);
  const allowed = await canViewArtifact(artifact, user, bearer, store);
  const subpath = shareMatch[2].slice(1);

  if (!allowed) {
    if (subpath !== "" || url.searchParams.get("raw") === "1") {
      return reply(user ? "Forbidden" : "Unauthorized", user ? 403 : 401);
    }
    if (user) {
      return htmlReply(
        renderLoginPage({
          next: `/s/${token}/`,
          heading: "Access restricted",
          subtitle:
            "Ask the owner to invite your email address to this artifact.",
          deniedUser: user,
        }),
        403,
      );
    }
    return htmlReply(
      renderLoginPage({
        next: `/s/${token}/`,
        heading: "Sign in to view this artifact",
        subtitle:
          "This artifact is private. Enter your email to get an 8-digit sign-in code.",
      }),
      200,
    );
  }

  // Raw file mode: either a direct sub-asset (/s/:token/style.css) or explicit ?raw=1.
  if (subpath !== "" || url.searchParams.get("raw") === "1") {
    const object = await env.FILES.get(`shares/${token}`);
    if (!object) return reply("Not found", 404);
    const bundle = await object.json<ArtifactBundle>();
    return serveBundleFile(request, bundle, subpath);
  }

  // Viewer shell page: mint a short-lived signed frame token so the sandboxed
  // opaque-origin iframe can load the entry document and all relative assets
  // without cookies.
  const frameToken = await signToken(
    getSessionSecret(env),
    "frame",
    FRAME_TTL,
    { token, email: user?.email || null },
  );
  const comments = await store.listComments(token);
  const shares = user?.isOwner ? await store.listShares(token) : [];
  return htmlReply(
    renderViewerPage({
      artifact,
      frameUrl: `/f/${frameToken}/`,
      user,
      shares,
      comments,
    }),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      // Do not log share links, credentials, or artifact content.
      console.error(JSON.stringify({ event: "artifact_request_failed" }));
      return reply("Service error", 500);
    }
  },
};
