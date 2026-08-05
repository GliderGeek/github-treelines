// Locates the PR file tree in the DOM and stamps a net-delta badge on every
// file and folder row.
//
// GitHub ships two file-tree UIs in 2026 (the legacy one and the "improved
// Files changed experience"), so we avoid hardcoded class selectors and instead
// anchor on stable behavior: every file row contains an <a> linking to a
// "#diff-<hash>" anchor on the same page, and folder rows do not.
//
// Folder totals are computed from the API's file list, not from the rows
// currently rendered: a collapsed folder has no descendants in the DOM, and a
// virtualised tree drops off-screen rows. A row is matched to a path by its id
// (Primer's TreeView puts the full path there), falling back to walking its
// label chain outwards until it names a known file or folder.
//
// Badges are placed inside the row's *content* element — the flex row holding
// the icon and the name — for both files and folders, so they line up. The
// row container one level up is a CSS grid with fixed areas
// ("spacer toggle content"), where an extra child would be auto-placed into an
// implicit row and land above the name instead of beside it.

const BADGE_CLASS = "treelines-delta";
const HOST_CLASS = "treelines-host";
const OVERLAY_HOST_CLASS = "treelines-host--overlay";
const ROW_SELECTOR = 'li, [role="treeitem"]';
const SUBTREE_SELECTOR = 'ul, ol, [role="group"], [role="treeitem"]';
// Primer's TreeViewItemContent / the legacy tree's ActionList-content.
const CONTENT_SELECTOR =
  "[class*='TreeViewItemContent'], [class*='TreeView-item-content']," +
  " [class*='ActionList-content']";
// ...but not the text span nested inside it, whose class also contains
// "TreeViewItemContent".
const CONTENT_TEXT_SELECTOR =
  "[class*='ContentText'], [class*='item-content-text']";
// Screen-reader-only text and decorative icons are not part of a row's label.
const NON_LABEL_SELECTOR =
  'svg, [aria-hidden="true"], [class*="VisuallyHidden"], [hidden]';

// Text a row contributes itself: excludes nested rows (a folder's own label is
// not its children's labels), invisible text, and our own badge (which would
// otherwise leak into the path on every re-run).
function ownText(el) {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node.classList.contains(BADGE_CLASS)) continue;
    if (node.matches(SUBTREE_SELECTOR)) continue;
    if (node.matches(NON_LABEL_SELECTOR)) continue;
    out += ownText(node);
  }
  return out;
}

function rowLabel(el) {
  return ownText(el).trim().split("\n")[0].trim();
}

function containsRows(el) {
  return el.matches(SUBTREE_SELECTOR) || el.querySelector(SUBTREE_SELECTOR) !== null;
}

// The element that visually *is* the row: the line holding the icon and the
// name, without the nested subtree hanging off it. Appending the badge to the
// row itself would place it below the whole expanded subtree.
//
// Both trees name that element (Primer's TreeViewItemContent in the redesigned
// tab, ActionList-content in the classic one) and both lay their children out
// in a row, so the badge can just be the last child. `known` says whether we
// recognised it — GitHub hashes those class names per build, and the descent
// fallback below can only guess.
function findBadgeSlot(row) {
  for (const el of row.querySelectorAll(CONTENT_SELECTOR)) {
    if (el.matches(CONTENT_TEXT_SELECTOR)) continue;
    if (el.closest(ROW_SELECTOR) !== row) continue; // belongs to a nested row
    if (containsRows(el)) continue;
    if (rowLabel(el)) return { host: el, known: true };
  }

  let cursor = row;
  for (let depth = 0; depth < 6; depth += 1) {
    const children = [...cursor.children].filter(
      (child) => !child.classList.contains(BADGE_CLASS),
    );
    const plain = children.find((child) => !containsRows(child) && rowLabel(child));
    if (plain) return { host: plain, known: false };
    const nested = children.find((child) => containsRows(child) && rowLabel(child));
    if (!nested) break;
    cursor = nested;
  }
  return { host: row, known: false };
}

function findLabelHost(row) {
  return findBadgeSlot(row).host;
}

// Every folder prefix that contains at least one changed file, mapped to the
// sum of its files' net deltas. Handles path-compressed rows ("a/b/c") too,
// since each intermediate prefix is recorded.
function computeFolderTotals(nets, paths) {
  const totals = new Map();
  for (const path of paths) {
    const net = nets.get(path);
    if (typeof net !== "number") continue;
    const parts = path.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
      totals.set(prefix, (totals.get(prefix) || 0) + net);
    }
  }
  return totals;
}

// A row's own name, without its children's.
function rowOwnLabel(row) {
  return rowLabel(findLabelHost(row));
}

// Primer's TreeView sets the row id to the entry's full path
// (id=".claude/rules/models.md"); some builds carry it in a data attribute
// instead. Cheaper and far more reliable than reading labels, when present.
function rowPathAttribute(row, known) {
  if (!row.getAttribute) return null;
  const id = (row.getAttribute("id") || "").trim();
  if (id && known.has(id)) return id;
  for (const attr of row.attributes) {
    if (!attr.name.startsWith("data-")) continue;
    const val = attr.value.trim();
    if (val && known.has(val)) return val;
  }
  return null;
}

