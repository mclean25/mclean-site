---
name: upload-artifact
description: Upload a generated file or static site folder to artifacts.mclean.sh, or update an existing artifact at its current share link. Use when the user asks to publish or update a shared artifact on their personal site.
---

# Upload an artifact

Use the upload helper in this skill folder:

```sh
node <skill-directory>/scripts/upload.mjs <file-or-folder>
node <skill-directory>/scripts/upload.mjs <file-or-folder> --url <existing-share-url>
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
in the share. Old content is not retained. If the user asks to modify a shared
artifact, edit its local source, then upload it to the same URL.

Upload only the requested artifact. The helper excludes hidden files,
`node_modules`, credentials, and source maps. It rejects symbolic links.
The limit is 10 MiB of files, with at most 500 files. Inspect the upload summary
and report the returned share URL. Do not add private files to meet a build need.

Anyone with a share link can view its content. The service has no public
listing. Share links are not passwords and do not prevent a recipient from
copying the content or forwarding the link. Publish only when the user's request
authorizes sharing. Do not upload sample content merely to test this skill.

If the credential or service is unavailable, report the error. Do not change
Cloudflare infrastructure or use another hosting service as a fallback.
