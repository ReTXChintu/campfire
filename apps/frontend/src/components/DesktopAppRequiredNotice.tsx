import { Link } from "react-router-dom";
import Poster from "./Poster";

const mobileAppDownloadUrl = import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL;
const desktopAppDownloadUrl = import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL;

/**
 * Shown in place of the player when a title is in a container the browser cannot play (anything
 * that isn't MP4/WebM/Ogg — the backend tells us via `seekMode !== "native"`). This is a real and
 * fairly common state, so it is a card with somewhere to go rather than a grey dead end: the
 * artwork stays, the reason is stated plainly, and the two builds that *can* play it are one click
 * away. It never claims to know the container's name — the watch endpoint doesn't send one.
 */
export default function DesktopAppRequiredNotice({
  title,
  fileId,
  backHref,
}: {
  title: string;
  fileId?: string;
  backHref?: string;
}) {
  const hasApps = Boolean(desktopAppDownloadUrl || mobileAppDownloadUrl);

  return (
    <div className="overflow-hidden rounded-2xl border border-divider bg-surface">
      <div className="grid gap-5 p-5 sm:grid-cols-[140px_minmax(0,1fr)] sm:p-6">
        <div className="max-w-[140px]">
          <Poster path={fileId ? `/api/thumbnail/${fileId}` : null} title={title} id={fileId ?? title} />
        </div>
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-amber uppercase">
            Needs the app
          </span>
          <h2 className="mt-2.5 font-display text-3xl leading-none tracking-wide text-white">{title}</h2>
          <p className="mt-3 max-w-xl text-sm text-text-secondary">
            Browsers only play MP4, WebM and Ogg. This title is in another container, so Campfire
            hands it to the Windows or Android app, which plays any format natively — same account,
            same watch progress, same subtitles.
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            {desktopAppDownloadUrl && (
              <a
                href={desktopAppDownloadUrl}
                download={desktopAppDownloadUrl.split("/").pop()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                Get the Windows app
              </a>
            )}
            {mobileAppDownloadUrl && (
              <a
                href={mobileAppDownloadUrl}
                download={mobileAppDownloadUrl.split("/").pop()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg border border-divider-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
              >
                Get the Android app
              </a>
            )}
            {backHref && (
              <Link
                to={backHref}
                className="inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-semibold text-text-secondary transition hover:text-white"
              >
                Back to the library
              </Link>
            )}
          </div>

          {!hasApps && (
            <p className="mt-4 rounded-lg border border-divider-strong bg-background px-3.5 py-3 text-xs text-text-tertiary">
              No app download is configured on this server. Ask the admin for the Windows installer
              or the Android APK.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
