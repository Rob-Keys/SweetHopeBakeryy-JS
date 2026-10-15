# Luna visual preview

Luna can render local site changes in headless Chromium and inspect screenshots before committing them.

## In the GitHub runner

The Luna workflow runs on GitHub's `ubuntu-24.04` runner with Node.js 22 and installs the locked Playwright package with Chromium's headless shell before starting Codex. For a visual change, Luna runs:

```sh
npm run luna:preview -- /menu
```

Use `/`, `/about`, or `/contact` for other pages. To capture the four main pages at both supported viewport sizes:

```sh
npm run luna:preview -- --all
```

The command prints each screenshot's absolute path. Luna opens each relevant desktop and mobile screenshot with Codex's built-in `view_image` tool, makes any visual corrections, then captures and inspects the final result again. Both viewports must be inspected and free of visible issues. The default screenshot directory is the runner's temporary directory (`$RUNNER_TEMP/luna-preview`; `/tmp/luna-preview` locally); set `LUNA_PREVIEW_OUTPUT_DIR` to choose another location. The screenshots stay outside the checkout and are not committed. If Chromium or page data is unavailable before a source visual change is committed, Luna reports the reason and leaves that source change uncommitted. For content-only KV requests, a successful CLI write remains complete even if the later visual preview cannot load.

The preview serves the current checkout's `src/` files, including clean routes such as `/menu`. It reads table data from the site's public read-only endpoint, retrying transient failures up to three times. Screenshots wait for page loading states to finish and image decoding to succeed; content errors and uncaught page errors fail verification. All other `/api/*` requests are rejected, so checkout, admin, payment, and other write flows cannot affect live services from the preview.

The workflow sets a 15-minute job timeout covering setup and the coding run. The relay allows up to 10 minutes for startup, then at most 12 minutes for the runner within the remaining job budget. The runner reserves time for credential saving, trace upload, and result acknowledgment. A task that exceeds its deadline is stopped and its outcome must be checked before retrying.

## Running locally

After `npm ci`, install the Playwright-matched browser once and run a preview:

```sh
npx playwright install chromium
npm run luna:preview -- /
```

Install with `--with-deps` on a Linux machine that does not already have Chromium's system libraries. Page screenshots include desktop (1440 × 1000) and mobile (390 × 844) layouts.
