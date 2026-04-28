// Fetches per-file additions/deletions from the GitHub REST API.
// Returns { ok: true, nets: Map<path, net> } or { ok: false, reason }.
//
// Pagination: GitHub returns up to 100 files per page; for very large PRs we
// follow the Link: rel="next" header. Capped at 30 pages (3000 files) to bound
// cost — beyond that the diff is unreviewable in-browser anyway.

const PR_FILES_PAGE_SIZE = 100;
const PR_FILES_MAX_PAGES = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;

const memoryCache = new Map();

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function fetchPrFiles(owner, repo, prNumber) {
  const cacheKey = `${owner}/${repo}#${prNumber}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, nets: cached.nets };
  }

  const nets = new Map();
  let url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=${PR_FILES_PAGE_SIZE}`;
  let pages = 0;

  while (url && pages < PR_FILES_MAX_PAGES) {
    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/vnd.github+json" },
      });
    } catch (err) {
      return { ok: false, reason: "network", detail: String(err) };
    }

    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        return { ok: false, reason: "rate-limited" };
      }
      return { ok: false, reason: "forbidden" };
    }
    if (response.status === 404) {
      return { ok: false, reason: "not-found" };
    }
    if (!response.ok) {
      return { ok: false, reason: "http", status: response.status };
    }

    const page = await response.json();
    for (const file of page) {
      const net = (file.additions || 0) - (file.deletions || 0);
      nets.set(file.filename, net);
      if (file.previous_filename) {
        nets.set(file.previous_filename, net);
      }
    }

    url = parseNextLink(response.headers.get("link"));
    pages += 1;
  }

  memoryCache.set(cacheKey, { at: Date.now(), nets });
  return { ok: true, nets, truncated: pages >= PR_FILES_MAX_PAGES && url !== null };
}

window.__treelinesApi = { fetchPrFiles };
