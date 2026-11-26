import type {
  ArtifactRecord,
  CommentRecord,
  ShareRecord,
  ViewerUser,
} from "./types.ts";

function escapeHtml(str: string | null | undefined): string {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) =>
      (
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }) as Record<string, string>
      )[c] ?? c,
  );
}

function safeJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const BASE_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #f1f3f6;
  --border: #e2e5ec;
  --text: #111827;
  --muted: #6b7280;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-soft: rgba(37, 99, 235, 0.12);
  --ok: #16a34a;
  --ok-soft: rgba(22, 163, 74, 0.12);
  --warn: #d97706;
  --warn-soft: rgba(217, 119, 6, 0.12);
  --danger: #dc2626;
  --danger-soft: rgba(220, 38, 38, 0.12);
  --shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
  --radius: 10px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0e13;
    --surface: #141821;
    --surface-2: #1c2230;
    --border: #272e3f;
    --text: #f3f4f6;
    --muted: #9ca3af;
    --accent: #60a5fa;
    --accent-hover: #3b82f6;
    --accent-soft: rgba(96, 165, 250, 0.16);
    --ok: #4ade80;
    --ok-soft: rgba(74, 222, 128, 0.15);
    --warn: #fbbf24;
    --warn-soft: rgba(251, 191, 36, 0.15);
    --danger: #f87171;
    --danger-soft: rgba(248, 113, 113, 0.15);
    --shadow: 0 14px 36px rgba(0, 0, 0, 0.45);
  }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
