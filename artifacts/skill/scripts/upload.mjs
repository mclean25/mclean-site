import { randomBytes } from "node:crypto";
import { lookup, resolve4 } from "node:dns";
import { request } from "node:https";
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, basename, join, extname } from "node:path";

const ENDPOINT = "https://artifacts.mclean.sh";

function apiRequest(method, url, headers, body = null) {
  return new Promise((resolvePromise, reject) => {
    const reqHeaders = { ...headers };
    if (body !== null) {
      reqHeaders["Content-Length"] = Buffer.byteLength(body);
    }
    const connection = request(
      url,
      {
        method,
        headers: reqHeaders,
        signal: AbortSignal.timeout(120000),
        lookup(host, options, callback) {
          lookup(host, options, (error, address, family) => {
            if (!error || error.code !== "ENOTFOUND") {
              callback(error, address, family);
              return;
            }
            resolve4(host, (dnsError, addresses) => {
              if (dnsError || !addresses?.length) {
                callback(dnsError ?? error);
                return;
              }
              console.log(
                "System DNS lookup failed. Using a direct DNS query.",
              );
              callback(
                null,
                options.all
                  ? addresses.map((addr) => ({ address: addr, family: 4 }))
                  : addresses[0],
                4,
              );
            });
          });
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            response.destroy(new Error("API response is too large"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(`Request failed (${response.statusCode}): ${text}`),
            );
            return;
          }
          if (!text) {
            resolvePromise(null);
            return;
          }
          try {
            resolvePromise(JSON.parse(text));
          } catch {
            reject(new Error("The service returned an invalid JSON response"));
          }
        });
      },
    );
    connection.on("error", reject);
    if (body !== null) connection.end(body);
    else connection.end();
  });
}

const types = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function parseShareToken(shareUrl) {
  const url = new URL(shareUrl);
  const match = url.pathname.match(/^\/s\/([a-f0-9]{64})\/?$/);
  if (url.origin !== ENDPOINT || url.search || url.hash || !match) {
    throw new Error("Use an artifacts.mclean.sh share URL");
  }
  return match[1];
}

function printUsage() {
  console.log(`Usage:
  Upload or update:
    node upload.mjs <file-or-folder> [--url <share-url>] [--entry <path>] [--new]
                    [--title <title>] [--private | --public] [--share <email>]... [--no-notify]

  List artifacts:
    node upload.mjs --list

  Manage an existing artifact (without re-uploading):
    node upload.mjs --comments --url <share-url>
    node upload.mjs --comment <text> --url <share-url>
    node upload.mjs --reply <comment-id> <text> --url <share-url>
    node upload.mjs --resolve <comment-id> --url <share-url>
    node upload.mjs --reopen <comment-id> --url <share-url>
    node upload.mjs --share <email> [--no-notify] --url <share-url>
    node upload.mjs --unshare <email> --url <share-url>
    node upload.mjs --private | --public [--title <title>] --url <share-url>
    node upload.mjs --delete --url <share-url>`);
}

