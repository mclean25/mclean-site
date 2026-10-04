import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, basename, join, extname } from "node:path";

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

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    console.log(
      "Usage: node upload.mjs <file-or-folder> [--url <share-url>] [--entry <path>] [--new]",
    );
    return;
  }
  const source = resolve(args.shift());
  if (basename(source).startsWith(".") || /\.(pem|key|p12|pfx)$/i.test(source))
    throw new Error("Do not upload hidden files or credential files");
  let shareUrl,
    entry,
    fresh = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--new") fresh = true;
    else if (flag === "--url" && args.length) shareUrl = args.shift();
    else if (flag === "--entry" && args.length) entry = args.shift();
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  if (fresh && shareUrl) throw new Error("Use either --new or --url");
  const configDir = join(homedir(), ".config", "mclean-artifacts");
  const config = JSON.parse(
    await readFile(join(configDir, "config.json"), "utf8"),
  );
  const endpoint = "https://artifacts.mclean.sh";
  if (!config.uploadToken) throw new Error("The upload credential is missing");
  let shares = {};
  try {
    shares = JSON.parse(await readFile(join(configDir, "shares.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!shareUrl && !fresh) shareUrl = shares[source];
  let token;
  if (shareUrl) {
    const url = new URL(shareUrl);
    const match = url.pathname.match(/^\/s\/([a-f0-9]{64})\/?$/);
    if (url.origin !== endpoint || url.search || url.hash || !match)
      throw new Error("Use an artifacts.mclean.sh share URL");
    token = match[1];
  } else token = randomBytes(32).toString("hex");

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
  const body = JSON.stringify({ entry, files });
  if (Buffer.byteLength(body) > 16 * 1024 * 1024)
    throw new Error("Upload exceeds 16 MiB");
  const response = await fetch(`${endpoint}/api/shares/${token}`, {
    method: "PUT",
    redirect: "error",
    signal: AbortSignal.timeout(120000),
    headers: {
      Authorization: `Bearer ${config.uploadToken}`,
      "Content-Type": "application/json",
      ...(!shareUrl ? { "If-None-Match": "*" } : {}),
    },
    body,
  });
  if (!response.ok)
    throw new Error(
      `Upload failed (${response.status}): ${await response.text()}`,
    );
  const result = await response.json();
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
  console.error(error.message);
  process.exitCode = 1;
});