button, input, textarea {
  font: inherit;
  color: inherit;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  line-height: 1.2;
  transition: background 0.12s, border-color 0.12s, opacity 0.12s;
  white-space: nowrap;
}
.btn:hover { background: var(--surface-2); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn-ghost {
  background: transparent;
  border-color: transparent;
}
.btn-ghost:hover { background: var(--surface-2); }
.btn-danger {
  color: var(--danger);
  border-color: transparent;
  background: transparent;
}
.btn-danger:hover { background: var(--danger-soft); }
.btn-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.btn-sm { padding: 5px 9px; font-size: 12px; border-radius: 7px; }
.input {
  width: 100%;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  outline: none;
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--muted);
  border: 1px solid var(--border);
}
.pill-public { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.pill-private { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.pill-accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.muted { color: var(--muted); }
.error-msg {
  color: var(--danger);
  background: var(--danger-soft);
  padding: 8px 11px;
  border-radius: 8px;
  font-size: 13px;
  margin-top: 10px;
}
.ok-msg {
  color: var(--ok);
  background: var(--ok-soft);
  padding: 8px 11px;
  border-radius: 8px;
  font-size: 13px;
  margin-top: 10px;
}
.hidden { display: none !important; }
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.52);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 100;
  backdrop-filter: blur(2px);
}
.modal {
  width: 100%;
  max-width: 440px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px;
  box-shadow: var(--shadow);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.modal-title { font-size: 16px; font-weight: 700; margin: 0; }
.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text);
  color: var(--bg);
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  z-index: 200;
  box-shadow: var(--shadow);
  pointer-events: none;
}
`;

export function renderLoginPage(input: {
  next?: string;
  heading?: string;
  subtitle?: string;
  deniedUser?: ViewerUser | null;
}): string {
  const next = input.next ?? "/";
  const heading = input.heading ?? "Sign in to artifacts.mclean.sh";
  const subtitle =
    input.subtitle ?? "Enter your email to get an 8-digit sign-in code.";
  const deniedUser = input.deniedUser ?? null;
  const boot = { next, deniedUser };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>
${BASE_CSS}
body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}
.auth-card {
  width: 100%;
  max-width: 400px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: var(--shadow);
}
.brand {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--muted);
  margin-bottom: 14px;
  display: inline-block;
  text-decoration: none;
}
h1 { font-size: 20px; margin: 0 0 6px; letter-spacing: -0.02em; }
.sub { font-size: 14px; color: var(--muted); margin: 0 0 20px; line-height: 1.45; }
label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
.code-input {
  font-family: var(--mono);
  font-size: 22px;
  letter-spacing: 5px;
  text-align: center;
  padding: 11px 12px;
}
.stack { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
</style>
</head>
<body>
<main class="auth-card">
  <a class="brand" href="/">artifacts.mclean.sh</a>
  <h1>${escapeHtml(heading)}</h1>
  <p class="sub">${escapeHtml(subtitle)}</p>
  ${
    deniedUser
      ? `<div class="stack">
          <div class="error-msg">Signed in as <strong>${escapeHtml(deniedUser.email)}</strong>, which doesn't have access to this artifact.</div>
          <div class="row" style="margin-top:6px">
            <a class="btn" href="/">Go to dashboard</a>
            <button id="switch-btn" class="btn btn-primary" type="button">Switch account</button>
          </div>
        </div>`
      : `<form id="email-form" class="stack">
          <div>
            <label for="email">Email address</label>
            <input id="email" class="input" type="email" autocomplete="email" placeholder="you@example.com" required autofocus>
          </div>
          <button id="send-btn" class="btn btn-primary" type="submit" style="padding:10px 14px">Send sign-in code</button>
        </form>
        <form id="code-form" class="stack hidden">
          <div class="ok-msg" id="code-sent-msg"></div>
          <div>
            <label for="code">8-digit code</label>
            <input id="code" class="input code-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9\\s]{8,}" maxlength="10" placeholder="00000000" required>
          </div>
          <button id="verify-btn" class="btn btn-primary" type="submit" style="padding:10px 14px">Verify &amp; sign in</button>
          <div class="row">
            <button id="back-btn" class="btn btn-ghost btn-sm" type="button">Use another email</button>
            <button id="resend-btn" class="btn btn-ghost btn-sm" type="button">Resend code</button>
          </div>
        </form>`
  }
  <div id="err" class="error-msg hidden"></div>
</main>
<script id="boot" type="application/json">${safeJson(boot)}</script>
<script>
(() => {
  const boot = JSON.parse(document.getElementById("boot").textContent);
  const errEl = document.getElementById("err");
  const showErr = (msg) => {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  };
  const clearErr = () => errEl.classList.add("hidden");

  const switchBtn = document.getElementById("switch-btn");
  if (switchBtn) {
    switchBtn.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.reload();
    });
    return;
  }

  const emailForm = document.getElementById("email-form");
  const codeForm = document.getElementById("code-form");
  const emailInput = document.getElementById("email");
  const codeInput = document.getElementById("code");
  const sendBtn = document.getElementById("send-btn");
  const verifyBtn = document.getElementById("verify-btn");
  const backBtn = document.getElementById("back-btn");
  const resendBtn = document.getElementById("resend-btn");
  const sentMsg = document.getElementById("code-sent-msg");
  let currentEmail = "";

  async function requestCode(email) {
    clearErr();
    sendBtn.disabled = true;
    resendBtn.disabled = true;
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send code");
      currentEmail = email;
      sentMsg.textContent = "We emailed an 8-digit code to " + email + ".";
      emailForm.classList.add("hidden");
      codeForm.classList.remove("hidden");
      codeInput.value = "";
      codeInput.focus();
    } catch (e) {
      showErr(e.message);
    } finally {
      sendBtn.disabled = false;
      resendBtn.disabled = false;
    }
  }

  emailForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (email) requestCode(email);
  });

  resendBtn.addEventListener("click", () => {
    if (currentEmail) requestCode(currentEmail);
  });

  backBtn.addEventListener("click", () => {
    clearErr();
    codeForm.classList.add("hidden");
    emailForm.classList.remove("hidden");
    emailInput.focus();
  });

  codeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErr();
    verifyBtn.disabled = true;
    try {
      const code = codeInput.value.replace(/\\s+/g, "");
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentEmail, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verification failed");
      let next = "/";
      if (typeof boot.next === "string" && boot.next.startsWith("/") && !boot.next.startsWith("//") && !boot.next.includes("\\\\")) {
        try {
          const parsed = new URL(boot.next, location.origin);
          if (parsed.origin === location.origin) next = parsed.pathname + parsed.search + parsed.hash;
        } catch {}
      }
      location.href = next;
    } catch (err) {
      showErr(err.message);
      verifyBtn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}

export function renderDashboardPage(input: {
  user: ViewerUser;
  artifacts: ArtifactRecord[];
}): string {
  const { user, artifacts } = input;
  const boot = { user, artifacts };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>artifacts.mclean.sh</title>
<style>
${BASE_CSS}
.topbar {
  height: 56px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand { font-weight: 700; font-size: 15px; letter-spacing: -0.02em; text-decoration: none; }
.wrap {
  max-width: 960px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}
.head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.head-row h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
.search { max-width: 280px; }
.list { display: flex; flex-direction: column; gap: 10px; }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  transition: border-color 0.12s;
}
.card:hover { border-color: var(--accent); }
.card-main { min-width: 0; flex: 1; }
.card-title {
  display: inline-block;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  margin-bottom: 6px;
  word-break: break-word;
}
.card-title:hover { color: var(--accent); }
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.card-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.empty {
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 14px;
  padding: 40px 24px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
}
.empty code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 5px;
}
@media (max-width: 640px) {
  .card { flex-direction: column; align-items: stretch; }
  .card-actions { justify-content: flex-end; }
  .search { max-width: 100%; }
}
</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">artifacts.mclean.sh</a>
  <div style="display:flex;align-items:center;gap:8px">
    <button id="profile-btn" class="btn btn-ghost btn-sm" type="button"></button>
    <button id="logout-btn" class="btn btn-sm" type="button">Sign out</button>
  </div>
</header>

<main class="wrap">
  <div class="head-row">
    <div style="display:flex;align-items:center;gap:10px">
      <h1>${user.isOwner ? "Your artifacts" : "Shared with you"}</h1>
      <span id="count-pill" class="pill"></span>
    </div>
    <input id="search" class="input search" type="search" placeholder="Filter artifacts…">
  </div>
  <div id="list" class="list"></div>
</main>

<div id="profile-modal" class="modal-backdrop hidden">
  <div class="modal">
    <div class="modal-head">
      <h2 class="modal-title">Your profile</h2>
      <button class="btn btn-ghost btn-sm" data-close="profile-modal" type="button">Close</button>
    </div>
    <form id="profile-form" style="display:flex;flex-direction:column;gap:12px">
      <div class="muted" style="font-size:13px">${escapeHtml(user.email)}</div>
      <div>
        <label for="display-name" style="display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px">Display name</label>
        <input id="display-name" class="input" type="text" maxlength="80" placeholder="Your name">
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" data-close="profile-modal" type="button">Cancel</button>
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
    </form>
  </div>
</div>

<script id="boot" type="application/json">${safeJson(boot)}</script>
<script>
(() => {
  const boot = JSON.parse(document.getElementById("boot").textContent);
  let user = boot.user;
  let artifacts = boot.artifacts || [];

  const profileBtn = document.getElementById("profile-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const listEl = document.getElementById("list");
  const countPill = document.getElementById("count-pill");
  const searchEl = document.getElementById("search");
  const profileModal = document.getElementById("profile-modal");
  const displayNameInput = document.getElementById("display-name");

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function relTime(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    const d = Math.floor(hr / 24);
    if (d < 30) return d + "d ago";
    return new Date(ms).toLocaleDateString();
  }

  function fmtBytes(n) {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderProfile() {
    profileBtn.textContent = user.name || user.email;
  }

  function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    const filtered = artifacts.filter((a) =>
      !q || a.title.toLowerCase().includes(q) || a.entry.toLowerCase().includes(q)
    );
    countPill.textContent = String(filtered.length);
    listEl.textContent = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      if (artifacts.length) {
        empty.textContent = "No artifacts match that filter.";
      } else if (user.isOwner) {
        empty.innerHTML = "No artifacts uploaded yet.<br>Upload one with <code>upload.mjs &lt;file-or-folder&gt;</code>.";
      } else {
        empty.textContent = "Nothing has been shared with " + user.email + " yet.";
      }
      listEl.appendChild(empty);
      return;
    }

    for (const a of filtered) {
      const card = document.createElement("div");
      card.className = "card";

      const main = document.createElement("div");
      main.className = "card-main";

      const title = document.createElement("a");
      title.className = "card-title";
      title.href = "/s/" + a.token + "/";
      title.textContent = a.title;
      main.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "meta";

      const vis = document.createElement("span");
      vis.className = "pill " + (a.publicLink ? "pill-public" : "pill-private");
      vis.textContent = a.publicLink ? "Anyone with link" : "Invited only";
      meta.appendChild(vis);

      if (a.openCommentCount > 0) {
        const c = document.createElement("span");
        c.className = "pill pill-accent";
        c.textContent = a.openCommentCount + (a.openCommentCount === 1 ? " open comment" : " open comments");
        meta.appendChild(c);
      } else if (a.totalCommentCount > 0) {
        const c = document.createElement("span");
        c.className = "pill";
        c.textContent = a.totalCommentCount + " comments";
        meta.appendChild(c);
      }

      if (user.isOwner && a.shareCount > 0) {
        const s = document.createElement("span");
        s.textContent = a.shareCount + (a.shareCount === 1 ? " person invited" : " people invited");
        meta.appendChild(s);
      }

      const info = document.createElement("span");
      info.textContent = a.fileCount + (a.fileCount === 1 ? " file" : " files") + " · " + fmtBytes(a.totalBytes) + " · updated " + relTime(a.updatedAt);
      meta.appendChild(info);

      main.appendChild(meta);
      card.appendChild(main);

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const copyBtn = document.createElement("button");
      copyBtn.className = "btn btn-sm";
      copyBtn.type = "button";
      copyBtn.textContent = "Copy link";
      copyBtn.addEventListener("click", async () => {
        const url = location.origin + "/s/" + a.token + "/";
        try {
          await navigator.clipboard.writeText(url);
          toast("Link copied");
        } catch {
          prompt("Share link:", url);
        }
      });
      actions.appendChild(copyBtn);

      const openLink = document.createElement("a");
      openLink.className = "btn btn-sm btn-primary";
      openLink.href = "/s/" + a.token + "/";
      openLink.textContent = "Open";
      actions.appendChild(openLink);

      if (user.isOwner) {
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-sm btn-danger";
        delBtn.type = "button";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", async () => {
          if (!confirm('Delete "' + a.title + '" and all its comments?')) return;
          const res = await fetch("/api/shares/" + a.token, { method: "DELETE" });
          if (res.ok) {
            artifacts = artifacts.filter((item) => item.token !== a.token);
            renderList();
            toast("Artifact deleted");
          } else {
            toast("Could not delete artifact");
          }
        });
        actions.appendChild(delBtn);
      }

      card.appendChild(actions);
      listEl.appendChild(card);
    }
  }

  searchEl.addEventListener("input", renderList);

  profileBtn.addEventListener("click", () => {
    displayNameInput.value = user.name || "";
    profileModal.classList.remove("hidden");
    displayNameInput.focus();
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.close).classList.add("hidden");
    });
  });

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayNameInput.value }),
    });
    if (res.ok) {
      const data = await res.json();
      user = data.user;
      renderProfile();
      profileModal.classList.add("hidden");
      toast("Profile updated");
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  });

  renderProfile();
  renderList();
})();
</script>
</body>
</html>`;
}

