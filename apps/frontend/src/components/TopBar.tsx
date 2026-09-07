import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

const mobileAppDownloadUrl = import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL;
const desktopAppDownloadUrl = import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL;

function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hidden items-center gap-1.5 rounded-full border border-divider px-3 py-1.5 text-xs font-medium text-white/90 transition hover:border-white/30 hover:text-white sm:flex"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d="M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1Z" />
        <path d="M5 20a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z" />
      </svg>
      {label}
    </a>
  );
}

export default function TopBar() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-divider bg-black/80 px-4 py-4 backdrop-blur-md sm:px-6">
      <Link to="/" className="flex items-baseline gap-2">
        <span className="flex items-center gap-0.5 font-display text-3xl tracking-wide text-white">
          CAMPFIRE<span className="text-accent">•</span>
        </span>
        <span className="text-[10px] text-text-tertiary">v{__APP_VERSION__}</span>
      </Link>
      {user && (
        <div className="flex items-center gap-5 text-sm text-text-secondary">
          {desktopAppDownloadUrl && <DownloadLink href={desktopAppDownloadUrl} label="Desktop App" />}
          {mobileAppDownloadUrl && <DownloadLink href={mobileAppDownloadUrl} label="Get the App" />}
          {isAdmin && (
            <Link to="/admin" className="font-medium transition hover:text-white">
              Admin
            </Link>
          )}
          <span className="hidden rounded-full bg-white/10 px-3 py-1 text-xs text-text-secondary sm:inline">
            {user.email}
          </span>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="transition hover:text-white"
          >
            Sign out
          </button>
          <div className="h-[30px] w-[30px] rounded-md bg-gradient-to-br from-accent to-amber" />
        </div>
      )}
    </header>
  );
}
