import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";

export default Alchemy.Stack(
  "mclean-artifacts",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const production = stage === "prod";
    const files = yield* Cloudflare.R2.Bucket("Files", {
      publicAccess: false,
      domains: [],
    }).pipe(retain(production));
    const worker = yield* Cloudflare.Worker("Upload", {
      name: production ? "mclean-artifacts" : undefined,
      main: "./artifacts/worker.mjs",
      domain: production ? "artifacts.mclean.sh" : undefined,
      compatibility: { date: "2026-10-03", flags: ["nodejs_compat"] },
      env: {
        FILES: files,
        UPLOAD_TOKEN: Config.Redacted("ARTIFACT_UPLOAD_TOKEN"),
      },
      observability: { enabled: true, traces: { enabled: true } },
    }).pipe(retain(production));

    return { bucketName: files.bucketName, url: worker.url };
  }),
);
