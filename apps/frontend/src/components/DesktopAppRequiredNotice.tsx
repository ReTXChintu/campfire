const mobileAppDownloadUrl = import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL;
const desktopAppDownloadUrl = import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL;

export default function DesktopAppRequiredNotice({ title }: { title: string }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-divider bg-surface px-6 text-center">
      <h2 className="font-display text-2xl tracking-wide text-white">{title}</h2>
      <p className="max-w-md text-sm text-text-secondary">
        This video is an MKV file and isn&apos;t supported in the browser. Watch it in the Campfire
        desktop app (Windows) or the Campfire mobile app (Android), which play MKV natively.
      </p>
      {(desktopAppDownloadUrl || mobileAppDownloadUrl) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          {desktopAppDownloadUrl && (
            <a
              href={desktopAppDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90"
            >
              Download Desktop App
            </a>
          )}
          {mobileAppDownloadUrl && (
            <a
              href={mobileAppDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-divider px-4 py-2 text-sm font-bold text-white/90 transition hover:bg-white/5"
            >
              Download Mobile App
            </a>
          )}
        </div>
      )}
    </div>
  );
}
