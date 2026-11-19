import { lazy, type ComponentType } from "react";

const RELOADED_KEY = "campfire_chunk_reload";

/**
 * `React.lazy` for a route, plus the one failure code-splitting introduces.
 *
 * Every deploy rebuilds `dist/` with new hashed chunk names and deletes the old ones. A tab opened
 * before the deploy still holds the old names, so the first time it navigates to a page it hasn't
 * loaded yet, the fetch 404s and the page would just break. A reload fetches the new index.html
 * and with it the new names — so on a failed import we reload once.
 *
 * "Once" is enforced through sessionStorage: if the chunk is genuinely unavailable (the server is
 * down, the network is gone), reloading again would loop forever, so the second failure is
 * allowed through to the error it really is.
 */
export function lazyRoute<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await load();
      safeRemove();
      return module;
    } catch (error) {
      if (!safeGet()) {
        safeSet();
        window.location.reload();
        // Never resolves: the page is going away, and rendering anything first would flash.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

// sessionStorage can throw (private windows, blocked site data) — and a page that can't remember
// it already reloaded should still load, not crash on the bookkeeping.
function safeGet(): boolean {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === "1";
  } catch {
    return true; // can't record a reload, so don't risk a loop
  }
}

function safeSet(): void {
  try {
    sessionStorage.setItem(RELOADED_KEY, "1");
  } catch {
    // nothing to do
  }
}

function safeRemove(): void {
  try {
    sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // nothing to do
  }
}
