# Luna visual preview

Luna can render local site changes in headless Chromium and inspect screenshots before committing them.

## In the GitHub runner

The Luna workflow runs on GitHub's `ubuntu-slim` runner and installs the locked Playwright package with Chromium's headless shell before starting Codex. For a visual change, Luna runs:

```sh
npm run luna:preview -- /menu
```

Use `/`, `/about`, or `/contact` for other pages. To capture the four main pages at both supported viewport sizes:

```sh
npm run luna:preview -- --all
```

The command prints each screenshot's absolute path. Luna opens each relevant desktop and mobile screenshot with Codex's built-in `view_image` tool, makes any visual corrections, then captures and inspects the final result again before staging or committing visual changes. Both viewports must be inspected and free of visible issues. The default screenshot directory is the runner's temporary directory (`$RUNNER_TEMP/luna-preview`; `/tmp/luna-preview` locally); set `LUNA_PREVIEW_OUTPUT_DIR` to choose another location. The screenshots stay outside the checkout and are not committed. If Chromium or page data is unavailable, Luna leaves visual changes uncommitted and reports why.

The preview serves the current checkout's `src/` files, including clean routes such as `/menu`. It supplies data from the runner's read-only `.luna-kv-baseline.json` snapshot when available. A local run without that snapshot falls back to the site's public read-only data endpoint. All other `/api/*` requests are rejected, so checkout, admin, payment, and other write flows cannot affect live services from the preview.

The slim runner has one CPU and GitHub enforces a 15-minute maximum job duration. The workflow uses that maximum to cover browser installation and Luna's coding run; a task that exceeds it will be stopped by GitHub.

## Running locally

After `npm ci`, install the Playwright-matched browser once and run a preview:

```sh
npx playwright install chromium
npm run luna:preview -- /
```

Install with `--with-deps` on a Linux machine that does not already have Chromium's system libraries. Page screenshots include desktop (1440 × 1000) and mobile (390 × 844) layouts.
