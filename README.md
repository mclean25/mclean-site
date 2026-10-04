# mclean-site

My custom site built in Astro.

Deployed to Cloudflare Workers with Alchemy. The existing Astro build and
Cloudflare adapter remain in use. Alchemy uploads the built Worker modules
without bundling them again, together with the static assets.

## Local checks

Use Node.js 22+ and pnpm 10.30.1.

```sh
pnpm install --frozen-lockfile
pnpm check:infra
pnpm build
```

`public/.assetsignore` excludes the server modules and `_routes.json` from
public asset uploads. Keep this file when changing the build.

## Deployments

Authenticate `cf` with your personal Cloudflare account, then run:

```sh
pnpm plan:prod
pnpm deploy:prod
```

Production adopts the existing `mclean-site` Worker and its `mclean.sh` custom
domain in personal account `047bcbcd59993fa5786809f87ce770a0`. The
production Worker is retained if the stack is removed. Alchemy stores deployment
state in Cloudflare; retain that state so later deploys update the same resources.
The deployment helper uses the `mclean` Alchemy profile and checks the account
before deployment. It reads your active `cf` OAuth credentials into process
memory. CI uses `CLOUDFLARE_API_TOKEN` instead. Set `CF_PROFILE` to select a
named `cf` profile. No credential is copied into this repository.

`pnpm run plan --stage preview` and `pnpm run deploy --stage preview` use a separate
Worker name. They do not adopt the production Worker.

## Switch from Cloudflare's GitHub integration

The production site now uses Alchemy. The live page checks passed, and the
next production plan reported no changes. The Cloudflare GitHub integration
is disconnected. The GitHub production token and deployment settings are
configured. The token passed a production plan check with a new local state
cache. Automatic deployment starts when the workflow is added to `main`.

1. Confirm the Cloudflare account, Worker name, custom domains, routes, bindings,
   and environment settings. The local Wrangler cache is not proof of ownership.
2. Authenticate Alchemy in that account and inspect `pnpm plan:prod`. Resolve
   any settings differences before deployment. The first plan may require
   bootstrapping Alchemy's state store.
3. Deploy and check the home page, posts, project page, and Christmas redirect
   on `mclean.sh`.
4. Disable the existing Cloudflare Workers Builds trigger for this repository.
5. Set the GitHub production environment secret `CLOUDFLARE_API_TOKEN` and
   variable `CLOUDFLARE_ACCOUNT_ID`. Use an account-scoped deployment token with
   the permissions required by the Alchemy plan and state store.
6. Set repository variable `ALCHEMY_DEPLOY_ENABLED` to `true`. Run the deployment
   workflow manually once. Later pushes to `main` deploy through Alchemy.

The GitHub Actions deployment stays disabled until step 6. Use
`pnpm deploy:prod` for manual deployments. `wrangler.jsonc` remains available
for the existing build and deployment fallback.

To roll back the deployment workflow, set `ALCHEMY_DEPLOY_ENABLED` to `false`
and restore the previous Cloudflare build trigger. Revert Worker code with a
Cloudflare deployment rollback if needed; retain Alchemy's state.

## Artifact service

`infra/artifacts.run.ts` defines a separate stack for the private R2 bucket and
D1 database. `pnpm plan:artifacts` inspects it. Production storage is retained
if that stack is removed. This stack is not deployed by the site workflow.

The artifact Worker, upload API, CLI, and agent skill still need implementation.
No artifact hostname is attached yet. Artifact uploads will use the service API,
not an infrastructure deployment. Site changes and artifact content updates
therefore have independent workflows.
