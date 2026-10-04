import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";

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
    const shares = yield* Cloudflare.D1.Database("Shares").pipe(
      retain(production),
    );

    return { bucketName: files.bucketName, databaseId: shares.databaseId };
  }),
);
