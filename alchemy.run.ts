import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "mclean-site",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const production = stage === "prod";

    const site = yield* Cloudflare.Worker("Site", {
      name: production ? "mclean-site" : undefined,
      main: "./dist/_worker.js/index.js",
      bundle: false,
      compatibility: {
        date: "2025-11-19",
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      assets: { directory: "./dist" },
      domain: production ? "mclean.sh" : undefined,
      observability: { enabled: true, traces: { enabled: true } },
    }).pipe(adopt(production), retain(production));

    return { siteUrl: site.url, workerName: site.workerName };
  }),
);