// Resolves a row's full path by accumulating ancestor labels outwards from
// `label`, keeping the longest chain that names something known. Anything above
// the repo root (page chrome, wrapper rows) stops matching and is discarded,
// and preferring the longest match keeps a nested "tests" from being taken for
// a root-level one.
function resolveRowPath(row, known, label) {
  if (!label) return null;

  let suffix = label;
  let best = known.has(suffix) ? suffix : null;
  let cursor = row.parentElement;
  while (cursor && cursor.tagName !== "BODY") {
    if (cursor.matches && cursor.matches(ROW_SELECTOR)) {
      const parentLabel = rowOwnLabel(cursor);
      if (parentLabel) {
        suffix = `${parentLabel}/${suffix}`;
        if (known.has(suffix)) best = suffix;
      }
    }
    cursor = cursor.parentElement;
  }
  return best;
}

function extractFilePath(anchor, nets) {
  // Try direct attributes on the anchor first.
  const direct =
    anchor.getAttribute("title") ||
    anchor.getAttribute("aria-label") ||
    anchor.getAttribute("data-path");
  if (direct && nets && nets.has(direct.trim())) return direct.trim();

  // The containing row usually carries the path outright.
  const row = anchor.closest('[role="treeitem"]') || anchor.closest("li");
  if (row) {
    const attrPath = rowPathAttribute(row, nets);
    if (attrPath) return attrPath;
  }

  // Otherwise rebuild the path from the anchor's filename outwards. Rows nest
  // as treeitem > group > treeitem, so the enclosing directory is never the
  // immediate parent — resolveRowPath collects labels from any depth.
  return resolveRowPath(row || anchor, nets, rowLabel(anchor));
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

function classForNet(net, isFolder) {
  let className = BADGE_CLASS;
  if (net > 0) className += ` ${BADGE_CLASS}--add`;
  else if (net < 0) className += ` ${BADGE_CLASS}--del`;
  else className += ` ${BADGE_CLASS}--zero`;
  // A folder's number is an aggregate of the rows below it; the extra weight
  // keeps it from reading as just another file count.
  return isFolder ? `${className} ${BADGE_CLASS}--folder` : className;
}

// A CSS grid places a child it has no area for in an implicit row — under the
// name instead of beside it. That is what the row container one level up would
// do, so when we had to guess the host we check for it and take the badge out
// of flow rather than trust the guess.
function hostLayoutClass(host, known) {
  if (known) return HOST_CLASS;
  const display = window.getComputedStyle(host).display;
  return display.includes("grid") ? OVERLAY_HOST_CLASS : HOST_CLASS;
}

function ensureBadge(slot, net, isFolder) {
  const host = slot.host;
  let badge = host.querySelector(`:scope > .${BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement("span");
    host.classList.add(hostLayoutClass(host, slot.known));
    host.appendChild(badge);
  }
  // Only write when something actually changed: the MutationObserver that
  // triggers re-annotation watches this subtree, so an unconditional write
  // would re-trigger it forever.
  const className = classForNet(net, isFolder);
  if (badge.getAttribute("data-net") === String(net) && badge.className === className) {
    return;
  }
  badge.className = className;
  badge.textContent = formatNet(net);
  badge.setAttribute("data-net", String(net));
}

function rowFor(anchor) {
  return (
    anchor.closest("li") ||
    anchor.closest('[role="treeitem"]') ||
    anchor.parentElement
  );
}

function annotateFileRow(anchor, nets) {
  const path = extractFilePath(anchor, nets);
  if (!path) return null;
  const net = nets.get(path);
  if (net === undefined) return null;

  const row = rowFor(anchor);
  if (!row) return null;

  // Same host as folder rows, so file and folder badges share one right edge.
  ensureBadge(findBadgeSlot(row), net, false);
  return path;
}

function annotateFolderRows(treeContainer, fileRows, totals) {
  // A folder row is any tree row whose label chain names a folder that holds
  // changed files. Deriving it from the label — rather than from the rows
  // currently rendered underneath it — is what makes collapsed folders work.
  const hosts = new Set();
  for (const candidate of treeContainer.querySelectorAll(ROW_SELECTOR)) {
    if (fileRows.has(candidate)) continue;
    const path =
      rowPathAttribute(candidate, totals) ||
      resolveRowPath(candidate, totals, rowOwnLabel(candidate));
    if (!path) continue;

    const slot = findBadgeSlot(candidate);
    // Nested wrappers (a <div role="treeitem"> around an <li>, say) can resolve
    // to the same visual row; badge it once.
    if (hosts.has(slot.host)) continue;
    hosts.add(slot.host);
    ensureBadge(slot, totals.get(path), true);
  }
}

function annotate(nets, paths) {
  const treeContainer = findTreeContainer(document);
  if (!treeContainer) return { annotated: 0 };

  const fileAnchors = treeContainer.querySelectorAll('a[href*="#diff-"]');
  const fileRows = new Set();
  let annotated = 0;
  for (const anchor of fileAnchors) {
    const row = rowFor(anchor);
    if (row) fileRows.add(row);
    if (annotateFileRow(anchor, nets)) annotated += 1;
  }

  const totals = computeFolderTotals(nets, paths || [...nets.keys()]);
  annotateFolderRows(treeContainer, fileRows, totals);
  return { annotated, folders: totals.size, treeContainer };
}

window.__treelinesAnnotate = { annotate };