export function renderViewerPage(input: {
  artifact: ArtifactRecord;
  frameUrl: string;
  user: ViewerUser | null;
  shares: ShareRecord[];
  comments: CommentRecord[];
}): string {
  const { artifact, frameUrl, user, shares, comments } = input;
  const boot = { artifact, user, shares, comments };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(artifact.title)} · artifacts.mclean.sh</title>
<style>
${BASE_CSS}
html, body { height: 100%; overflow: hidden; }
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  height: 50px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 10px;
  z-index: 30;
}
.topbar-left, .topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.crumb {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  text-decoration: none;
  flex-shrink: 0;
}
.crumb:hover { color: var(--text); }
.sep { color: var(--border); user-select: none; }
.doc-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
}
.doc-title.editable { cursor: pointer; }
.doc-title.editable:hover { background: var(--surface-2); }
.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}
.stage {
  flex: 1;
  min-width: 0;
  position: relative;
  background: #ffffff;
}
#artifact-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #ffffff;
}
.pin-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  overflow: hidden;
}
.pin-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 28px;
  height: 28px;
  border-radius: 999px 999px 999px 4px;
  background: var(--accent);
  color: #ffffff;
  border: 2px solid #ffffff;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  pointer-events: auto;
  transition: transform 0.14s, background 0.14s;
  padding: 0;
}
.pin-marker:hover, .pin-marker.active {
  transform: translate(-50%, -50%) scale(1.16);
  z-index: 12;
}
.pin-marker.resolved {
  background: #6b7280;
  opacity: 0.72;
}
.pin-marker.draft {
  background: var(--warn);
  transform: translate(-50%, -50%) scale(1.15);
  z-index: 15;
}
.pin-capture {
  position: absolute;
  inset: 0;
  z-index: 14;
  cursor: crosshair;
  background: rgba(37, 99, 235, 0.04);
}
.pin-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text);
  color: var(--bg);
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  box-shadow: var(--shadow);
  z-index: 16;
  display: flex;
  align-items: center;
  gap: 10px;
}
.pin-popover {
  position: absolute;
  width: 290px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  box-shadow: var(--shadow);
  z-index: 20;
  pointer-events: auto;
}
.drawer {
  width: 360px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
  z-index: 25;
}
.drawer-head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tabs {
  display: flex;
  gap: 4px;
  background: var(--surface-2);
  padding: 3px;
  border-radius: 8px;
}
.tab {
  border: 0;
  background: transparent;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
}
.tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.thread {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 11px 12px;
  background: var(--bg);
  transition: border-color 0.14s, box-shadow 0.14s;
}
.thread.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.thread.resolved { opacity: 0.72; }
.thread-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.author-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
.pin-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  border: 0;
  cursor: pointer;
}
.thread.resolved .pin-chip { background: #6b7280; }
.author-name { font-size: 13px; font-weight: 600; }
.ts { font-size: 11px; color: var(--muted); }
.comment-body {
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.thread-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}
.replies {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reply {
  padding-left: 10px;
  border-left: 2px solid var(--border);
}
.reply-form {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.composer {
  border-top: 1px solid var(--border);
  padding: 12px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
textarea.input {
  resize: vertical;
  min-height: 68px;
  font-size: 13px;
  line-height: 1.45;
}
.share-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  max-height: 200px;
  overflow-y: auto;
}
.share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--surface-2);
  font-size: 13px;
}
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}
.radio-opt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 13px;
}
.radio-opt input { margin-top: 2px; }
@media (max-width: 820px) {
  .drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(360px, 100vw);
    box-shadow: var(--shadow);
  }
  .crumb, .sep, #vis-pill { display: none; }
  .doc-title { max-width: 140px; }
}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="topbar-left">
      <a class="crumb" href="/">artifacts</a>
      <span class="sep">/</span>
      <button id="doc-title" class="doc-title ${user?.isOwner ? "editable" : ""}" type="button" title="${user?.isOwner ? "Click to rename" : ""}">${escapeHtml(artifact.title)}</button>
      <span id="vis-pill" class="pill ${artifact.publicLink ? "pill-public" : "pill-private"}">${artifact.publicLink ? "Link" : "Private"}</span>
    </div>
    <div class="topbar-right">
      ${user?.isOwner ? '<button id="share-btn" class="btn btn-sm" type="button">Share</button>' : ""}
      <button id="pin-mode-btn" class="btn btn-sm" type="button" title="Drop a pinned comment (C)">Pin</button>
      <button id="pins-vis-btn" class="btn btn-sm btn-ghost hidden" type="button" title="Show or hide pins">Hide pins</button>
      <button id="comments-btn" class="btn btn-sm" type="button">Comments <span id="open-count" class="pill" style="margin-left:2px">0</span></button>
      <a class="btn btn-sm btn-ghost" href="${escapeHtml(frameUrl)}" target="_blank" rel="noopener" title="Open raw artifact">Raw ↗</a>
      ${
        user
          ? `<button id="user-btn" class="btn btn-sm btn-ghost" type="button">${escapeHtml(user.name || user.email)}</button>`
          : `<button id="signin-btn" class="btn btn-sm btn-primary" type="button">Sign in</button>`
      }
    </div>
  </header>

  <div class="workspace">
    <div class="stage" id="stage">
      <iframe
        id="artifact-frame"
        src="${escapeHtml(frameUrl)}"
        sandbox="allow-scripts allow-downloads allow-modals allow-forms"
        referrerpolicy="no-referrer"
        title="${escapeHtml(artifact.title)}"
      ></iframe>
      <div id="pin-layer" class="pin-layer"></div>
      <div id="pin-capture" class="pin-capture hidden">
        <div class="pin-banner">
          <span>Click anywhere on the artifact to drop a comment pin</span>
          <button id="cancel-pin-btn" class="btn btn-sm" type="button" style="padding:2px 8px">Cancel (Esc)</button>
        </div>
      </div>
      <div id="pin-popover" class="pin-popover hidden">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">New pinned comment</div>
        <textarea id="pin-body" class="input" placeholder="Leave feedback on this spot…" style="min-height:66px"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px">
          <button id="pin-discard" class="btn btn-sm" type="button">Cancel</button>
          <button id="pin-submit" class="btn btn-sm btn-primary" type="button">Post pin</button>
        </div>
      </div>
    </div>

    <aside id="drawer" class="drawer hidden">
      <div class="drawer-head">
        <div class="tabs" role="tablist">
          <button class="tab active" data-filter="open" type="button">Open</button>
          <button class="tab" data-filter="resolved" type="button">Resolved</button>
          <button class="tab" data-filter="all" type="button">All</button>
        </div>
        <button id="close-drawer" class="btn btn-ghost btn-sm" type="button">✕</button>
      </div>
      <div id="threads" class="drawer-body"></div>
      <div class="composer">
        ${
          user
            ? `<textarea id="new-comment" class="input" placeholder="Add a comment… (⌘/Ctrl+Enter to post)"></textarea>
               <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                 <span class="muted" style="font-size:11px">Or press C to drop a pin</span>
                 <button id="post-comment" class="btn btn-sm btn-primary" type="button">Comment</button>
               </div>`
            : `<div style="text-align:center;padding:4px 0">
                 <div class="muted" style="font-size:12px;margin-bottom:8px">Sign in with your email to leave comments or pins.</div>
                 <button id="composer-signin" class="btn btn-sm btn-primary" type="button">Sign in to comment</button>
               </div>`
        }
      </div>
    </aside>
  </div>
