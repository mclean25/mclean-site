---
name: upload-artifact
description: Upload a generated file or static site folder to artifacts.mclean.sh, update an existing artifact, manage access/shares, or read and reply to viewer comments. Use when the user asks to publish, update, share, or check feedback on a shared artifact on their personal site.
---

# Upload & manage artifacts

Use the helper in this skill folder:

```sh
# Upload or update an artifact
node <skill-directory>/scripts/upload.mjs <file-or-folder> [--title "Title"] [--private | --public] [--share user@example.com]
node <skill-directory>/scripts/upload.mjs <file-or-folder> --url <existing-share-url>

# List all artifacts with comment & share counts
node <skill-directory>/scripts/upload.mjs --list

# Read, reply to, and resolve viewer comments
node <skill-directory>/scripts/upload.mjs --comments --url <share-url>
node <skill-directory>/scripts/upload.mjs --reply <comment-id> "Fixed in latest version" --url <share-url>
node <skill-directory>/scripts/upload.mjs --resolve <comment-id> --url <share-url>

# Update sharing or visibility without re-uploading
node <skill-directory>/scripts/upload.mjs --private --share colleague@example.com --url <share-url>
node <skill-directory>/scripts/upload.mjs --unshare colleague@example.com --url <share-url>
```

The service accepts files such as HTML, PDF, images, and documents. For a
static site folder, use relative asset links and put `index.html` at its root.
Use `--entry <relative-path>` for another entry file. Build framework projects
first, then upload their static output folder. This service does not run servers.

The helper reads the upload credential from
`~/.config/mclean-artifacts/config.json`. Do not print or copy this credential.
It uses a separate service credential, not the Cloudflare deployment token.

The helper saves share links outside the project. Uploading the same local
path again updates its saved link. Use `--url` when the source path changes,
or `--new` when the user requests a separate share. Updates replace all files
in the share while preserving comments and share settings. If the user asks to
modify a shared artifact, edit its local source, then upload it to the same URL.

Upload only the requested artifact. The helper excludes hidden files,
`node_modules`, credentials, and source maps. It rejects symbolic links.
The limit is 10 MiB of files, with at most 500 files. Inspect the upload summary
and report the returned share URL. Do not add private files to meet a build need.

By default, new artifacts are link-accessible (anyone with the link can view,
and viewers sign in with an emailed 8-digit code to comment or drop pins). Use
`--private` with `--share <email>` to restrict an artifact to the owner and
invited email addresses. Publish only when the user's request authorizes
sharing. Do not upload sample content merely to test this skill.

If the credential or service is unavailable, report the error. Do not change
Cloudflare infrastructure or use another hosting service as a fallback.
