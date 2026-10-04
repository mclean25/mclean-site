import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const accountId = "047bcbcd59993fa5786809f87ce770a0";
const env = { ...process.env };

try {
  if (
    process.argv.includes("infra/artifacts.run.ts") &&
    !env.ARTIFACT_UPLOAD_TOKEN
  ) {
    const config = JSON.parse(
      await readFile(
        join(homedir(), ".config", "mclean-artifacts", "config.json"),
        "utf8",
      ),
    );
    if (!config.uploadToken)
      throw new Error("The artifact upload credential is missing.");
    env.ARTIFACT_UPLOAD_TOKEN = config.uploadToken;
  }
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== accountId) {
    throw new Error(
      "This stack must deploy to the personal Cloudflare account.",
    );
  }
  env.CLOUDFLARE_ACCOUNT_ID = accountId;

  if (!env.CLOUDFLARE_API_TOKEN) {
    const args = ["auth", "whoami"];
    if (env.CF_PROFILE) args.push("--profile", env.CF_PROFILE);
    const identity = JSON.parse(
      execFileSync("cf", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    if (
      !identity.tokenValid ||
      !identity.accounts?.some(({ id }) => id === accountId)
    ) {
      throw new Error(
        "Authenticate cf with the personal Cloudflare account first.",
      );
    }
    const source = identity.authSource?.match(/^OAuth token from (.+)$/)?.[1];
    if (!source) {
      throw new Error("Use a cf OAuth login or set CLOUDFLARE_API_TOKEN.");
    }
    const credentials = JSON.parse(await readFile(source, "utf8"));
    if (
      !credentials.oauth_token ||
      Date.parse(credentials.expiration_time) <= Date.now()
    ) {
      throw new Error("Refresh the cf login before deploying.");
    }
    // Keep the token in process memory. Do not copy it into project files.
    env.CLOUDFLARE_API_TOKEN = credentials.oauth_token;
  }

  const child = spawn(
    "pnpm",
    ["exec", "alchemy", ...process.argv.slice(2), "--profile", "mclean"],
    { env, stdio: "inherit" },
  );
  child.on("error", () => {
    console.error(
      "Could not start Alchemy. Install the project dependencies first.",
    );
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
