// Entrypoint. Detects PR /files pages, fetches per-file line counts, and
// re-annotates the file tree on initial load, SPA navigation, and tree
// mutations (collapse/expand/lazy load).

(function main() {
  const { fetchPrFiles } = window.__treelinesApi;
  const { annotate } = window.__treelinesAnnotate;

  let currentNets = null;
  let currentPrKey = null;
  let scheduled = false;
  let treeObserver = null;

  function parsePrFromLocation() {
    // Match /<owner>/<repo>/pull/<n>(/files...)?
    const m = location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/files)?\/?$/,
    );
    if (!m) return null;
    return { owner: m[1], repo: m[2], prNumber: m[3] };
  }

  function isFilesTab() {
    return /\/pull\/\d+\/files\/?$/.test(location.pathname);
  }

  function scheduleAnnotate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!currentNets) return;
      annotate(currentNets);
    });
  }

  function attachTreeObserver(treeContainer) {
    if (treeObserver) treeObserver.disconnect();
    if (!treeContainer) return;
    treeObserver = new MutationObserver(scheduleAnnotate);
    treeObserver.observe(treeContainer, { subtree: true, childList: true });
  }

  function showBanner(message) {
    // Subtle fallback indicator when we can't fetch (rate-limit etc).
    let banner = document.querySelector("#treelines-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "treelines-banner";
      banner.className = "treelines-banner";
      document.body.appendChild(banner);
    }
    banner.textContent = `Treelines: ${message}`;
  }

  function clearBanner() {
    const banner = document.querySelector("#treelines-banner");
    if (banner) banner.remove();
  }

  async function loadAndAnnotate() {
    const pr = parsePrFromLocation();
    if (!pr) return;
    if (!isFilesTab()) return;

    const prKey = `${pr.owner}/${pr.repo}#${pr.prNumber}`;

    if (prKey !== currentPrKey) {
      currentPrKey = prKey;
      currentNets = null;
      clearBanner();
      const result = await fetchPrFiles(pr.owner, pr.repo, pr.prNumber);
      if (!result.ok) {
        if (result.reason === "rate-limited") {
          showBanner("GitHub API rate limit hit (60/hr unauthenticated). Wait or restart later.");
        } else {
          showBanner(`could not fetch PR files (${result.reason})`);
        }
        return;
      }
      currentNets = result.nets;
      if (result.truncated) {
        showBanner("PR exceeds 3000 files; tree is partially annotated.");
      }
    }

    // Wait for the tree to actually be in the DOM before annotating.
    let attempts = 0;
    const tryAnnotate = () => {
      const { treeContainer } = annotate(currentNets);
      if (treeContainer) {
        attachTreeObserver(treeContainer);
      } else if (attempts < 20) {
        attempts += 1;
        setTimeout(tryAnnotate, 250);
      }
    };
    tryAnnotate();
  }

  // Initial run.
  loadAndAnnotate();

  // SPA nav: GitHub fires turbo:load (newer) and pjax:end (older).
  document.addEventListener("turbo:load", loadAndAnnotate);
  document.addEventListener("pjax:end", loadAndAnnotate);
  document.addEventListener("pageshow", loadAndAnnotate);

  // Belt-and-braces: watch for URL changes via History API.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      loadAndAnnotate();
    }
  }, 500);
})();
