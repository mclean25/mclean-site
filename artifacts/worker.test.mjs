import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Use the local Workers runtime installed with the pinned Wrangler dependency.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const runtime = new Miniflare({
  modules: true,
  script: await readFile(new URL("./worker.mjs", import.meta.url), "utf8"),
  // This is the newest date supported by the installed local runtime.
  compatibilityDate: "2026-06-18",
  compatibilityFlags: ["nodejs_compat"],
  r2Buckets: ["FILES"],
  bindings: { UPLOAD_TOKEN: "local-test-only" },
});
const token = "a".repeat(64);
const api = `http://localhost/api/shares/${token}`;
const share = `http://localhost/s/${token}/`;
const auth = { Authorization: "Bearer local-test-only" };
function bundle(text) {
  return JSON.stringify({
    entry: "index.html",
    files: [
      {
        path: "index.html",
        type: "text/html",
        data: Buffer.from(text).toString("base64"),
      },
      {
        path: "style.css",
        type: "text/css",
        data: Buffer.from("body{}").toString("base64"),
      },
    ],
  });
}
try {
  assert.equal((await runtime.dispatchFetch("http://localhost/")).status, 404);
  assert.equal(
    (await runtime.dispatchFetch(api, { method: "PUT", body: bundle("first") }))
      .status,
    401,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: auth,
        body: bundle("first"),
      })
    ).status,
    200,
  );
  let response = await runtime.dispatchFetch(share);
  assert.equal(await response.text(), "first");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(
    response.headers.get("Content-Security-Policy"),
    "sandbox allow-scripts allow-downloads allow-modals",
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: { ...auth, "If-None-Match": "*" },
        body: bundle("other"),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: auth,
        body: bundle("updated"),
      })
    ).status,
    200,
  );
  assert.equal(await (await runtime.dispatchFetch(share)).text(), "updated");
  assert.equal((await runtime.dispatchFetch(share + "style.css")).status, 200);
  assert.equal((await runtime.dispatchFetch(share + "missing")).status, 404);
  assert.equal(
    (await runtime.dispatchFetch(`http://localhost/s/${"b".repeat(64)}/`))
      .status,
    404,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ entry: "../secret", files: [] }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: auth,
        body: bundle("x".repeat(512 * 1024)),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: auth,
        body: "x".repeat(16 * 1024 * 1024 + 1),
      })
    ).status,
    413,
  );
  assert.equal(
    (await runtime.dispatchFetch(api, { method: "DELETE", headers: auth }))
      .status,
    204,
  );
  assert.equal((await runtime.dispatchFetch(share)).status, 404);
  console.log("Artifact runtime checks passed.");
} finally {
  await runtime.dispose();
}
