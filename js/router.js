import { escapeHtml } from "./utils.js";

/**
 * Simple hash-based router.
 *
 * The `resolve` callback receives a route string and must return
 * a Promise<HTMLElement> that will be placed in the outlet.
 *
 * PAGE TEARDOWN: a page that registers listeners outside its own subtree
 * (window/document/matchMedia), starts timers, holds a Chart.js instance, or
 * has requests in flight MUST expose a cleanup function as `el.dispose`. The
 * router calls it before swapping the page out. Without this, every navigation
 * leaks the previous page's listeners and they keep firing against detached
 * DOM. Listeners inside the returned subtree need no cleanup — they go away
 * with the element.
 */
function getRouteFromHash() {
  const hash = window.location.hash || "";
  const route = hash.startsWith("#") ? hash.slice(1) : hash;
  return route || "/";
}

export class Router {
  /**
   * @param {Object}   opts
   * @param {Element}  opts.outletEl         Target container element.
   * @param {Function} opts.resolve          (route: string) => Promise<HTMLElement>
   * @param {Function} [opts.onRouteChanged] Called after each render with the current route.
   */
  constructor({ outletEl, resolve, onRouteChanged }) {
    this.outletEl = outletEl;
    this.resolve = resolve;
    this.onRouteChanged = onRouteChanged;
    this.currentEl = null;
    /** Guards against an earlier, slower route resolution overwriting a newer one. */
    this._renderToken = 0;
    this._bound = () => this.render();
  }

  start() {
    window.addEventListener("hashchange", this._bound);
    this.render();
  }

  stop() {
    window.removeEventListener("hashchange", this._bound);
    this._disposeCurrent();
  }

  _disposeCurrent() {
    try {
      this.currentEl?.dispose?.();
    } catch (err) {
      console.error("[router] page dispose failed:", err);
    }
    this.currentEl = null;
  }

  _mount(viewEl, route) {
    this._disposeCurrent();
    this.currentEl = viewEl;
    this.outletEl.replaceChildren(viewEl);
    this.outletEl.focus?.();
    this.onRouteChanged?.(route);
  }

  async render() {
    const route = getRouteFromHash();
    const token = ++this._renderToken;

    let viewEl;
    try {
      viewEl = await this.resolve(route);
    } catch (err) {
      // A failed page load must not leave the previous page on screen with no
      // explanation, nor surface as an unhandled rejection.
      console.error(`[router] failed to render "${route}":`, err);
      if (token !== this._renderToken) return;
      const errEl = document.createElement("section");
      errEl.className = "card";
      errEl.innerHTML = `
        <h1 class="h1">Page failed to load</h1>
        <p class="p">${escapeHtml(err?.message || String(err))}</p>
      `;
      this._mount(errEl, route);
      return;
    }

    // A newer navigation started while this one was resolving — drop this result.
    if (token !== this._renderToken) return;
    this._mount(viewEl, route);
  }
}
