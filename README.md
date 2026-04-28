# GitHub Treelines

A WebExtension that annotates GitHub's pull request file tree with the **net line delta** for every file and the aggregated net delta for every folder. Lets you skim a PR and see at a glance where the changes actually landed — mostly JS? mostly views? mostly tests? — without scrolling the diff.

The Files changed page already shows `+/−` totals at the PR level and inside each file's diff header. This extension projects those numbers onto the tree on the left, where you'd naturally look for a structural overview.

![Example tree with net delta badges](https://raw.githubusercontent.com/GliderGeek/github-treelines/main/screenshot.png)

## AI disclaimer

This code has been written by ai agents and not reviewed. Usage on your own risk.

## Rate limit (read this)

The extension uses the **unauthenticated** GitHub REST API, which is capped at **60 requests per hour per IP**. Each PR you open costs one request (or a handful for very large PRs at 100 files per page).

If badges silently stop appearing after heavy review, you've probably hit the limit — a small banner in the bottom-right will say so. Either:

- Wait an hour for the limit to reset, or
- Add a Personal Access Token to the code (not currently exposed via UI; edit `src/api.js` to send an `Authorization: Bearer <token>` header — bumps the limit to 5000/hr).

## Install (load unpacked)

### Chrome / Edge / Brave / Arc

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open any PR's *Files changed* tab — badges should appear in the file tree.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json` in this folder.
3. Open any PR's *Files changed* tab.

Note: Firefox temporary add-ons are unloaded when the browser restarts. Re-load via `about:debugging` after each restart.

## How it works

- Content script runs on `https://github.com/*/*/pull/*`.
- On load (and on SPA navigations) it parses `{owner, repo, pr}` from the URL and calls `GET /repos/:owner/:repo/pulls/:n/files`.
- Computes net delta per file, then rolls up to every folder by common-prefix aggregation of the file paths in each tree node.
- A `MutationObserver` re-applies badges when you collapse/expand folders or GitHub lazy-loads more rows.

## Troubleshooting: missing folder badges

GitHub is mid-rollout of a redesigned *Files changed* page (announced [June 2025](https://github.blog/changelog/2025-06-26-improved-pull-request-files-changed-experience-now-in-public-preview/)) — some users/repos see the new tree, others still see the old one. The two trees use slightly different HTML for folder rows.

File rows are detected via their `#diff-<hash>` link, which is stable across both UIs, so **file badges should always work**. Folder rows are detected by tag/role (`li`, `[role="treeitem"]`, `[role="group"]` — see `src/annotate.js`). If GitHub ships a new tree that uses something else (e.g. `<details>`, a custom element, a `<div>` with a specific class), you'll see file badges but no folder aggregates.

To fix: open DevTools on a PR's Files changed tab, inspect a folder row in the tree, note its tag and any stable attribute, and add it to the selector list in `annotateFolderRows` in `src/annotate.js`.

## Files

- `manifest.json` — MV3 manifest (Chrome + Firefox via `browser_specific_settings`).
- `src/api.js` — paginated GitHub API fetch, in-memory 5-minute cache, rate-limit detection.
- `src/annotate.js` — tree discovery, folder aggregation, badge injection (idempotent).
- `src/content.js` — entrypoint and SPA navigation handling.
- `src/styles.css` — theme-aware badge colors using GitHub's CSS variables.
