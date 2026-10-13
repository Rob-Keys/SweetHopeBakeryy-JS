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

## Local Code Agent

The Customize page can send a source-code request directly to a Codex agent running on the owner's Mac. The Mac opens an outbound WebSocket to a small Cloudflare Worker; it exposes no listening port. The Mac sends no periodic application heartbeat. Instead, each authenticated, visible-page status check asks the relay to send a nonce challenge over the WebSocket; the Mac answers, and the status request reports online only if it receives that response within 2.5 seconds. The page checks presence every 15 seconds while visible and disables the prompt when the probe fails. The relay rejects submissions if the Mac does not answer a fresh challenge or is already working on another request. There is no offline request queue or cloud coding container; the relay is designed to fit within Cloudflare's Free plan allowances for this low-volume use.

The Durable Object hibernates while the WebSocket is idle, so the connection can remain available without periodic Mac-to-Cloudflare application messages. The relay holds one task status and final summary in a Durable Object for up to 15 minutes, then deletes them. It never persists the prompt; that is delivered over the live connection to the Mac. The Mac runs `codex exec` with `gpt-6-luna` through the locally signed-in Codex CLI and edits this checkout. Each run uses the `workspace-write` sandbox with automatic review for actions that require approval, such as writing Git metadata for a commit. Every run has outbound network access so a code change can be pushed. The agent answers questions without editing files and can make requested frontend or backend/API fixes. It may inspect authentication code and fix related bugs only while preserving or strengthening existing authentication and authorization guarantees; it must not remove, bypass, disable, or weaken authentication, authorization, password verification, JWT validation or expiry, rate limits, input validation, or other security controls, or expose secrets or protected operations. Work on the local relay or agent, credentials, payment protections, network permissions, deployment configuration, or Git configuration remains out of scope unless directly necessary for a backend fix that preserves those guarantees. For an in-scope change it reviews the final diff, commits only the files changed for the request, and pushes directly to `main`, which deploys the website. ChatGPT and GitHub credentials remain on the Mac.

To connect the Mac agent:

1. Deploy the relay Worker from `codex-relay/` with `npx wrangler deploy --config codex-relay/wrangler.toml`.
2. Set the same random `CODEX_AGENT_RELAY_TOKEN` secret on the relay Worker and the Pages project. For the Worker, run `openssl rand -hex 32` to create a token, then `npx wrangler secret put CODEX_AGENT_RELAY_TOKEN --config codex-relay/wrangler.toml`; for Pages, run `npx wrangler pages secret put CODEX_AGENT_RELAY_TOKEN --project-name sweethopebakeryy-js`.
3. Bind the deployed `CodeAgentRelay` Durable Object to the Pages project as `CODEX_AGENT_RELAY` (the `wrangler.toml` binding already names the Worker and class).
4. Add the same token and relay URL to the ignored local `.env` file. Use the Worker URL printed by Wrangler, with `/agent` at the end:

   ```text
   CODEX_AGENT_RELAY_TOKEN=<generated-token>
   CODEX_AGENT_RELAY_URL=wss://sweet-hope-codex-relay.<your-workers-subdomain>.workers.dev/agent
   ```

5. Sign in to Codex on the Mac with the ChatGPT account whose plan should be used (`codex login status` checks the local CLI session). Make sure this checkout's Git remote is configured and GitHub authentication works on the Mac (for example, with `gh auth login` and `gh auth setup-git`). Then run `npm run local-agent` from this repository while the Mac should accept requests. The agent looks for `codex` on `PATH` and checks the standard ChatGPT.app CLI location; if your CLI is installed elsewhere, set `CODEX_BIN` in `.env` to its full executable path. Press Ctrl+C to stop it; the Customize prompt will show the Mac as offline.

The browser never receives the relay token. The task panel echoes the exact submitted prompt as text beside Luna’s response; user input is passed to Codex as a JSON `user_request` field separate from the higher-priority developer instructions. Page requests still require the existing admin session, and the Pages Function forwards them to the Durable Object over Cloudflare's binding.
