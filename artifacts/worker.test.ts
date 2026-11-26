import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Use the local Workers runtime & esbuild installed with the pinned Wrangler dependency.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare") as {
  Miniflare: new (options: unknown) => {
    dispatchFetch(input: string, init?: RequestInit): Promise<Response>;
    getWorker(name: string): Promise<{
      fetch(input: string, init?: RequestInit): Promise<Response>;
    }>;
    getR2Bucket(
      binding: string,
      worker: string,
    ): Promise<{ put(key: string, value: string): Promise<unknown> }>;
    dispose(): Promise<void>;
  };
};
const esbuild = wranglerRequire("esbuild") as {
  transformSync(
    input: string,
    options: { loader: "ts"; format: "esm"; sourcefile?: string },
  ): { code: string };
};

const moduleFiles = [
  "worker.ts",
  "auth.ts",
  "mail.ts",
  "store.ts",
  "ui.ts",
  "types.ts",
];
const modules: Record<string, { type: "esm"; contents: string }> = {};
for (const file of moduleFiles) {
  const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
  const { code } = esbuild.transformSync(source, {
    loader: "ts",
    format: "esm",
    sourcefile: file,
  });
  modules[file] = { type: "esm", contents: code };
}

const runtime = new Miniflare({
  workers: [
    {
      config: {
        name: "mclean-artifacts",
        compatibilityDate: "2026-10-03",
        compatibilityFlags: ["nodejs_compat"],
        manifest: {
          mainModule: "worker.ts",
          modules,
        },
        exports: {
          Store: { type: "durable-object", storage: "sqlite" },
        },
        env: {
          FILES: { type: "r2", name: "files" },
          STORE: {
            type: "durable-object",
            worker: "mclean-artifacts",
            exportName: "Store",
          },
          EMAIL: { type: "worker", worker: "mock-email" },
          UPLOAD_TOKEN: { type: "text", value: "local-test-only" },
          SESSION_SECRET: {
            type: "text",
            value: "test-session-secret-0123456789",
          },
          OWNER_EMAIL: { type: "text", value: "alex@mclean.sh" },
          MAIL_FROM: {
            type: "text",
            value: "sign-in@mail-artifacts.mclean.sh",
          },
          APEX_ORIGIN: { type: "text", value: "http://localhost" },
        },
      },
    },
    {
      config: {
        name: "mock-email",
        compatibilityDate: "2026-10-03",
        compatibilityFlags: ["nodejs_compat"],
        manifest: {
          mainModule: "email.mjs",
          modules: {
            "email.mjs": {
              type: "esm",
              contents: `
                import { WorkerEntrypoint } from "cloudflare:workers";
                const sent = [];
                export default class MockEmail extends WorkerEntrypoint {
                  async send(msg) {
                    sent.push(msg);
                    return { ok: true };
                  }
                  async fetch(request) {
                    if (request.method === "DELETE") {
                      sent.length = 0;
                      return new Response(null, { status: 204 });
                    }
                    return Response.json(sent);
                  }
                }
              `,
            },
          },
        },
      },
    },
  ],
});

const bearerAuth = { Authorization: "Bearer local-test-only" };

interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

function bundle(text: string, extra: Record<string, unknown> = {}): string {
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
        data: Buffer.from("body{color:black}").toString("base64"),
      },
    ],
    ...extra,
  });
}

async function getSentEmails(): Promise<SentEmail[]> {
  const worker = await runtime.getWorker("mock-email");
  const res = await worker.fetch("http://localhost/");
  return (await res.json()) as SentEmail[];
}

async function clearSentEmails(): Promise<void> {
  const worker = await runtime.getWorker("mock-email");
  await worker.fetch("http://localhost/", { method: "DELETE" });
}

function extractCookie(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  assert.ok(setCookie, "Expected Set-Cookie header");
  return setCookie.split(";")[0];
}

async function signInAs(email: string): Promise<{
  cookie: string;
  data: { ok: boolean; user: { email: string; name: string; isOwner: boolean } };
}> {
  await clearSentEmails();
  const reqRes = await runtime.dispatchFetch(
    "http://localhost/api/auth/request-code",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ email }),
    },
  );
  assert.equal(reqRes.status, 200);
  const emails = await getSentEmails();
  const mail = emails.find((m) => m.to === email.toLowerCase());
  assert.ok(mail, `Expected sign-in email for ${email}`);
  const match = mail.text.match(/\b(\d{8})\b/);
  assert.ok(match, "Expected 8-digit OTP code in email text");
  const code = match[1];

  const verifyRes = await runtime.dispatchFetch(
    "http://localhost/api/auth/verify-code",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ email, code }),
    },
  );
  assert.equal(verifyRes.status, 200);
  return {
    cookie: extractCookie(verifyRes),
    data: (await verifyRes.json()) as {
      ok: boolean;
      user: { email: string; name: string; isOwner: boolean };
    },
  };
}

