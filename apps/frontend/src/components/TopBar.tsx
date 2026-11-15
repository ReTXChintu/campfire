import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import SearchOverlay from "./SearchOverlay";
import { PAGE_X } from "../lib/layout";

const mobileAppDownloadUrl = import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL;
const desktopAppDownloadUrl = import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL;

/** The app's real destinations. Everything that used to hide in the avatar popup now lives either
 * here or on the Settings page. */
const DESTINATIONS = [
  { to: "/", label: "Home" },
  { to: "/discover", label: "Discover" },
  { to: "/requests", label: "Requests" },
];

function navClass(isActive: boolean): string {
  return `relative rounded-full px-3 py-2 text-sm font-medium transition ${
    isActive ? "text-white" : "text-text-secondary hover:bg-surface hover:text-white"
  }`;
}

function ActiveUnderline({ isActive }: { isActive: boolean }) {
  if (!isActive) return null;
  return <span aria-hidden="true" className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-accent" />;
}

function initialsFor(user: { name: string | null; email: string }): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "C";
}

export default function TopBar() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the transient surfaces on navigation, so a link inside them can't leave one hanging.
  useEffect(() => {
    setMenuOpen(false);
    setDrawerOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  // "/" opens search from anywhere, the way every catalog app does — unless the caret is already
  // in a field, where "/" is just a slash.
  useEffect(() => {
    if (!user) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [user]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const signOut = () => {
    logout();
    navigate("/login");
  };

  return (
    <>
      <header
        className={`sticky top-0 z-40 border-b border-divider bg-black/80 backdrop-blur-md ${PAGE_X}`}
      >
        <div className="flex items-center gap-3 py-3">
          <Link to="/" className="flex shrink-0 items-baseline gap-2" aria-label="Campfire home">
            <img src="/logo.png" alt="" className="h-9 w-9" aria-hidden="true" />
            <span className="font-display text-xl tracking-[0.07em] text-white">Campfire</span>
          </Link>

          {user && (
            <>
              <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="Main">
                {DESTINATIONS.map((destination) => (
                  <NavLink
                    key={destination.to}
                    to={destination.to}
                    end={destination.to === "/"}
                    className={({ isActive }) => navClass(isActive)}
                  >
                    {({ isActive }) => (
                      <>
                        {destination.label}
                        <ActiveUnderline isActive={isActive} />
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>

              <span className="flex-1" />

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-haspopup="dialog"
                className="flex min-h-10 items-center gap-2 rounded-full border border-divider-strong bg-[var(--bg-elevated)] px-3 py-2 text-sm text-text-tertiary transition hover:border-text-tertiary hover:text-text-secondary sm:min-w-[220px]"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <span className="hidden sm:inline">Search titles</span>
                <span className="sr-only sm:hidden">Search titles</span>
                <span className="ml-auto hidden rounded border border-divider-strong px-1.5 font-mono text-[10px] sm:inline">
                  /
                </span>
              </button>

              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Profile and settings"
                  className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-accent to-amber text-xs font-bold text-black"
                >
                  {initialsFor(user)}
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="Profile"
                    className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-xl border border-divider-strong bg-[var(--bg-elevated)] shadow-2xl"
                  >
                    <div className="border-b border-divider px-4 py-3">
                      <p className="truncate text-sm font-semibold text-white">{user.name ?? "Signed in"}</p>
                      <p className="truncate text-xs text-text-tertiary">{user.email}</p>
                    </div>
                    <div className="p-1.5">
                      <Link
                        to="/settings"
                        role="menuitem"
                        className="block rounded-lg px-3 py-2.5 text-sm text-text-secondary transition hover:bg-surface hover:text-white"
                      >
                        Settings
                      </Link>
                      <Link
                        to="/link"
                        role="menuitem"
                        className="block rounded-lg px-3 py-2.5 text-sm text-text-secondary transition hover:bg-surface hover:text-white"
                      >
                        Link a TV
                      </Link>
                      {isAdmin && (
                        <Link
                          to="/admin"
                          role="menuitem"
                          className="block rounded-lg px-3 py-2.5 text-sm text-text-secondary transition hover:bg-surface hover:text-white"
                        >
                          Admin
                        </Link>
                      )}
                      {desktopAppDownloadUrl && (
                        <a
                          href={desktopAppDownloadUrl}
                          download={desktopAppDownloadUrl.split("/").pop()}
                          target="_blank"
                          rel="noopener noreferrer"
                          role="menuitem"
                          className="block rounded-lg px-3 py-2.5 text-sm text-text-secondary transition hover:bg-surface hover:text-white"
                        >
                          Windows app
                        </a>
                      )}
                      {mobileAppDownloadUrl && (
                        <a
                          href={mobileAppDownloadUrl}
                          download={mobileAppDownloadUrl.split("/").pop()}
                          target="_blank"
                          rel="noopener noreferrer"
                          role="menuitem"
                          className="block rounded-lg px-3 py-2.5 text-sm text-text-secondary transition hover:bg-surface hover:text-white"
                        >
                          Android app
                        </a>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={signOut}
                        className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-danger transition hover:bg-danger-soft"
                      >
                        Sign out
                      </button>
                    </div>
                    <p className="border-t border-divider px-4 py-2 font-mono text-[10px] text-text-tertiary">
                      v{__APP_VERSION__}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setDrawerOpen((open) => !open)}
                aria-expanded={drawerOpen}
                aria-controls="compact-nav"
                aria-label="Menu"
                className="grid h-10 w-10 place-items-center rounded-lg text-text-secondary transition hover:bg-surface hover:text-white md:hidden"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            </>
          )}
        </div>

        {user && drawerOpen && (
          <nav id="compact-nav" aria-label="Main (compact)" className="grid gap-0.5 border-t border-divider py-2 md:hidden">
            {DESTINATIONS.map((destination) => (
              <NavLink
                key={destination.to}
                to={destination.to}
                end={destination.to === "/"}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-3 text-sm font-medium transition ${
                    isActive ? "bg-accent-soft text-amber" : "text-text-secondary hover:bg-surface hover:text-white"
                  }`
                }
              >
                {destination.label}
              </NavLink>
            ))}
            <Link
              to="/settings"
              className="rounded-lg px-3 py-3 text-sm font-medium text-text-secondary transition hover:bg-surface hover:text-white"
            >
              Settings
            </Link>
          </nav>
        )}
      </header>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
