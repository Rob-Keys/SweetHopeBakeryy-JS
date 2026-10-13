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

The Customize page submits requests through Cloudflare Pages to a Durable Object relay. The relay dispatches a GitHub Actions workflow, which starts a fresh GitHub-hosted `ubuntu-slim` container, checks out `main`, and runs Codex with `gpt-6-luna`. Once the request finishes, the runner commits only the changed files and pushes directly to `main`, which deploys the website. The container is discarded at the end of the workflow. Since this repository is public, [GitHub-hosted standard runners are free](https://docs.github.com/en/billing/concepts/product-billing/github-actions); Cloudflare's existing Pages and Durable Object relay remain the always-available control plane.

The task prompt stays in the Durable Object while the runner starts and is delivered over the authenticated WebSocket. It is not included in the GitHub workflow dispatch or runner logs. Each task result is retained for up to 15 minutes, including after later tasks start. The ChatGPT-plan Codex credential is stored as a Cloudflare Worker secret for initial provisioning and as Durable Object state after the first run; the runner collects valid refreshed credentials after both successful and failed Codex runs, then waits for the relay to acknowledge durable storage before it is discarded. A repository-scoped GitHub token dispatches the workflow from the Worker and authenticates Luna's direct push from the temporary runner. The checkout stores the write credential in the job's local Git config so Luna can commit and push to `main`; the runner verifies that the pushed commit is now the remote `main` commit before reporting success.

Luna requests can include up to five files (10 MB each, 25 MB total). They are uploaded to the private `sweet-hope-luna-attachments` R2 bucket, downloaded by the authenticated runner into its temporary directory, and deleted when the task completes or times out. The bucket is not public and is used only through the relay's R2 binding. Add the binding from `codex-relay/wrangler.toml` when deploying. Configure a lifecycle rule to expire objects under `tasks/` after one day as a fallback for interrupted uploads or unexpected Worker failures:

```sh
npx wrangler r2 bucket create sweet-hope-luna-attachments
npx wrangler r2 bucket lifecycle add sweet-hope-luna-attachments luna-attachment-expiry tasks/ --expire-days 1
```

Each run's credential-redacted Codex JSONL event stream (including model text and tool inputs/results) is uploaded directly to `s3://cf-templates-1id935irfrtba-us-east-1/luna-traces/<task-id>/<workflow-id>-<attempt>.jsonl`. The stream stays in a mode-0600 temporary file until the AWS CLI upload finishes; it is never printed, sent to the relay, or included in a GitHub artifact. GitHub Actions uses OIDC for short-lived AWS credentials. No long-lived AWS key is stored in GitHub. Configure the private trace bucket with all four S3 Block Public Access settings and S3-managed AES256 encryption by default. The role policy is in [`docs/luna-cli-s3-policy.json`](docs/luna-cli-s3-policy.json).

Codex runs with full shell access on the temporary GitHub-hosted runner. Luna may edit repository files and commit/push directly to `main`; the runner does not create or validate a source patch artifact. For live content, Luna uses Cloudflare's `cf` CLI to read and write KV and purge the site cache. For public media, it uses the standard AWS CLI to list, upload, and delete objects in the `sweethopebakeryy` bucket. The workflow supplies a scoped Cloudflare API token and short-lived AWS credentials from GitHub OIDC. Luna reads each KV value immediately before changing it and verifies its writes afterward. KV does not provide compare-and-swap, so concurrent admin edits can still race. A pushed commit is not treated as a verified Pages deployment; the task page shows the commit and GitHub Actions run so deployment can be checked separately. The workflow pins its GitHub Actions, Codex CLI, and Cloudflare CLI revisions; AWS CLI comes from the GitHub runner image. It uses the standard ChatGPT-plan speed with `gpt-6-luna`; Fast is a pay-as-you-go API tier and ChatGPT-plan requests may reject service-tier overrides, so the cloud runner does not enable it.

To set up the cloud runner:

1. Add a fine-grained GitHub token scoped only to `Rob-Keys/SweetHopeBakeryy-JS` with `Actions: write` and `Contents: write`. The Worker uses it to dispatch `luna-agent.yml`; the runner checkout uses it for Luna's direct commit and push, which triggers Cloudflare Pages deployment.
2. Sign in to Codex on the setup Mac with the ChatGPT account whose plan should be used (`codex login status` checks the session). Put the Worker URL in `.env` as `CODEX_AGENT_RELAY_URL` and the matching relay secret as `CODEX_AGENT_RELAY_TOKEN`. Then run `npm run setup-cloud-agent`; the script accepts the repository-scoped GitHub token with hidden terminal input, stores it as a repository secret for the Worker and runner checkout, sends it to Wrangler as a Worker secret, and configures the GitHub Actions relay secret and URL variable.
3. Create a GitHub Actions environment named `luna-cli` and restrict it to the `main` branch. Create the AWS role and policy from the repository root:

   ```sh
   aws iam create-role --role-name LunaCliAccessRole --description "Short-lived GitHub Actions CLI access for Luna" --max-session-duration 3600 --assume-role-policy-document file://docs/luna-cli-oidc-trust-policy.json
   aws iam put-role-policy --role-name LunaCliAccessRole --policy-name LunaNativeCliAccess --policy-document file://docs/luna-cli-s3-policy.json
   ```

   Set the GitHub repository variable `LUNA_CLI_AWS_ROLE_ARN` to the role ARN. The policy allows trace writes and read/write/delete only within the site's public media prefixes in the `sweethopebakeryy` bucket.
4. Configure a Cloudflare API token scoped to Workers KV Storage Read, Workers KV Storage Write, and Cache Purge, limited to the site's account and zone. Store it as the GitHub Actions secret `LUNA_CLOUDFLARE_API_TOKEN`; set repository variables `LUNA_CLOUDFLARE_ACCOUNT_ID`, `LUNA_CLOUDFLARE_KV_NAMESPACE_ID`, `LUNA_CLOUDFLARE_ZONE_ID`, and `LUNA_TRACE_AWS_REGION` (`us-east-1`). The runner passes the Cloudflare token to Luna so it can use `cf` directly.
5. Create the private R2 bucket and its `tasks/` lifecycle rule above, then deploy the relay Worker from `codex-relay/` with `npx wrangler deploy --config codex-relay/wrangler.toml`. Keep the existing Pages binding to `CODEX_AGENT_RELAY` and the same `CODEX_AGENT_RELAY_TOKEN` secret on Pages and the Worker. If the Pages project has not already been deployed with the Durable Object binding and relay secret, configure those as part of the Pages deployment too.
6. After Luna completes its first cloud run, remove the one-time `CODEX_SIWC_CREDENTIALS` Worker secret with `npx wrangler secret delete CODEX_SIWC_CREDENTIALS --config codex-relay/wrangler.toml`. The Durable Object retains the latest refreshed credential for future runs.

The browser never receives the relay token. Page requests still require the existing admin session, and the Pages Function forwards them to the Durable Object over Cloudflare's binding. The GitHub workflow accepts only a task ID, requires a matching active relay task, and does not accept prompts directly from GitHub's workflow-dispatch UI.

For Luna's headless browser preview workflow and local usage, see [docs/luna-visual-preview.md](docs/luna-visual-preview.md).