</div>

<div id="share-modal" class="modal-backdrop hidden">
  <div class="modal">
    <div class="modal-head">
      <h2 class="modal-title">Share &amp; access</h2>
      <button class="btn btn-ghost btn-sm" data-close="share-modal" type="button">Close</button>
    </div>
    <div class="radio-group">
      <label class="radio-opt">
        <input type="radio" name="access" value="public">
        <div>
          <div style="font-weight:600">Anyone with the link</div>
          <div class="muted" style="font-size:12px">Viewers can open the link directly and sign in to comment.</div>
        </div>
      </label>
      <label class="radio-opt">
        <input type="radio" name="access" value="private">
        <div>
          <div style="font-weight:600">Invited people only</div>
          <div class="muted" style="font-size:12px">Only you and emails invited below can view or comment.</div>
        </div>
      </label>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:14px">
      <input id="share-url-input" class="input" type="text" readonly style="font-size:12px;font-family:var(--mono)">
      <button id="copy-share-url" class="btn btn-sm" type="button">Copy</button>
    </div>
    <form id="invite-form" style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:6px">
        <input id="invite-email" class="input" type="email" placeholder="Invite by email…" required>
        <button id="invite-submit" class="btn btn-primary btn-sm" type="submit">Invite</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)">
        <input id="invite-notify" type="checkbox" checked> Send an invite email
      </label>
    </form>
    <div id="share-err" class="error-msg hidden"></div>
    <div id="share-list" class="share-list"></div>
  </div>
