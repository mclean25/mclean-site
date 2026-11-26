import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "mclean-artifacts",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const production = stage === "prod";
    const zoneName = "mclean.sh";
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const zone = yield* Cloudflare.Zone.findZoneByName({
      accountId,
      name: zoneName,
    }).pipe(Effect.orDie);
    if (!zone) {
      return yield* Effect.die(
        new Error(`Cloudflare zone ${zoneName} was not found in this account`),
      );
    }

    const mailHost = production
      ? `mail-artifacts.${zoneName}`
      : `mail-artifacts-${stage}.${zoneName}`;
    yield* Cloudflare.Email.SendingSubdomain("Mail", {
      zoneId: zone.id,
      name: mailHost,
      previewEnabled: false,
    }).pipe(retain(production));
    const mailFrom = `sign-in@${mailHost}`;

    const sessionSecret = yield* Alchemy.Random("SessionSecret").pipe(
      Effect.map((r) => r.text),
    );
    const ownerEmail = yield* Config.String("ARTIFACT_OWNER_EMAIL").pipe(
      Config.withDefault("alex.mclean25@gmail.com"),
    );

    const files = yield* Cloudflare.R2.Bucket("Files", {
      publicAccess: false,
      domains: [],
    }).pipe(retain(production));

    const worker = yield* Cloudflare.Worker("Upload", {
      name: production ? "mclean-artifacts" : undefined,
      main: "./artifacts/worker.ts",
      domain: production ? "artifacts.mclean.sh" : undefined,
      compatibility: { date: "2026-10-03", flags: ["nodejs_compat"] },
      env: {
        FILES: files,
        STORE: Cloudflare.DurableObject("Store"),
        EMAIL: yield* Cloudflare.Email.SendEmail("EMAIL", {
          allowedSenderAddresses: [mailFrom],
        }),
        UPLOAD_TOKEN: yield* Config.Redacted("ARTIFACT_UPLOAD_TOKEN"),
        SESSION_SECRET: sessionSecret,
        OWNER_EMAIL: ownerEmail,
        MAIL_FROM: mailFrom,
        APEX_ORIGIN: production ? "https://artifacts.mclean.sh" : "",
      },
      observability: { enabled: true, traces: { enabled: true } },
    }).pipe(retain(production));

    return {
      bucketName: files.bucketName,
      url: worker.url,
      mailFrom,
    };
  }),
);
