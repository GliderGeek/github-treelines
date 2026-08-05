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
- Computes net delta per file, then rolls up to every folder by common-prefix aggregation of the API's file list — not of the rows currently on screen, so a collapsed (or lazily rendered) folder still shows the total of everything inside it.
- Matches a tree row to a path by its row `id` (Primer's TreeView puts the full path there), falling back to walking the row's label chain outwards and keeping the longest chain that names a known file or folder — so a nested `tests/` isn't confused with a root-level one.
- Puts every badge, file and folder alike, inside the row's content element (the line holding the icon and the name) — Primer's `TreeViewItemContent` on the redesigned tab, `ActionList-content` on the classic one — so they share one right edge. The row container one level up is a CSS grid with fixed areas, where an extra child would be auto-placed into an implicit row above the name.
- A `MutationObserver` re-applies badges when you collapse/expand folders or GitHub lazy-loads more rows.

## The two Files changed pages

GitHub is mid-rollout of a redesigned *Files changed* page (announced [June 2025](https://github.blog/changelog/2025-06-26-improved-pull-request-files-changed-experience-now-in-public-preview/)) — some users/repos see the new tree, others still see the old one, and the same account can get either depending on the repo. Both are supported; nothing is hardcoded to one of them.

| Part | classic (`/files`) | redesigned (`/changes`) |
| --- | --- | --- |
| Row | `li[role=treeitem]` with `data-tree-entry-type` | `li[role=treeitem]`, path in the row `id` |
| Label row | `.ActionList-content` (direct child) | `.PRIVATE_TreeView-item-content`, inside a grid container |
| Subtree | `ul[role=group]` sibling | `ul[role=group]` sibling |

What both are matched on: file rows by their `#diff-<hash>` link, paths by row `id` or label chain, folder rows by "any other row that names a folder holding changed files". No per-variant attribute is required, and folder totals never depend on a folder being expanded.

### If badges go missing

A row that can't be resolved is left unbadged rather than badged with a guess, so blanks mean the row's label chain didn't resolve — the tree renders rows flat (no DOM nesting), or the label carries extra text beyond the name. Inspect the row in DevTools and adjust `ROW_SELECTOR` / `rowOwnLabel` in `src/annotate.js`.

If badges appear but sit *above* the name instead of beside it, GitHub renamed the content classes: `CONTENT_SELECTOR` no longer matches, and the fallback landed on the row's grid container. It is placed out of flow at the right edge in that case, but adding the new class name to `CONTENT_SELECTOR` restores proper in-flow placement.

## Files

- `manifest.json` — MV3 manifest (Chrome + Firefox via `browser_specific_settings`).
- `src/api.js` — paginated GitHub API fetch, in-memory 5-minute cache, rate-limit detection.
- `src/annotate.js` — tree discovery, folder aggregation, badge injection (idempotent).
- `src/content.js` — entrypoint and SPA navigation handling.
- `src/styles.css` — theme-aware badge colors using GitHub's CSS variables.
