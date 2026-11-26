import type { Env } from "./types.ts";

const PRODUCT = "artifacts.mclean.sh";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function isTestAddress(email: string): boolean {
  return /^[^\s@]+@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|invalid|example))$/i.test(
    email,
  );
}

function escapeHtml(str: string): string {
  return str.replace(
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

function apexOf(env: Env, fallbackOrigin?: string): string {
  return (
    env.APEX_ORIGIN ||
    fallbackOrigin ||
    "https://artifacts.mclean.sh"
  ).replace(/\/+$/, "");
}

function layout(input: {
  apex: string;
  title: string;
  preheader: string;
  body: string;
  footer: string;
}): string {
  const css = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
.page{background:#0b0d12!important}
.card{background:#141821!important;border-color:#262c3a!important}
.text,.brand{color:#f3f4f6!important}
.muted,.muted a{color:#9ca3af!important}
.codebox{background:#1c2230!important;border-color:#303a52!important}
.code{color:#f9fafb!important}
}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${escapeHtml(input.title)}</title>
<style>${css}</style>
</head>
<body class="page" style="margin:0;padding:0;background:#f5f6f8;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f6f8" style="background:#f5f6f8">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:460px;font-family:${FONT}">
<tr><td style="padding:0 6px 18px">
<a href="${escapeHtml(input.apex)}" target="_blank" class="brand" style="text-decoration:none;font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#111827">${PRODUCT}</a>
</td></tr>
<tr><td class="card" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:28px 28px 22px">
${input.body}
</td></tr>
<tr><td class="muted" style="padding:18px 6px 0;font-size:12px;line-height:18px;color:#6b7280">
${escapeHtml(input.footer)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

async function deliver(
  env: Env,
  to: string,
  message: { subject: string; text: string; html: string },
): Promise<{ skipped: boolean }> {
  if (isTestAddress(to)) return { skipped: true };
  if (!env.EMAIL || typeof env.EMAIL.send !== "function") {
    throw new Error("Email sending is not configured");
  }
  await env.EMAIL.send({
    from: {
      name: PRODUCT,
      email: env.MAIL_FROM || "sign-in@mail-artifacts.mclean.sh",
    },
    to,
    ...message,
  });
  return { skipped: false };
}

export async function sendLoginCode(
  env: Env,
  to: string,
  code: string,
  origin?: string,
): Promise<{ skipped: boolean }> {
  const digits = code.replace(/\s+/g, "");
  const subject = `${digits} is your ${PRODUCT} sign-in code`;
  const lead = `Enter this code to sign in to ${PRODUCT}. It works once and expires in 10 minutes.`;
  const ignore =
    "If you didn't request this code, you can safely ignore this email.";
  const footer = `You received this because someone requested a sign-in code for ${PRODUCT}.`;
  const text = `Your ${PRODUCT} sign-in code is ${digits}\n\n${lead}\n\n${ignore}\n`;
  const body = `
<h1 class="text" style="margin:0 0 10px;font-size:19px;line-height:26px;font-weight:700;color:#111827">Your sign-in code</h1>
<p class="text" style="margin:0 0 18px;font-size:15px;line-height:22px;color:#374151">${escapeHtml(lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px">
<tr><td class="codebox" align="center" bgcolor="#f3f4f6" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:16px 12px">
<span class="code" style="font-family:${MONO};font-size:30px;line-height:38px;font-weight:600;letter-spacing:5px;padding-left:5px;font-variant-numeric:tabular-nums;color:#111827">${escapeHtml(digits)}</span>
</td></tr>
</table>
<p class="muted" style="margin:0;font-size:13px;line-height:20px;color:#6b7280">${escapeHtml(ignore)}</p>`;
  const html = layout({
    apex: apexOf(env, origin),
    title: subject,
    preheader: `${digits} is your sign-in code. Expires in 10 minutes.`,
    body,
    footer,
  });
  return deliver(env, to, { subject, text, html });
}

export async function sendShareInvite(
  env: Env,
  to: string,
  input: { title: string; url: string; sharedBy?: string | null },
  origin?: string,
): Promise<{ skipped: boolean }> {
  const who = input.sharedBy || "Alex";
  const subject = `${who} shared "${input.title}" with you`;
  const intro = `${who} shared "${input.title}" with you on ${PRODUCT}. Sign in with this email address to view and comment.`;
  const footer = `You received this because ${who} shared an artifact with ${to}.`;
  const text = `${intro}\n\nOpen artifact: ${input.url}\n`;
  const body = `
<h1 class="text" style="margin:0 0 10px;font-size:19px;line-height:26px;font-weight:700;color:#111827">${escapeHtml(input.title)}</h1>
<p class="text" style="margin:0 0 20px;font-size:15px;line-height:22px;color:#374151">${escapeHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#111827" style="border-radius:8px;background:#111827">
<a href="${escapeHtml(input.url)}" target="_blank" style="display:inline-block;padding:11px 18px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Open artifact</a>
</td></tr></table>`;
  const html = layout({
    apex: apexOf(env, origin),
    title: subject,
    preheader: intro,
    body,
    footer,
  });
  return deliver(env, to, { subject, text, html });
}