</div>

<div id="auth-modal" class="modal-backdrop hidden">
  <div class="modal">
    <div class="modal-head">
      <h2 class="modal-title">Sign in to comment</h2>
      <button class="btn btn-ghost btn-sm" data-close="auth-modal" type="button">Close</button>
    </div>
    <form id="modal-email-form" style="display:flex;flex-direction:column;gap:10px">
      <div class="muted" style="font-size:13px">We'll email you an 8-digit sign-in code.</div>
      <input id="modal-email" class="input" type="email" placeholder="you@example.com" required>
      <button id="modal-send-btn" class="btn btn-primary" type="submit">Send code</button>
    </form>
    <form id="modal-code-form" class="hidden" style="display:flex;flex-direction:column;gap:10px">
      <div id="modal-sent-msg" class="ok-msg" style="margin-top:0"></div>
      <input id="modal-code" class="input" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="8-digit code" maxlength="10" required style="font-family:var(--mono);font-size:20px;letter-spacing:4px;text-align:center">
      <button id="modal-verify-btn" class="btn btn-primary" type="submit">Verify &amp; sign in</button>
      <button id="modal-back-btn" class="btn btn-ghost btn-sm" type="button">Use another email</button>
    </form>
    <div id="modal-auth-err" class="error-msg hidden"></div>
  </div>
</div>

<div id="account-modal" class="modal-backdrop hidden">
  <div class="modal">
    <div class="modal-head">
      <h2 class="modal-title">Account</h2>
      <button class="btn btn-ghost btn-sm" data-close="account-modal" type="button">Close</button>
    </div>
    <form id="account-form" style="display:flex;flex-direction:column;gap:12px">
      <div class="muted" style="font-size:13px" id="account-email"></div>
      <div>
        <label for="account-name" style="display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px">Display name</label>
        <input id="account-name" class="input" type="text" maxlength="80">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px">
        <button id="account-logout" class="btn btn-danger btn-sm" type="button">Sign out</button>
        <button class="btn btn-primary btn-sm" type="submit">Save name</button>
      </div>
    </form>
  </div>
</div>

