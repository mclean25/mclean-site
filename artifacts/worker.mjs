import { createHash, timingSafeEqual } from "node:crypto";

const MAX_BODY = 16 * 1024 * 1024;
const MAX_FILES = 500;
const TOKEN = /^[a-f0-9]{64}$/;
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};

function reply(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...headers, ...extra } });
}

function validPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 500 &&
    !path.startsWith("/") &&
    !/[\\\x00-\x1f\x7f?#]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

async function boundedBody(request) {
  if (!request.body) throw new Error("Empty upload");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error("Upload exceeds 16 MiB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function validateBundle(bundle) {
  if (
    !bundle ||
    !Array.isArray(bundle.files) ||
    bundle.files.length < 1 ||
    bundle.files.length > MAX_FILES ||
    !validPath(bundle.entry)
  )
    return false;
  const paths = new Set();
  let bytes = 0;
  for (const file of bundle.files) {
    if (
      !validPath(file.path) ||
      paths.has(file.path) ||
      typeof file.type !== "string" ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.type) ||
      typeof file.data !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) ||
      Buffer.from(file.data, "base64").toString("base64") !== file.data
    )
      return false;
    paths.add(file.path);
    bytes += Buffer.byteLength(file.data, "base64");
  }
  return paths.has(bundle.entry) && bytes <= 10 * 1024 * 1024;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const api = url.pathname.match(/^\/api\/shares\/([a-f0-9]{64})$/);
  if (api) {
    const supplied =
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    if (
      !env.UPLOAD_TOKEN ||
      !timingSafeEqual(
        createHash("sha256").update(supplied).digest(),
        createHash("sha256").update(env.UPLOAD_TOKEN).digest(),
      )
    )
      return reply("Unauthorized", 401);
    const key = `shares/${api[1]}`;
    if (request.method === "DELETE") {
      await env.FILES.delete(key);
      return reply(null, 204);
    }
    if (request.method !== "PUT") return reply("Method not allowed", 405);
    let body, bundle;
    try {
      body = await boundedBody(request);
      bundle = JSON.parse(body);
    } catch (error) {
      return reply(
        error.message,
        error.message.includes("exceeds") ? 413 : 400,
      );
    }
    if (!validateBundle(bundle)) return reply("Invalid artifact bundle", 400);
    // One object makes each content update atomic. No old version is retained.
    const object = await env.FILES.put(key, body, {
      httpMetadata: { contentType: "application/json" },
      ...(request.headers.get("If-None-Match") === "*"
        ? { onlyIf: { etagDoesNotMatch: "*" } }
        : {}),
    });
    if (!object) return reply("Share already exists", 409);
    return reply(JSON.stringify({ url: `${url.origin}/s/${api[1]}/` }), 200, {
      "Content-Type": "application/json",
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD")
    return reply("Not found", 404);
  const share = url.pathname.match(/^\/s\/([a-f0-9]{64})(\/.*)?$/);
  if (!share || !TOKEN.test(share[1])) return reply("Not found", 404);
  if (!share[2]) return reply(null, 302, { Location: `/s/${share[1]}/` });
  const object = await env.FILES.get(`shares/${share[1]}`);
  if (!object) return reply("Not found", 404);
  const bundle = await object.json();
  let path;
  try {
    path = decodeURIComponent(share[2].slice(1));
  } catch {
    return reply("Not found", 404);
  }
  if (path === "") path = bundle.entry;
  if (path.endsWith("/")) path += "index.html";
  if (!validPath(path)) return reply("Not found", 404);
  const file = bundle.files.find((file) => file.path === path);
  if (!file) return reply("Not found", 404);
  const data = Buffer.from(file.data, "base64");
  const extra = {
    "Content-Type": file.type,
    "Content-Length": String(data.byteLength),
    // Artifact scripts have an isolated origin and cannot access site cookies.
    "Content-Security-Policy":
      "sandbox allow-scripts allow-downloads allow-modals",
  };
  return reply(request.method === "HEAD" ? null : data, 200, extra);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      // Do not log share links, credentials, or artifact content.
      console.error(JSON.stringify({ event: "artifact_request_failed" }));
      return reply("Service error", 500);
    }
  },
};