try {
  // 1. Signed-out root serves login page with strict shell CSP.
  {
    const res = await runtime.dispatchFetch("http://localhost/");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
    assert.match(
      res.headers.get("Content-Security-Policy") || "",
      /frame-ancestors 'none'/,
    );
    const html = await res.text();
    assert.match(html, /Sign in to artifacts\.mclean\.sh/);
  }

  // 2. Upload API basics, validation, size limit, and viewer shell + sandboxed frame.
  const token = "a".repeat(64);
  const api = `http://localhost/api/shares/${token}`;
  const share = `http://localhost/s/${token}/`;

  assert.equal(
    (await runtime.dispatchFetch(api, { method: "PUT", body: bundle("first") }))
      .status,
    401,
  );
  {
    const res = await runtime.dispatchFetch(api, {
      method: "PUT",
      headers: bearerAuth,
      body: bundle("<h1>First</h1>", { title: "Demo Report" }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      url: string;
      artifact: { title: string; publicLink: boolean };
    };
    assert.equal(data.url, share);
    assert.equal(data.artifact.title, "Demo Report");
    assert.equal(data.artifact.publicLink, true);
  }

  // Viewer shell renders sandboxed iframe using signed /f/<frameToken>/ URL.
  {
    const res = await runtime.dispatchFetch(share);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const html = await res.text();
    assert.match(html, /Demo Report/);
    assert.match(
      html,
      /sandbox="allow-scripts allow-downloads allow-modals allow-forms"/,
    );
    assert.doesNotMatch(html, /allow-same-origin/);

    const frameMatch = html.match(/src="(\/f\/[^"]+\/)"/);
    assert.ok(frameMatch, "Expected signed /f/<frameToken>/ iframe src");
    const frameUrl = `http://localhost${frameMatch[1]}`;

    const frameRes = await runtime.dispatchFetch(frameUrl);
    assert.equal(frameRes.status, 200);
    assert.equal(await frameRes.text(), "<h1>First</h1>");
    assert.equal(
      frameRes.headers.get("Content-Security-Policy"),
      "sandbox allow-scripts allow-downloads allow-modals allow-forms",
    );

    const cssRes = await runtime.dispatchFetch(`${frameUrl}style.css`);
    assert.equal(cssRes.status, 200);
    assert.equal(await cssRes.text(), "body{color:black}");
  }

  // Direct ?raw=1 and sub-files still work for link-accessible shares.
  {
    const rawRes = await runtime.dispatchFetch(`${share}?raw=1`);
    assert.equal(rawRes.status, 200);
    assert.equal(await rawRes.text(), "<h1>First</h1>");
    assert.equal(
      rawRes.headers.get("Content-Security-Policy"),
      "sandbox allow-scripts allow-downloads allow-modals allow-forms",
    );
    assert.equal(
      (await runtime.dispatchFetch(`${share}style.css`)).status,
      200,
    );
    assert.equal((await runtime.dispatchFetch(`${share}missing`)).status, 404);
  }

  // If-None-Match conflict, update, invalid bundle, large bundle, 413 payload limit.
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: { ...bearerAuth, "If-None-Match": "*" },
        body: bundle("other"),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: bearerAuth,
        body: bundle("updated"),
      })
    ).status,
    200,
  );
  assert.equal(
    await (await runtime.dispatchFetch(`${share}?raw=1`)).text(),
    "updated",
  );
  assert.equal(
    (await runtime.dispatchFetch(`http://localhost/s/${"b".repeat(64)}/`))
      .status,
    404,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: bearerAuth,
        body: JSON.stringify({ entry: "../secret", files: [] }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: bearerAuth,
        body: bundle("x".repeat(512 * 1024)),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(api, {
        method: "PUT",
        headers: bearerAuth,
        body: "x".repeat(16 * 1024 * 1024 + 1),
      })
    ).status,
    413,
  );

  // 3. Backwards compatibility: pre-existing R2-only share auto-registers on read.
  {
    const legacyToken = "c".repeat(64);
    const bucket = await runtime.getR2Bucket("FILES", "mclean-artifacts");
    await bucket.put(`shares/${legacyToken}`, bundle("legacy-content"));
    const res = await runtime.dispatchFetch(
      `http://localhost/s/${legacyToken}/?raw=1`,
    );
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "legacy-content");
    const shellRes = await runtime.dispatchFetch(
      `http://localhost/s/${legacyToken}/`,
    );
    assert.equal(shellRes.status, 200);
    assert.match(await shellRes.text(), /index\.html/);
  }

  // 4. Email OTP security: wrong code, lockout, test-domain suppression, rate limit.
  {
    await clearSentEmails();
    const testAddrRes = await runtime.dispatchFetch(
      "http://localhost/api/auth/request-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ email: "bot@example.test" }),
      },
    );
    assert.equal(testAddrRes.status, 200);
    assert.equal(
      (await getSentEmails()).length,
      0,
      "Test domains should not emit emails",
    );

    for (let i = 0; i < 5; i++) {
      const bad = await runtime.dispatchFetch(
        "http://localhost/api/auth/verify-code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
          },
          body: JSON.stringify({ email: "bot@example.test", code: "00000000" }),
        },
      );
      assert.equal(bad.status, 400);
    }
    const locked = await runtime.dispatchFetch(
      "http://localhost/api/auth/verify-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ email: "bot@example.test", code: "00000000" }),
      },
    );
    assert.equal(locked.status, 429);

    for (let i = 0; i < 4; i++) {
      const ok = await runtime.dispatchFetch(
        "http://localhost/api/auth/request-code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
          },
          body: JSON.stringify({ email: "bot@example.test" }),
        },
      );
      assert.equal(ok.status, 200);
    }
    const limited = await runtime.dispatchFetch(
      "http://localhost/api/auth/request-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ email: "bot@example.test" }),
      },
    );
    assert.equal(limited.status, 429);
  }

  // 5. Sign in as owner, update profile name, view dashboard.
  const owner = await signInAs("alex@mclean.sh");
  assert.equal(owner.data.user.isOwner, true);
  {
    const patchMe = await runtime.dispatchFetch("http://localhost/api/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
        Origin: "http://localhost",
      },
      body: JSON.stringify({ name: "Alex McLean" }),
    });
    assert.equal(patchMe.status, 200);
    const meData = (await patchMe.json()) as { user: { name: string } };
    assert.equal(meData.user.name, "Alex McLean");

    const dash = await runtime.dispatchFetch("http://localhost/", {
      headers: { Cookie: owner.cookie },
    });
    assert.equal(dash.status, 200);
    const dashHtml = await dash.text();
    assert.match(dashHtml, /Your artifacts/);
    assert.match(dashHtml, /Demo Report/);
  }

  // CSRF check blocks cross-origin cookie mutations.
  {
    const csrf = await runtime.dispatchFetch("http://localhost/api/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ name: "Hacked" }),
    });
    assert.equal(csrf.status, 403);
  }

  // 6. Private artifact access control & email invitations.
  {
    const makePrivate = await runtime.dispatchFetch(
      `http://localhost/api/artifacts/${token}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: owner.cookie,
          Origin: "http://localhost",
        },
        body: JSON.stringify({ publicLink: false }),
      },
    );
    assert.equal(makePrivate.status, 200);
    const privData = (await makePrivate.json()) as {
      artifact: { publicLink: boolean };
    };
    assert.equal(privData.artifact.publicLink, false);

    // Anonymous cannot view private artifact or leak frame token.
    const anonGate = await runtime.dispatchFetch(share);
    assert.equal(anonGate.status, 200);
    const gateHtml = await anonGate.text();
    assert.match(gateHtml, /Sign in to view this artifact/);
    assert.doesNotMatch(gateHtml, /\/f\//);
    assert.equal((await runtime.dispatchFetch(`${share}?raw=1`)).status, 401);
    assert.equal(
      (
        await runtime.dispatchFetch(
          `http://localhost/api/artifacts/${token}/comments`,
        )
      ).status,
      401,
    );

    // Uninvited guest gets 403.
    const stranger = await signInAs("stranger@company.io");
    assert.equal(stranger.data.user.isOwner, false);
    const denied = await runtime.dispatchFetch(share, {
      headers: { Cookie: stranger.cookie },
    });
    assert.equal(denied.status, 403);
    assert.match(await denied.text(), /Access restricted/);

    const strangerList = await runtime.dispatchFetch(
      "http://localhost/api/artifacts",
      {
        headers: { Cookie: stranger.cookie },
      },
    );
    assert.equal(strangerList.status, 200);
    assert.deepEqual(
      ((await strangerList.json()) as { artifacts: unknown[] }).artifacts,
      [],
    );

    // Owner invites guest -> invite email sent.
    await clearSentEmails();
    const inviteRes = await runtime.dispatchFetch(
      `http://localhost/api/artifacts/${token}/shares`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: owner.cookie,
          Origin: "http://localhost",
        },
        body: JSON.stringify({ email: "guest@company.io", notify: true }),
      },
    );
    assert.equal(inviteRes.status, 201);
    const inviteMails = await getSentEmails();
    assert.equal(inviteMails.length, 1);
    assert.equal(inviteMails[0].to, "guest@company.io");
    assert.match(inviteMails[0].text, new RegExp(token));

    // Invited guest signs in and accesses both dashboard and private artifact + sandboxed frame.
    const guest = await signInAs("guest@company.io");
    const guestList = await runtime.dispatchFetch(
      "http://localhost/api/artifacts",
      {
        headers: { Cookie: guest.cookie },
      },
    );
    assert.equal(
      ((await guestList.json()) as { artifacts: unknown[] }).artifacts.length,
      1,
    );

    const guestView = await runtime.dispatchFetch(share, {
      headers: { Cookie: guest.cookie },
    });
    assert.equal(guestView.status, 200);
    const guestHtml = await guestView.text();
    const fm = guestHtml.match(/src="(\/f\/[^"]+\/)"/);
    assert.ok(fm, "Invited guest should receive signed frame URL");
    const frameRes = await runtime.dispatchFetch(
      `http://localhost${fm[1]}style.css`,
    );
    assert.equal(frameRes.status, 200);

    // 7. Comments, Pinned comments, Replies, Resolve, Delete, and Agent API.
    const pinRes = await runtime.dispatchFetch(
      `http://localhost/api/artifacts/${token}/comments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: guest.cookie,
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          body: "Can we tighten this chart margin?",
          pinX: 0.42,
          pinY: 0.31,
          pinLabel: "1440x900",
        }),
      },
    );
    assert.equal(pinRes.status, 201);
    const pinData = (await pinRes.json()) as {
      comment: { id: string; pinNumber: number; pinX: number; pinY: number };
    };
    assert.equal(pinData.comment.pinNumber, 1);
    assert.equal(pinData.comment.pinX, 0.42);
    assert.equal(pinData.comment.pinY, 0.31);
    const threadId = pinData.comment.id;

    // Agent replies via Bearer token and resolves thread.
    const agentReply = await runtime.dispatchFetch(
      `http://localhost/api/artifacts/${token}/comments`,
      {
        method: "POST",
        headers: {
          ...bearerAuth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parentId: threadId,
          body: "Updated spacing in latest upload.",
        }),
      },
    );
    assert.equal(agentReply.status, 201);
    const replyData = (await agentReply.json()) as {
      comment: { id: string; authorKind: string; parentId: string };
    };
    assert.equal(replyData.comment.authorKind, "agent");
    assert.equal(replyData.comment.parentId, threadId);

    // Guest cannot delete agent/owner's reply.
    const forbiddenDel = await runtime.dispatchFetch(
      `http://localhost/api/artifacts/${token}/comments/${replyData.comment.id}`,
      {
        method: "DELETE",
        headers: { Cookie: guest.cookie, Origin: "http://localhost" },
      },
    );
    assert.equal(forbiddenDel.status, 403);

    // Agent resolves thread.
    const resolveRes = await runtime.dispatchFetch(
      `http://localhost/api/artifacts/${token}/comments/${threadId}`,
      {
        method: "PATCH",
        headers: { ...bearerAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      },
    );
    assert.equal(resolveRes.status, 200);
    assert.ok(
      ((await resolveRes.json()) as { comment: { resolvedAt: number | null } })
        .comment.resolvedAt,
    );

    // Owner revokes guest access -> guest immediately gets 403 on both shell and prior frame URL.
    const revokeRes = await runtime.dispatchFetch(
      `http://localhost/api/artifacts/${token}/shares/${encodeURIComponent("guest@company.io")}`,
      {
        method: "DELETE",
        headers: { Cookie: owner.cookie, Origin: "http://localhost" },
      },
    );
    assert.equal(revokeRes.status, 200);
    assert.equal(
      (await runtime.dispatchFetch(share, { headers: { Cookie: guest.cookie } }))
        .status,
      403,
    );
    assert.equal(
      (await runtime.dispatchFetch(`http://localhost${fm[1]}style.css`)).status,
      403,
    );
  }

  // 8. Delete artifact removes both R2 content and Store metadata.
  assert.equal(
    (await runtime.dispatchFetch(api, { method: "DELETE", headers: bearerAuth }))
      .status,
    204,
  );
  assert.equal((await runtime.dispatchFetch(share)).status, 404);

  console.log("Artifact runtime checks passed.");
} finally {
  await runtime.dispose();
}
