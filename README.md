# Sweet Hope Bakery

E-commerce site for a bakery in Arlington, VA. Converted from a hand-written PHP 8.3 / Apache app to client-side JavaScript on Cloudflare Pages. Built with Claude as a development tool — I own the architecture and review every line.

https://www.sweethopebakeryy.com

## From PHP to JS

The original was a LAMP stack: server-rendered PHP, Apache routing, direct MySQL/S3/SES calls. The rewrite eliminates the server. Static HTML + ES6 modules handle rendering. Server-side work (Stripe, AWS, auth) runs as Cloudflare Pages Functions — small serverless endpoints that only exist where secrets or trust are required.

No framework, no bundler, no build step. The browser loads ES6 modules directly.

## How It Fits Together

Each page has a script in `src/js/pages/` that runs on `DOMContentLoaded`:
1. Inject header/footer from `src/js/components/`
2. Fetch data from `/api/get-data` (Cloudflare KV)
3. Render page content
4. `initShared()` runs last — attaches scroll animations and image sliders to the now-present DOM

Core modules (`src/js/modules/`) handle cart state, auth tokens, and data fetching. Stripe and AWS client wrappers call `/api/*` endpoints. Reusable UI components live in `src/js/components/`.

## Data + Caching

All content lives in Cloudflare KV. No static JSON files, no database server.

```
Admin edit  →  POST /api/save-data (writes KV)  →  CDN cache purge
Page load   →  GET /api/get-data (reads KV)      →  edge-cached 24h
```

Writes trigger a `purge_everything` against the Cloudflare zone API. Next read hits KV fresh, CDN caches it again. Static assets (JS, CSS, images) are cached aggressively at the edge and invalidated on deploy.

## Security

The browser is untrusted. All sensitive operations stay server-side:

- **Pricing** — Checkout sessions are created server-side from KV prices, not client-submitted totals
- **Payments** — Stripe verification and order emails run server-side only
- **Auth** — Admin JWT via PBKDF2 password verification, stored in `sessionStorage`, verified on every write endpoint
- **Data reads are public** — intentionally, since the data is already visible on the site. Enables CDN caching without auth overhead
- **Secrets** — Stripe/AWS keys and JWT secret are Cloudflare environment secrets, never exposed to the client
- **Validation** — KV table names allowlisted, S3 keys validated against path traversal, HTML escaped in mail rendering

## Local Dev

```bash
npm run dev                    # static files at localhost:8080
npx wrangler pages dev src     # with Pages Functions + KV
```

## Admin Authentication

Configure `ADMIN_PASSWORD_HASH` as a Cloudflare Pages secret using the project's PBKDF2-SHA256 format. Generate the hash through your approved private deployment tooling or password-management workflow; never commit the password or hash to the repository.

## Luna Cloud Agent

