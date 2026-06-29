/**
 * Release Notes page.
 *
 * Lists all entries from releaseNotes.js (newest first). The first
 * entry is highlighted as the latest release. A Back button returns
 * to the previous view via browser history.
 */
import { escapeHtml } from "../utils.js";
import { RELEASE_NOTES } from "../releaseNotes.js";
import { VERSION } from "../version.js";

export function renderReleaseNotesPage() {
  const root = document.createElement("section");
  root.className = "release-notes";

  const header = document.createElement("div");
  header.className = "release-notes__header";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-sm release-notes__back";
  backBtn.textContent = "← Back";
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = "#/";
  });

  const title = document.createElement("h1");
  title.className = "h1";
  title.textContent = "Release Notes";

  header.append(backBtn, title);
  root.append(header);

  if (!RELEASE_NOTES.length) {
    const empty = document.createElement("p");
    empty.className = "p";
    empty.textContent = "No release notes yet.";
    root.append(empty);
    return root;
  }

  const list = document.createElement("div");
  list.className = "release-notes__list";

  RELEASE_NOTES.forEach((entry, i) => {
    const card = document.createElement("article");
    card.className = "release-notes__entry";
    if (i === 0) card.classList.add("release-notes__entry--latest");

    const items = (entry.changes ?? [])
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join("");

    // The latest entry always reflects the live build version, so it can
    // never drift from the version shown in the sidebar footer. Older
    // entries use their own snapshotted version, falling back to the live
    // build if one was never recorded.
    const versionLabel = i === 0 ? VERSION : (entry.version ?? VERSION);

    card.innerHTML = `
      <div class="release-notes__entry-head">
        <span class="release-notes__version">v${escapeHtml(versionLabel)}</span>
        ${i === 0 ? `<span class="release-notes__badge">Latest</span>` : ""}
        ${entry.date ? `<span class="release-notes__date">${escapeHtml(entry.date)}</span>` : ""}
      </div>
      ${entry.title ? `<h2 class="release-notes__title">${escapeHtml(entry.title)}</h2>` : ""}
      <ul class="release-notes__changes">${items}</ul>
    `;

    list.append(card);
  });

  root.append(list);
  return root;
}
