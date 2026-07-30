// Locates the PR file tree in the DOM and stamps a net-delta badge on every
// file and folder row.
//
// GitHub ships two file-tree UIs in 2026 (the legacy one and the "improved
// Files changed experience"), so we avoid hardcoded class selectors and instead
// anchor on stable behavior: every file row contains an <a> linking to a
// "#diff-<hash>" anchor on the same page, and folder rows do not.
//
// Folder paths are derived bottom-up: for any tree node, its folder path is the
// longest common prefix of the file paths of all its descendant file links.

const BADGE_CLASS = "treelines-delta";
const PROCESSED_ATTR = "data-treelines-processed";

function extractFilePath(anchor, nets) {
  // Try direct attributes on the anchor first.
  const direct =
    anchor.getAttribute("title") ||
    anchor.getAttribute("aria-label") ||
    anchor.getAttribute("data-path");
  if (direct && nets && nets.has(direct.trim())) return direct.trim();

  // Try data attributes on the containing <li role="treeitem"> — GitHub stores
  // the path on the row in the new tree.
  const row = anchor.closest('[role="treeitem"]') || anchor.closest("li");
  if (row) {
    for (const attr of row.attributes) {
      if (!attr.name.startsWith("data-")) continue;
      const val = attr.value;
      if (nets && nets.has(val)) return val;
    }
  }

  // Rows nest as treeitem > group > treeitem, so the enclosing directory is
  // never the immediate parent — collect labels from any depth.
  const leafName = anchor.textContent.trim().split("\n")[0].trim();
  if (!leafName) return null;
  if (nets && nets.has(leafName)) return leafName;

  let suffix = leafName;
  let cursor = row ? row.parentElement : anchor.parentElement;
  while (cursor && cursor.tagName !== "BODY") {
    if (cursor.matches && cursor.matches('li[role="treeitem"]')) {
      const labelEl =
        cursor.querySelector(
          ":scope > .ActionList-content, :scope > [class*='ActionList-content']",
        ) || cursor.firstElementChild;
      const label = (labelEl ? labelEl.textContent : "")
        .trim()
        .split("\n")[0]
        .trim();
      if (label) {
        suffix = `${label}/${suffix}`;
        if (nets && nets.has(suffix)) return suffix;
      }
    }
    cursor = cursor.parentElement;
  }

  return null;
}

function findTreeContainer(root) {
  // The PR file tree lives in the Layout sidebar, NOT in the main diff content
  // (which also has file-header elements with similar links). Anchor on the
  // sidebar specifically.
  const sidebar =
    root.querySelector('[data-target="diff-layout.sidebarContainer"]') ||
    root.querySelector(".Layout-sidebar") ||
    root.querySelector('aside[aria-label*="file" i]') ||
    root.querySelector('nav[aria-label*="file" i]');
  if (sidebar) return sidebar;

  // Fallback for layouts with none of those wrappers. Takes the outermost
  // ancestor, not the first one holding several anchors — that would be the
  // closest shared folder, leaving the rest of the tree unannotated.
  const anchor = [...root.querySelectorAll('a[href*="#diff-"]')].find(
    (a) => !a.closest(".Layout-main"),
  );
  if (!anchor) return null;

  let best = null;
  let bestCount = 1;
  let candidate = anchor.parentElement;
  while (candidate && candidate !== document.body) {
    // The diff stream links to #diff- anchors too — don't span both panes.
    if (candidate.querySelector(".Layout-main, [data-target*='diff-layout']")) {
      break;
    }
    const count = candidate.querySelectorAll('a[href*="#diff-"]').length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
    candidate = candidate.parentElement;
  }
  return best;
}

function formatNet(net) {
  if (net > 0) return `+${net}`;
  if (net < 0) return `−${Math.abs(net)}`;
  return "0";
}

function classForNet(net) {
  if (net > 0) return `${BADGE_CLASS} ${BADGE_CLASS}--add`;
  if (net < 0) return `${BADGE_CLASS} ${BADGE_CLASS}--del`;
  return `${BADGE_CLASS} ${BADGE_CLASS}--zero`;
}

function ensureBadge(row, net) {
  let badge = row.querySelector(`:scope > .${BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement("span");
    row.appendChild(badge);
  }
  badge.className = classForNet(net);
  badge.textContent = formatNet(net);
  badge.setAttribute("data-net", String(net));
}

function annotateFileRow(anchor, nets) {
  const path = extractFilePath(anchor, nets);
  if (!path) return null;
  const net = nets.get(path);
  if (net === undefined) return null;

  // Find the row to attach the badge to: the closest ancestor that's
  // visually a single line in the tree. We look for an LI, or a row-like
  // element that's the direct parent in flex/grid layout.
  const row =
    anchor.closest("li") ||
    anchor.closest("[role='treeitem']") ||
    anchor.parentElement;
  if (!row) return null;

  ensureBadge(row, net);
  return path;
}

function annotateFolderRows(treeContainer, filePathsByAnchor, nets) {
  // Folder rows: tree elements that are NOT a file anchor link, but contain
  // file anchors as descendants. We walk every element under the tree
  // container, skip file anchor rows, and for each remaining structural row
  // compute its folder path as the common prefix of contained files.
  const fileRowSet = new Set();
  for (const anchor of filePathsByAnchor.keys()) {
    const row =
      anchor.closest("li") ||
      anchor.closest("[role='treeitem']") ||
      anchor.parentElement;
    if (row) fileRowSet.add(row);
  }

  // Only directory rows: <li role="treeitem" data-tree-entry-type="directory">.
  // We deliberately skip <ul role="group"> wrappers (they would double-badge
  // the same folder) and skip file <li>s (handled separately).
  const candidates = treeContainer.querySelectorAll(
    'li[role="treeitem"][data-tree-entry-type="directory"]',
  );
  for (const candidate of candidates) {
    const innerAnchors = candidate.querySelectorAll('a[href*="#diff-"]');
    if (innerAnchors.length === 0) continue;

    let net = 0;
    for (const anchor of innerAnchors) {
      const path = filePathsByAnchor.get(anchor);
      if (!path) continue;
      const fileNet = nets.get(path);
      if (typeof fileNet === "number") net += fileNet;
    }

    // Attach to the directory's own label row (the .ActionList-content link
    // that's a direct child), not to the whole subtree LI.
    const labelRow =
      candidate.querySelector(
        ":scope > .ActionList-content, :scope > [class*='ActionList-content']",
      ) || candidate.firstElementChild || candidate;
    ensureBadge(labelRow, net);
    candidate.setAttribute(PROCESSED_ATTR, "1");
  }
}

function annotate(nets) {
  const treeContainer = findTreeContainer(document);
  if (!treeContainer) return { annotated: 0 };

  const fileAnchors = treeContainer.querySelectorAll('a[href*="#diff-"]');
  const filePathsByAnchor = new Map();
  let annotated = 0;
  for (const anchor of fileAnchors) {
    const path = annotateFileRow(anchor, nets);
    if (path) {
      filePathsByAnchor.set(anchor, path);
      annotated += 1;
    } else {
      const fallback = extractFilePath(anchor, nets);
      if (fallback) filePathsByAnchor.set(anchor, fallback);
    }
  }

  annotateFolderRows(treeContainer, filePathsByAnchor, nets);
  return { annotated, treeContainer };
}

window.__treelinesAnnotate = { annotate };