The Customize page submits requests through Cloudflare Pages to a Durable Object relay. The relay dispatches a GitHub Actions workflow, which starts a fresh GitHub-hosted Linux runner, checks out `main`, and runs Codex with `gpt-6-luna`. Once the request finishes, the runner commits only the changed files and pushes directly to `main`, which deploys the website. The VM is discarded at the end of the workflow. Since this repository is public, [GitHub-hosted standard runners are free](https://docs.github.com/en/billing/concepts/product-billing/github-actions); Cloudflare's existing Pages and Durable Object relay remain the always-available control plane.

The task prompt stays in the Durable Object while the runner starts and is delivered over the authenticated WebSocket. It is not included in the GitHub workflow dispatch or runner logs. Each task result is retained for up to 15 minutes, including after later tasks start. The ChatGPT-plan Codex credential is stored as a Cloudflare Worker secret for initial provisioning and as Durable Object state after the first run; the runner collects valid refreshed credentials after both successful and failed Codex runs, then waits for the relay to acknowledge durable storage before it is discarded. A repository-scoped GitHub token dispatches the workflow from the Worker and authenticates Luna's direct push from the temporary runner. The checkout stores the write credential in the job's local Git config so Luna can commit and push to `main`; the runner verifies that the pushed commit is now the remote `main` commit before reporting success.

Each run's raw Codex JSONL event stream (including model text and tool inputs/results) is uploaded directly to `s3://cf-templates-1id935irfrtba-us-east-1/luna-traces/<task-id>/<workflow-id>-<attempt>.jsonl`. The stream stays in a mode-0600 temporary file until the upload finishes; it is never printed, sent to the relay, or included in a GitHub artifact. GitHub Actions uses OIDC to receive short-lived credentials for a role that can write only under this prefix and verify the bucket configuration. No long-lived AWS key is stored in GitHub, and the role credentials are removed from Codex's process environment. The bucket has all four S3 Block Public Access settings enabled and uses S3-managed AES256 encryption by default; the runner checks both settings before starting Codex and sends no KMS key or client-side encryption. The IAM and OIDC trust policies are in [`docs/luna-trace-s3-policy.json`](docs/luna-trace-s3-policy.json) and [`docs/luna-trace-oidc-trust-policy.json`](docs/luna-trace-oidc-trust-policy.json); the role does not need permission to read or list traces. The GitHub `luna-trace` environment permits the `main` branch only.

Codex runs with full shell access on the temporary GitHub-hosted runner. Luna may edit any repository file needed for a request, then commits and pushes directly to `main`; the runner does not create or validate a source patch artifact. For explicit product or page-content requests stored in Cloudflare KV, Luna prepares a constrained change artifact from a read-only snapshot instead of editing repository files. A separate trusted publisher validates the table, item keys, and snapshot before writing to the configured KV namespace and purging the CDN cache; the Cloudflare token is available only to that publisher job, never to Codex. Requests that need both KV content and repository changes must be submitted separately. A pushed commit is not treated as a verified Pages deployment; the task page shows the commit and GitHub Actions run so deployment can be checked separately. The workflow pins its GitHub Actions and Codex CLI revisions. It uses the standard ChatGPT-plan speed with `gpt-6-luna`; Fast is a pay-as-you-go API tier and ChatGPT-plan requests may reject service-tier overrides, so the cloud runner does not enable it.

To set up the cloud runner:

1. Add a fine-grained GitHub token scoped only to `Rob-Keys/SweetHopeBakeryy-JS` with `Actions: write` and `Contents: write`. The Worker uses it to dispatch `luna-agent.yml`; the runner checkout uses it for Luna's direct commit and push, which triggers Cloudflare Pages deployment.
2. Sign in to Codex on the setup Mac with the ChatGPT account whose plan should be used (`codex login status` checks the session). Put the Worker URL in `.env` as `CODEX_AGENT_RELAY_URL` and the matching relay secret as `CODEX_AGENT_RELAY_TOKEN`. Then run `npm run setup-cloud-agent`; the script accepts the repository-scoped GitHub token with hidden terminal input, stores it as a repository secret for the Worker and runner checkout, sends it to Wrangler as a Worker secret, and configures the GitHub Actions relay secret and URL variable.
3. Configure KV publishing with a Cloudflare API token scoped to `Workers KV Storage Read`, `Workers KV Storage Write`, and `Cache Purge`, limited to this account and zone. Store the token as the GitHub Actions secret `LUNA_CLOUDFLARE_API_TOKEN`; set repository variables `LUNA_CLOUDFLARE_ACCOUNT_ID`, `LUNA_CLOUDFLARE_KV_NAMESPACE_ID`, and `LUNA_CLOUDFLARE_ZONE_ID`. The token is used only by the isolated publisher job.
4. Deploy the relay Worker from `codex-relay/` with `npx wrangler deploy --config codex-relay/wrangler.toml`. Keep the existing Pages binding to `CODEX_AGENT_RELAY` and the same `CODEX_AGENT_RELAY_TOKEN` secret on Pages and the Worker. If the Pages project has not already been deployed with the Durable Object binding and relay secret, configure those as part of the Pages deployment too.
5. After Luna completes its first cloud run, remove the one-time `CODEX_SIWC_CREDENTIALS` Worker secret with `npx wrangler secret delete CODEX_SIWC_CREDENTIALS --config codex-relay/wrangler.toml`. The Durable Object retains the latest refreshed credential for future runs.

The browser never receives the relay token. Page requests still require the existing admin session, and the Pages Function forwards them to the Durable Object over Cloudflare's binding. The GitHub workflow accepts only a task ID, requires a matching active relay task, and does not accept prompts directly from GitHub's workflow-dispatch UI.