<script id="boot" type="application/json">${safeJson(boot)}</script>
<script>
(() => {
  const boot = JSON.parse(document.getElementById("boot").textContent);
  const token = boot.artifact.token;
  let artifact = boot.artifact;
  let user = boot.user;
  let shares = boot.shares || [];
  let comments = boot.comments || [];

  let filter = "open";
  let drawerOpen = false;
  let pinsVisible = true;
  let pinMode = false;
  let activeThreadId = null;
  let draftPin = null;

  const stage = document.getElementById("stage");
  const pinLayer = document.getElementById("pin-layer");
  const pinCapture = document.getElementById("pin-capture");
  const pinPopover = document.getElementById("pin-popover");
  const pinBodyInput = document.getElementById("pin-body");
  const drawer = document.getElementById("drawer");
  const threadsEl = document.getElementById("threads");
  const openCountEl = document.getElementById("open-count");
  const pinModeBtn = document.getElementById("pin-mode-btn");
  const pinsVisBtn = document.getElementById("pins-vis-btn");
  const commentsBtn = document.getElementById("comments-btn");
  const docTitleEl = document.getElementById("doc-title");
  const visPillEl = document.getElementById("vis-pill");

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function relTime(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    const d = Math.floor(hr / 24);
    if (d < 30) return d + "d ago";
    return new Date(ms).toLocaleDateString();
  }

  function topLevelThreads() {
    const map = new Map();
    const roots = [];
    for (const c of comments) {
      if (!c.parentId) {
        const entry = { root: c, replies: [] };
        map.set(c.id, entry);
        roots.push(entry);
      }
    }
    for (const c of comments) {
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId).replies.push(c);
      }
    }
    return roots;
  }

  function matchesFilter(c) {
    if (filter === "open") return !c.resolvedAt;
    if (filter === "resolved") return Boolean(c.resolvedAt);
    return true;
  }

  function setDrawer(open) {
    drawerOpen = open;
    drawer.classList.toggle("hidden", !open);
    commentsBtn.classList.toggle("btn-active", open);
  }

  function setPinMode(on) {
    if (on && !user) {
      openAuthModal();
      return;
    }
    pinMode = on;
    pinCapture.classList.toggle("hidden", !on);
    pinModeBtn.classList.toggle("btn-active", on);
    if (!on) clearDraftPin();
  }

  function clearDraftPin() {
    draftPin = null;
    pinPopover.classList.add("hidden");
    pinBodyInput.value = "";
    renderPins();
  }

  function renderPins() {
    pinLayer.textContent = "";
    const pinnedRoots = comments.filter(
      (c) => !c.parentId && typeof c.pinX === "number" && typeof c.pinY === "number"
    );
    pinsVisBtn.classList.toggle("hidden", pinnedRoots.length === 0);
    pinsVisBtn.textContent = pinsVisible ? "Hide pins" : "Show pins (" + pinnedRoots.length + ")";

    if (pinsVisible) {
      for (const c of pinnedRoots) {
        if (filter === "open" && c.resolvedAt) continue;
        if (filter === "resolved" && !c.resolvedAt) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pin-marker" + (c.resolvedAt ? " resolved" : "") + (activeThreadId === c.id ? " active" : "");
        btn.style.left = (c.pinX * 100) + "%";
        btn.style.top = (c.pinY * 100) + "%";
        btn.textContent = String(c.pinNumber);
        btn.title = (c.authorName || "Viewer") + ": " + c.body.slice(0, 80);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          activeThreadId = c.id;
          setDrawer(true);
          renderAll();
          const card = threadsEl.querySelector('[data-thread-id="' + c.id + '"]');
          if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        pinLayer.appendChild(btn);
      }
    }

    if (draftPin) {
      const marker = document.createElement("div");
      marker.className = "pin-marker draft";
      marker.style.left = (draftPin.x * 100) + "%";
      marker.style.top = (draftPin.y * 100) + "%";
      marker.textContent = "+";
      pinLayer.appendChild(marker);
    }
  }

  function renderThreads() {
    const roots = topLevelThreads();
    const openCount = roots.filter((t) => !t.root.resolvedAt).length;
    openCountEl.textContent = String(openCount);
    openCountEl.className = "pill" + (openCount > 0 ? " pill-accent" : "");

    const visible = roots.filter((t) => matchesFilter(t.root));
    threadsEl.textContent = "";

    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "text-align:center;padding:28px 12px;font-size:13px;line-height:1.5";
      empty.textContent =
        filter === "resolved"
          ? "No resolved threads yet."
          : "No open comments yet. Leave a note below or press C to drop a pin on the page.";
      threadsEl.appendChild(empty);
      return;
    }

    for (const { root, replies } of visible) {
      const card = document.createElement("div");
      card.className =
        "thread" +
        (root.resolvedAt ? " resolved" : "") +
        (activeThreadId === root.id ? " active" : "");
      card.dataset.threadId = root.id;

      const head = document.createElement("div");
      head.className = "thread-head";

      const authorRow = document.createElement("div");
      authorRow.className = "author-row";

      if (root.pinNumber != null) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "pin-chip";
        chip.textContent = "#" + root.pinNumber;
        chip.title = "Highlight pin on artifact";
        chip.addEventListener("click", () => {
          pinsVisible = true;
          activeThreadId = root.id;
          renderAll();
        });
        authorRow.appendChild(chip);
      }

      const name = document.createElement("span");
      name.className = "author-name";
      name.textContent = root.authorName || "Viewer";
      authorRow.appendChild(name);

      if (root.authorKind === "agent") {
        const badge = document.createElement("span");
        badge.className = "pill pill-accent";
        badge.textContent = "Agent";
        authorRow.appendChild(badge);
      }

      const ts = document.createElement("span");
      ts.className = "ts";
      ts.textContent = relTime(root.createdAt);
      authorRow.appendChild(ts);

      head.appendChild(authorRow);
      card.appendChild(head);

      const body = document.createElement("p");
      body.className = "comment-body";
      body.textContent = root.body;
      card.appendChild(body);

      if (replies.length) {
        const repliesBox = document.createElement("div");
        repliesBox.className = "replies";
        for (const r of replies) {
          const rEl = document.createElement("div");
          rEl.className = "reply";
          const rHead = document.createElement("div");
          rHead.className = "author-row";
          rHead.style.marginBottom = "3px";

          const rName = document.createElement("span");
          rName.className = "author-name";
          rName.style.fontSize = "12px";
          rName.textContent = r.authorName || "Viewer";
          rHead.appendChild(rName);

          if (r.authorKind === "agent") {
            const b = document.createElement("span");
            b.className = "pill pill-accent";
            b.textContent = "Agent";
            rHead.appendChild(b);
          }

          const rTs = document.createElement("span");
          rTs.className = "ts";
          rTs.textContent = relTime(r.createdAt);
          rHead.appendChild(rTs);

          if (r.canDelete) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "btn btn-ghost btn-sm";
            del.style.cssText = "padding:1px 5px;font-size:11px;margin-left:auto;color:var(--muted)";
            del.textContent = "Delete";
            del.addEventListener("click", () => deleteComment(r.id));
            rHead.appendChild(del);
          }

          rEl.appendChild(rHead);
          const rBody = document.createElement("p");
          rBody.className = "comment-body";
          rBody.textContent = r.body;
          rEl.appendChild(rBody);
          repliesBox.appendChild(rEl);
        }
        card.appendChild(repliesBox);
      }

      if (user) {
        const actions = document.createElement("div");
        actions.className = "thread-actions";

        const replyBtn = document.createElement("button");
        replyBtn.type = "button";
        replyBtn.className = "btn btn-ghost btn-sm";
        replyBtn.textContent = "Reply";
        actions.appendChild(replyBtn);

        const resolveBtn = document.createElement("button");
        resolveBtn.type = "button";
        resolveBtn.className = "btn btn-ghost btn-sm";
        resolveBtn.textContent = root.resolvedAt ? "Reopen" : "Resolve";
        resolveBtn.addEventListener("click", () => toggleResolve(root.id, !root.resolvedAt));
        actions.appendChild(resolveBtn);

        if (root.canDelete) {
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "btn btn-danger btn-sm";
          delBtn.style.marginLeft = "auto";
          delBtn.textContent = "Delete";
          delBtn.addEventListener("click", () => deleteComment(root.id));
          actions.appendChild(delBtn);
        }

        card.appendChild(actions);

        const replyForm = document.createElement("form");
        replyForm.className = "reply-form hidden";
        const ta = document.createElement("textarea");
        ta.className = "input";
        ta.style.minHeight = "54px";
        ta.placeholder = "Write a reply…";
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:flex-end;gap:6px";
        const cancelR = document.createElement("button");
        cancelR.type = "button";
        cancelR.className = "btn btn-sm";
        cancelR.textContent = "Cancel";
        cancelR.addEventListener("click", () => replyForm.classList.add("hidden"));
        const submitR = document.createElement("button");
        submitR.type = "submit";
        submitR.className = "btn btn-sm btn-primary";
        submitR.textContent = "Reply";
        row.appendChild(cancelR);
        row.appendChild(submitR);
        replyForm.appendChild(ta);
        replyForm.appendChild(row);
        card.appendChild(replyForm);

        replyBtn.addEventListener("click", () => {
          replyForm.classList.toggle("hidden");
          if (!replyForm.classList.contains("hidden")) ta.focus();
        });

        replyForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const text = ta.value.trim();
          if (!text) return;
          submitR.disabled = true;
          await postComment({ body: text, parentId: root.id });
          submitR.disabled = false;
        });
      }

      card.addEventListener("mouseenter", () => {
        if (root.pinNumber != null) {
          activeThreadId = root.id;
          renderPins();
        }
      });

      threadsEl.appendChild(card);
    }
  }

  function renderHeader() {
    docTitleEl.textContent = artifact.title;
    document.title = artifact.title + " · artifacts.mclean.sh";
    visPillEl.textContent = artifact.publicLink ? "Link" : "Private";
    visPillEl.className = "pill " + (artifact.publicLink ? "pill-public" : "pill-private");
  }

  function renderAll() {
    renderHeader();
    renderPins();
    renderThreads();
  }

  async function postComment(payload) {
    const res = await fetch("/api/artifacts/" + token + "/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not post comment");
      return null;
    }
    comments = data.comments || comments;
    if (data.comment) activeThreadId = data.comment.parentId || data.comment.id;
    renderAll();
    return data.comment;
  }

  async function toggleResolve(id, resolved) {
    const res = await fetch("/api/artifacts/" + token + "/comments/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.comments) {
      comments = data.comments;
      renderAll();
      toast(resolved ? "Thread resolved" : "Thread reopened");
    }
  }

  async function deleteComment(id) {
    if (!confirm("Delete this comment?")) return;
    const res = await fetch("/api/artifacts/" + token + "/comments/" + id, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.comments) {
      comments = data.comments;
      renderAll();
      toast("Comment deleted");
    }
  }

  pinModeBtn.addEventListener("click", () => setPinMode(!pinMode));
  document.getElementById("cancel-pin-btn").addEventListener("click", () => setPinMode(false));
  pinsVisBtn.addEventListener("click", () => {
    pinsVisible = !pinsVisible;
    renderPins();
  });

  pinCapture.addEventListener("click", (e) => {
    if (e.target.closest(".pin-banner")) return;
    const rect = stage.getBoundingClientRect();
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.98, Math.max(0.02, (e.clientY - rect.top) / rect.height));
    draftPin = { x, y };
    renderPins();

    const popW = 290;
    const popH = 160;
    let left = e.clientX - rect.left + 16;
    if (left + popW > rect.width - 12) left = Math.max(12, e.clientX - rect.left - popW - 16);
    let top = e.clientY - rect.top - 24;
    if (top + popH > rect.height - 12) top = Math.max(12, rect.height - popH - 12);
    if (top < 12) top = 12;

    pinPopover.style.left = left + "px";
    pinPopover.style.top = top + "px";
    pinPopover.classList.remove("hidden");
    pinBodyInput.focus();
  });

  document.getElementById("pin-discard").addEventListener("click", () => {
    clearDraftPin();
    setPinMode(false);
  });

  async function submitDraftPin() {
    if (!draftPin) return;
    const body = pinBodyInput.value.trim();
    if (!body) return;
    const btn = document.getElementById("pin-submit");
    btn.disabled = true;
    const created = await postComment({
      body,
      pinX: draftPin.x,
      pinY: draftPin.y,
      pinLabel: Math.round(stage.clientWidth) + "x" + Math.round(stage.clientHeight),
    });
    btn.disabled = false;
    if (created) {
      filter = "open";
      updateTabs();
      pinsVisible = true;
      setPinMode(false);
      setDrawer(true);
      renderAll();
      toast("Pin added");
    }
  }

  document.getElementById("pin-submit").addEventListener("click", submitDraftPin);
  pinBodyInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitDraftPin();
    }
  });

  commentsBtn.addEventListener("click", () => setDrawer(!drawerOpen));
  document.getElementById("close-drawer").addEventListener("click", () => setDrawer(false));

  function updateTabs() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.filter === filter);
    });
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      filter = tab.dataset.filter;
      updateTabs();
      renderAll();
    });
  });

  const newCommentInput = document.getElementById("new-comment");
  const postCommentBtn = document.getElementById("post-comment");
  if (postCommentBtn && newCommentInput) {
    async function submitGeneral() {
      const body = newCommentInput.value.trim();
      if (!body) return;
      postCommentBtn.disabled = true;
      const created = await postComment({ body });
      postCommentBtn.disabled = false;
      if (created) {
        newCommentInput.value = "";
        filter = "open";
        updateTabs();
        renderAll();
      }
    }
    postCommentBtn.addEventListener("click", submitGeneral);
    newCommentInput.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitGeneral();
      }
    });
  }

  if (user && user.isOwner) {
    docTitleEl.addEventListener("click", async () => {
      const next = prompt("Artifact title:", artifact.title);
      if (!next || next.trim() === artifact.title) return;
      const res = await fetch("/api/artifacts/" + token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        artifact = data.artifact;
        renderHeader();
        toast("Title updated");
      }
    });
  }

  const shareModal = document.getElementById("share-modal");
  const shareBtn = document.getElementById("share-btn");
  const shareUrlInput = document.getElementById("share-url-input");
  const shareListEl = document.getElementById("share-list");
  const shareErrEl = document.getElementById("share-err");

  function renderShares() {
    shareUrlInput.value = location.origin + "/s/" + token + "/";
    document.querySelectorAll('input[name="access"]').forEach((r) => {
      r.checked = (r.value === "public") === artifact.publicLink;
    });
    shareListEl.textContent = "";
    if (!shares.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "font-size:12px;padding:6px 2px";
      empty.textContent = "No specific people invited yet.";
      shareListEl.appendChild(empty);
      return;
    }
    for (const s of shares) {
      const row = document.createElement("div");
      row.className = "share-row";
      const info = document.createElement("div");
      info.style.minWidth = "0";
      const emailEl = document.createElement("div");
      emailEl.style.cssText = "font-weight:500;overflow:hidden;text-overflow:ellipsis";
      emailEl.textContent = s.email;
      info.appendChild(emailEl);
      row.appendChild(info);

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-danger btn-sm";
      rm.textContent = "Remove";
      rm.addEventListener("click", async () => {
        const res = await fetch(
          "/api/artifacts/" + token + "/shares/" + encodeURIComponent(s.email),
          { method: "DELETE" }
        );
        if (res.ok) {
          const data = await res.json();
          shares = data.shares || [];
          renderShares();
          toast("Removed " + s.email);
        }
      });
      row.appendChild(rm);
      shareListEl.appendChild(row);
    }
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      shareErrEl.classList.add("hidden");
      renderShares();
      shareModal.classList.remove("hidden");
    });

    document.querySelectorAll('input[name="access"]').forEach((radio) => {
      radio.addEventListener("change", async () => {
        const publicLink = radio.value === "public";
        const res = await fetch("/api/artifacts/" + token, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicLink }),
        });
        if (res.ok) {
          const data = await res.json();
          artifact = data.artifact;
          renderHeader();
          toast(publicLink ? "Anyone with the link can view" : "Restricted to invited people");
        }
      });
    });

    document.getElementById("copy-share-url").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareUrlInput.value);
        toast("Link copied");
      } catch {
        shareUrlInput.select();
      }
    });

    document.getElementById("invite-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      shareErrEl.classList.add("hidden");
      const emailInput = document.getElementById("invite-email");
      const notifyInput = document.getElementById("invite-notify");
      const btn = document.getElementById("invite-submit");
      btn.disabled = true;
      try {
        const res = await fetch("/api/artifacts/" + token + "/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: emailInput.value.trim(),
            notify: notifyInput.checked,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not invite");
        shares = data.shares || [];
        emailInput.value = "";
        renderShares();
        toast("Invited");
      } catch (err) {
        shareErrEl.textContent = err.message;
        shareErrEl.classList.remove("hidden");
      } finally {
        btn.disabled = false;
      }
    });
  }

  const authModal = document.getElementById("auth-modal");
  const modalEmailForm = document.getElementById("modal-email-form");
  const modalCodeForm = document.getElementById("modal-code-form");
  const modalAuthErr = document.getElementById("modal-auth-err");
  let authEmail = "";

  function openAuthModal() {
    modalAuthErr.classList.add("hidden");
    modalEmailForm.classList.remove("hidden");
    modalCodeForm.classList.add("hidden");
    authModal.classList.remove("hidden");
    document.getElementById("modal-email").focus();
  }

  const signinBtn = document.getElementById("signin-btn");
  const composerSigninBtn = document.getElementById("composer-signin");
  if (signinBtn) signinBtn.addEventListener("click", openAuthModal);
  if (composerSigninBtn) composerSigninBtn.addEventListener("click", openAuthModal);

  modalEmailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    modalAuthErr.classList.add("hidden");
    const email = document.getElementById("modal-email").value.trim();
    const btn = document.getElementById("modal-send-btn");
    btn.disabled = true;
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send code");
      authEmail = email;
      document.getElementById("modal-sent-msg").textContent = "Code sent to " + email + ".";
      modalEmailForm.classList.add("hidden");
      modalCodeForm.classList.remove("hidden");
      document.getElementById("modal-code").focus();
    } catch (err) {
      modalAuthErr.textContent = err.message;
      modalAuthErr.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("modal-back-btn").addEventListener("click", () => {
    modalAuthErr.classList.add("hidden");
    modalCodeForm.classList.add("hidden");
    modalEmailForm.classList.remove("hidden");
  });

  modalCodeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    modalAuthErr.classList.add("hidden");
    const btn = document.getElementById("modal-verify-btn");
    btn.disabled = true;
    try {
      const code = document.getElementById("modal-code").value.replace(/\\s+/g, "");
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Invalid code");
      location.reload();
    } catch (err) {
      modalAuthErr.textContent = err.message;
      modalAuthErr.classList.remove("hidden");
      btn.disabled = false;
    }
  });

  const accountModal = document.getElementById("account-modal");
  const userBtn = document.getElementById("user-btn");
  if (userBtn && user) {
    userBtn.addEventListener("click", () => {
      document.getElementById("account-email").textContent = user.email;
      document.getElementById("account-name").value = user.name || "";
      accountModal.classList.remove("hidden");
    });

    document.getElementById("account-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("account-name").value;
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        user = data.user;
        userBtn.textContent = user.name || user.email;
        accountModal.classList.add("hidden");
        toast("Name saved");
      }
    });

    document.getElementById("account-logout").addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.reload();
    });
  }

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.close).classList.add("hidden");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (pinMode) setPinMode(false);
      document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
      return;
    }
    if (
      e.key.toLowerCase() === "c" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")
    ) {
      e.preventDefault();
      setPinMode(!pinMode);
    }
  });

  const initialOpen = topLevelThreads().filter((t) => !t.root.resolvedAt).length;
  if (initialOpen > 0 && window.innerWidth >= 960) {
    setDrawer(true);
  }
  renderAll();
})();
</script>
</body>
</html>`;
}