function printComments(comments) {
  if (!comments.length) {
    console.log("No comments.");
    return;
  }
  const byParent = new Map();
  const roots = [];
  for (const c of comments) {
    if (!c.parentId) {
      roots.push(c);
      byParent.set(c.id, []);
    }
  }
  for (const c of comments) {
    if (c.parentId && byParent.has(c.parentId)) {
      byParent.get(c.parentId).push(c);
    }
  }
  for (const root of roots) {
    const status = root.resolvedAt ? "RESOLVED" : "OPEN";
    const pin =
      root.pinNumber != null
        ? ` [Pin #${root.pinNumber} @ ${Math.round(root.pinX * 100)}%,${Math.round(root.pinY * 100)}%]`
        : "";
    const kind = root.authorKind === "agent" ? " (Agent)" : "";
    console.log(
      `[${status}] ${root.id}${pin} — ${root.authorName}${kind} <${root.authorEmail}> (${new Date(root.createdAt).toISOString()})`,
    );
    console.log(`  ${root.body.replace(/\n/g, "\n  ")}`);
    for (const r of byParent.get(root.id) || []) {
      const rKind = r.authorKind === "agent" ? " (Agent)" : "";
      console.log(
        `  ↳ ${r.id} — ${r.authorName}${rKind} <${r.authorEmail}> (${new Date(r.createdAt).toISOString()})`,
      );
      console.log(`    ${r.body.replace(/\n/g, "\n    ")}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  let sourceArg = null;
  let shareUrl = null;
  let entry = null;
  let title = null;
  let publicLink = null;
  let fresh = false;
  let listMode = false;
  let commentsMode = false;
  let deleteMode = false;
  let commentText = null;
  let replyTarget = null;
  let replyText = null;
  let resolveId = null;
  let reopenId = null;
  let notify = true;
  const shareEmails = [];
  const unshareEmails = [];

  while (args.length) {
    const arg = args.shift();
    if (arg === "--new") fresh = true;
    else if (arg === "--list") listMode = true;
    else if (arg === "--comments") commentsMode = true;
    else if (arg === "--delete") deleteMode = true;
    else if (arg === "--private") publicLink = false;
    else if (arg === "--public") publicLink = true;
    else if (arg === "--no-notify") notify = false;
    else if (arg === "--url" && args.length) shareUrl = args.shift();
    else if (arg === "--entry" && args.length) entry = args.shift();
    else if (arg === "--title" && args.length) title = args.shift();
    else if (arg === "--share" && args.length) shareEmails.push(args.shift());
    else if (arg === "--unshare" && args.length) unshareEmails.push(args.shift());
    else if (arg === "--comment" && args.length) commentText = args.shift();
    else if (arg === "--reply" && args.length >= 2) {
      replyTarget = args.shift();
      replyText = args.shift();
    } else if (arg === "--resolve" && args.length) resolveId = args.shift();
    else if (arg === "--reopen" && args.length) reopenId = args.shift();
    else if (!arg.startsWith("--") && !sourceArg) sourceArg = arg;
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }

  if (fresh && shareUrl) throw new Error("Use either --new or --url");

  const configDir = join(homedir(), ".config", "mclean-artifacts");
  const config = JSON.parse(
    await readFile(join(configDir, "config.json"), "utf8"),
  );
  if (!config.uploadToken) throw new Error("The upload credential is missing");
  const authHeaders = { Authorization: `Bearer ${config.uploadToken}` };

  // --- List artifacts ---
  if (listMode) {
    const data = await apiRequest("GET", `${ENDPOINT}/api/artifacts`, authHeaders);
    const items = data?.artifacts || [];
    if (!items.length) {
      console.log("No artifacts.");
      return;
    }
    for (const a of items) {
      const vis = a.publicLink ? "link" : "private";
      console.log(
        `${ENDPOINT}/s/${a.token}/  [${vis}]  "${a.title}"  (${a.openCommentCount ?? 0} open comments, ${a.shareCount ?? 0} invited)`,
      );
    }
    return;
  }

  // --- Management actions on an existing share URL without file upload ---
  const managementOnly =
    !sourceArg &&
    (commentsMode ||
      deleteMode ||
      commentText !== null ||
      replyTarget !== null ||
      resolveId !== null ||
      reopenId !== null ||
      shareEmails.length > 0 ||
      unshareEmails.length > 0 ||
      title !== null ||
      publicLink !== null);

  if (managementOnly) {
    if (!shareUrl) throw new Error("Provide --url <share-url>");
    const token = parseShareToken(shareUrl);

    if (deleteMode) {
      await apiRequest("DELETE", `${ENDPOINT}/api/shares/${token}`, authHeaders);
      console.log("Deleted.");
      return;
    }

    if (title !== null || publicLink !== null) {
      const patch = {};
      if (title !== null) patch.title = title;
      if (publicLink !== null) patch.publicLink = publicLink;
      const res = await apiRequest(
        "PATCH",
        `${ENDPOINT}/api/artifacts/${token}`,
        { ...authHeaders, "Content-Type": "application/json" },
        JSON.stringify(patch),
      );
      console.log(
        `Updated: "${res.artifact.title}" (${res.artifact.publicLink ? "link" : "private"})`,
      );
    }

    for (const email of shareEmails) {
      await apiRequest(
        "POST",
        `${ENDPOINT}/api/artifacts/${token}/shares`,
        { ...authHeaders, "Content-Type": "application/json" },
        JSON.stringify({ email, notify }),
      );
      console.log(`Shared with ${email}`);
    }

    for (const email of unshareEmails) {
      await apiRequest(
        "DELETE",
        `${ENDPOINT}/api/artifacts/${token}/shares/${encodeURIComponent(email)}`,
        authHeaders,
      );
      console.log(`Removed ${email}`);
    }

    if (commentText !== null) {
      const res = await apiRequest(
        "POST",
        `${ENDPOINT}/api/artifacts/${token}/comments`,
        { ...authHeaders, "Content-Type": "application/json" },
        JSON.stringify({ body: commentText }),
      );
      console.log(`Posted comment ${res.comment.id}`);
    }

    if (replyTarget !== null) {
      const res = await apiRequest(
        "POST",
        `${ENDPOINT}/api/artifacts/${token}/comments`,
        { ...authHeaders, "Content-Type": "application/json" },
        JSON.stringify({ parentId: replyTarget, body: replyText }),
      );
      console.log(`Posted reply ${res.comment.id}`);
    }

    if (resolveId !== null) {
      await apiRequest(
        "PATCH",
        `${ENDPOINT}/api/artifacts/${token}/comments/${encodeURIComponent(resolveId)}`,
        { ...authHeaders, "Content-Type": "application/json" },
        JSON.stringify({ resolved: true }),
      );
      console.log(`Resolved ${resolveId}`);
    }

    if (reopenId !== null) {
      await apiRequest(
        "PATCH",
        `${ENDPOINT}/api/artifacts/${token}/comments/${encodeURIComponent(reopenId)}`,
        { ...authHeaders, "Content-Type": "application/json" },
        JSON.stringify({ resolved: false }),
      );
      console.log(`Reopened ${reopenId}`);
    }

    if (commentsMode) {
      const data = await apiRequest(
        "GET",
        `${ENDPOINT}/api/artifacts/${token}/comments`,
        authHeaders,
      );
      printComments(data?.comments || []);
    }
    return;
  }

  // --- File / folder upload ---
  if (!sourceArg) {
    printUsage();
    throw new Error("Provide a file or folder to upload");
  }

  const source = resolve(sourceArg);
  if (basename(source).startsWith(".") || /\.(pem|key|p12|pfx)$/i.test(source))
    throw new Error("Do not upload hidden files or credential files");

  let shares = {};
  try {
    shares = JSON.parse(await readFile(join(configDir, "shares.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!shareUrl && !fresh) shareUrl = shares[source];

  const token = shareUrl
    ? parseShareToken(shareUrl)
    : randomBytes(32).toString("hex");

  const files = [];
  let total = 0;
  async function collect(path, relative) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error(`Symbolic link is not allowed: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (
          name.startsWith(".") ||
          name === "node_modules" ||
          name.endsWith(".map") ||
          /\.(pem|key|p12|pfx)$/i.test(name)
        )
          continue;
        await collect(
          join(path, name),
          relative ? `${relative}/${name}` : name,
        );
      }
    } else if (stat.isFile()) {
      if (stat.size + total > 10 * 1024 * 1024 || files.length >= 500)
        throw new Error("Artifact exceeds 10 MiB or 500 files");
      const data = await readFile(path);
      total += data.byteLength;
      if (total > 10 * 1024 * 1024) throw new Error("Artifact exceeds 10 MiB");
      files.push({
        path: relative,
        type: types[extname(path).toLowerCase()] ?? "application/octet-stream",
        data: data.toString("base64"),
      });
    } else throw new Error(`Unsupported file: ${relative}`);
  }

  const stat = await lstat(source);
  await collect(source, stat.isDirectory() ? "" : basename(source));
  entry ??= stat.isDirectory() ? "index.html" : basename(source);
  if (!files.some((file) => file.path === entry))
    throw new Error(`Entry file is missing: ${entry}`);

  console.log(
    `${shareUrl ? "Update" : "Upload"}: ${files.length} files, ${total} bytes`,
  );

  const payload = {
    entry,
    files,
    ...(title !== null ? { title } : !shareUrl ? { title: basename(source) } : {}),
    ...(publicLink !== null ? { publicLink } : {}),
    ...(shareEmails.length ? { shares: shareEmails, notify } : {}),
  };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 16 * 1024 * 1024)
    throw new Error("Upload exceeds 16 MiB");

  const result = await apiRequest(
    "PUT",
    `${ENDPOINT}/api/shares/${token}`,
    {
      ...authHeaders,
      "Content-Type": "application/json",
      ...(!shareUrl ? { "If-None-Match": "*" } : {}),
    },
    body,
  );

  shares[source] = result.url;
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(configDir, "shares.json"),
    JSON.stringify(shares, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(result.url);
}

main().catch((error) => {
  console.error(`${error.message}${error.code ? ` (${error.code})` : ""}`);
  process.exitCode = 1;
});
