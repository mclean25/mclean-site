# mclean-site

My custom site built in Astro.

Deployed to Cloudflare Workers with Alchemy.

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
