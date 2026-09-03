/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // Optional — the "Get the App" button (TopBar) only renders when this is set.
  readonly VITE_MOBILE_APP_DOWNLOAD_URL?: string;
  // Optional — same idea, for the Windows desktop build. Used by DesktopAppRequiredNotice (shown
  // in place of the player for MKV titles, which aren't playable on web at all) and TopBar.
  readonly VITE_DESKTOP_APP_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
