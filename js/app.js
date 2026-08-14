import { CONFIG, initConfig } from "./config.js";
import { NAV_TREE, getFirstLeafUnder } from "./navConfig.js";
import { createNav } from "./nav.js";
import { Router } from "./router.js";
import { getPageLoader } from "./pageRegistry.js";
import { renderNotFoundPage } from "./pages/notfound.js";
import { renderWelcomePage } from "./pages/welcome.js";
import { escapeHtml } from "./utils.js";
import {
  ensureAuthenticatedWithMe,
  getValidAccessToken,
  scheduleTokenRefresh,
  isAuthPopup,
  runAuthPopup,
  loginViaPopup,
} from "./services/authService.js";
import { createBffClient } from "./services/bffClient.js";
import { APP_VERSION } from "./releaseNotes.js";
import { renderReleaseNotesPage } from "./pages/releaseNotes.js";

function setHeader({ authText }) {
  document.getElementById("brandTitle").textContent = CONFIG.appName;
  document.getElementById("envSubtitle").textContent = CONFIG.region;
  document.getElementById("authPill").textContent = authText;
}

function renderFatalError(message) {
  const outletEl = document.getElementById("appMain");
  outletEl.innerHTML = `
    <section class="card">
      <h1 class="h1">Startup error</h1>
      <p class="p">${escapeHtml(message)}</p>
    </section>
  `;
}

function renderBlockedScreen(title, message) {
  const outletEl = document.getElementById("appMain");
  outletEl.innerHTML = `
    <section class="card">
      <h1 class="h1">${escapeHtml(title)}</h1>
      <p class="p">${escapeHtml(message)}</p>
    </section>
  `;
}

/** Friendly explanation for each way the pop-out sign-in can fail. */
function signInErrorMessage(code) {
  switch (code) {
    case "popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups for this app, then click Sign in again.";
    case "popup-closed":
      return "The sign-in window closed before finishing. Click Sign in to try again.";
    default:
      return `Sign-in failed: ${code}. Click Sign in to try again.`;
  }
}

/**
 * Sign-in gate shown when there is no valid session.
 *
 * A user gesture is required: the sign-in window is opened with window.open,
 * which browsers block unless it comes from a click. Sign-in cannot be
 * automatic any more — the app must not navigate its own frame to the Genesys
 * login page (see the pop-out notes in authService.js).
 */
function renderSignInGate() {
  setHeader({ authText: "Auth: sign in required" });
  const outletEl = document.getElementById("appMain");
  outletEl.innerHTML = `
    <section class="card">
      <h1 class="h1">Sign in</h1>
      <p class="p">Sign in with your Genesys Cloud account to continue.</p>
      <button type="button" class="btn" id="signInBtn">Sign in with Genesys</button>
      <p class="p sign-in-hint" id="signInHint"></p>
    </section>
  `;

  const btn = document.getElementById("signInBtn");
  const hint = document.getElementById("signInHint");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    hint.textContent = "Opening sign-in window…";
    try {
      await loginViaPopup();
      hint.textContent = "Signed in. Loading…";
      // Reload so the normal boot path runs with the token in place: it fetches
      // /users/me and re-runs the org-match check before the app appears.
      window.location.reload();
    } catch (e) {
      btn.disabled = false;
      hint.textContent = signInErrorMessage(e?.message || "unknown error");
    }
  });
}

(async function main() {
  // --- Sign-in popup ---
  // If this window is the pop-out login window, run the popup controller and
  // stop before booting the app shell. It still needs the org config, because
  // the region and clientId come from the backend registry. The org key rides
  // on the popup URL — the popup has its own partitioned storage and cannot
  // read the embedded app's.
  if (isAuthPopup()) {
    await initConfig();
    await runAuthPopup();
    return;
  }

  setHeader({ authText: "Auth: starting…" });

  // --- Resolve customer config from the backend (multi-customer) ---
  // The customer registry is server-side; fetch only this org's public config.
  // If no valid `?org=` could be resolved to a known customer, hard-fail
  // without attempting login.
  await initConfig();

  if (!CONFIG.resolved) {
    setHeader({ authText: "Auth: no organization" });
    renderBlockedScreen(
      "Organization not recognized",
      "This application was opened without a valid organization. Please launch it from within your Genesys Cloud organization."
    );
    return;
  }

  // --- Authenticate ---
  setHeader({ authText: "Auth: checking token / login…" });
  const res = await ensureAuthenticatedWithMe();

  if (res.status === "needs-login") {
    renderSignInGate();
    return;
  }

  if (res.status === "org_mismatch") {
    setHeader({ authText: "Auth: blocked" });
    renderBlockedScreen(
      "Access denied",
      "Your account does not belong to the organization this link is configured for."
    );
    return;
  }

  const userName = res.me?.name || "user";
  setHeader({ authText: `Auth: ok \u00B7 ${userName}` });

  // --- API client ---
  // All Genesys orchestration is routed through our own /api/* backend
  // endpoints (token-forwarding); the browser never calls Genesys directly.
  const api = createBffClient(getValidAccessToken, () => CONFIG.orgKey);

  // --- Session monitoring ---
  scheduleTokenRefresh({
    onExpiringSoon: (secsLeft) => {
      setHeader({
        authText: `Auth: ok \u00B7 ${userName} \u00B7 session expires in ${secsLeft}s`,
      });
    },
    onSessionExpired: () => {
      // authService reloads in-frame; the boot flow then shows the sign-in gate.
      setHeader({ authText: "Auth: session expired \u2014 sign in again\u2026" });
    },
  });

  // --- Build navigation ---
  const navEl = document.getElementById("appNav");
  const nav = createNav(navEl, NAV_TREE);

  // --- Version footer (bottom-left of the sidebar) ---
  const versionEl = document.createElement("button");
  versionEl.type = "button";
  versionEl.className = "nav-version";
  versionEl.textContent = `v${APP_VERSION}`;
  versionEl.title = "View release notes";
  versionEl.addEventListener("click", () => {
    window.location.hash = "#/release-notes";
  });
  navEl.append(versionEl);

  // --- Start router ---
  const outletEl = document.getElementById("appMain");
  const router = new Router({
    outletEl,
    resolve: async (route) => {
      // Root route — show welcome page with no preselection
      if (route === "/") return renderWelcomePage();

      // Release notes (reached from the version footer)
      if (route === "/release-notes") return renderReleaseNotesPage();

      const loader = getPageLoader(route);
      if (loader) return loader({ route, me: res.me, api });

      // Folder prefix? Redirect to its first leaf.
      const firstLeaf = getFirstLeafUnder(route);
      if (firstLeaf) {
        window.location.hash = `#${firstLeaf}`;
        return document.createElement("div");
      }

      return renderNotFoundPage({ route });
    },
    onRouteChanged: (route) => nav.updateActive(route),
  });

  router.start();
})().catch((err) => {
  setHeader({ authText: "Auth: failed" });
  renderFatalError(err?.message || String(err));
});
