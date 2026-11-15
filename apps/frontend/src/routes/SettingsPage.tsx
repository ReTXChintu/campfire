import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { ApiError, apiGet } from "../lib/api";
import PasswordField from "../components/ui/PasswordField";
import { PAGE_X } from "../lib/layout";

type AppVersionInfo = { version: string; androidDownloadUrl: string; windowsDownloadUrl: string };

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid content-start gap-4 rounded-2xl border border-divider bg-surface p-5">
      <div>
        <h2 className="font-display text-xl tracking-wide text-white">{title}</h2>
        {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-text-tertiary">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}

/** Everything that used to be crammed into the avatar popup: the account, the password, the TV
 * pairing flow, the app builds and sign out. */
export default function SettingsPage() {
  const { user, isAdmin, resetPassword, logout } = useAuth();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // The backend's own release endpoint — the same number the Android and Windows builds check, so
  // this is the real "latest build", not a hard-coded string.
  const release = useQuery({
    queryKey: ["app-version"],
    queryFn: () => apiGet<AppVersionInfo>("/api/app-version"),
  });

  const onChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setError(null);
    setSaved(false);
    if (newPassword.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Those two passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      // There is no dedicated change-password endpoint; the reset route takes an email plus the new
      // password and is the same thing for a signed-in user.
      await resetPassword(user.email, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not go through — please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <main className={`w-full flex-1 ${PAGE_X} py-8`}>
      <div className="mb-7">
        <p className="font-display text-xs tracking-[0.16em] text-text-tertiary uppercase">Your account</p>
        <h1 className="font-display text-4xl tracking-wide text-white">Settings</h1>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Account">
          <div className="grid gap-3">
            <Row label="Name" value={user.name ?? "—"} />
            <Row label="Email" value={user.email} />
            <Row label="Role" value={isAdmin ? "Admin" : "Viewer"} />
          </div>
          {isAdmin && (
            <Link
              to="/admin"
              className="inline-flex min-h-10 w-fit items-center rounded-lg border border-divider-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
            >
              Open the admin panel
            </Link>
          )}
        </Panel>

        <Panel
          title="Change password"
          description="Sets a new password for this account straight away. There is no email confirmation."
        >
          <form onSubmit={onChangePassword} className="grid gap-4">
            <PasswordField
              id="settings-new-password"
              label="New password"
              value={newPassword}
              onChange={(value) => {
                setNewPassword(value);
                setSaved(false);
              }}
              autoComplete="new-password"
              minLength={8}
              hint="At least 8 characters."
            />
            <PasswordField
              id="settings-confirm-password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={(value) => {
                setConfirmPassword(value);
                setSaved(false);
              }}
              autoComplete="new-password"
              minLength={8}
            />
            {error && (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            {saved && (
              <p className="rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-sm text-live">
                Password updated.
              </p>
            )}
            <button
              type="submit"
              disabled={saving || !newPassword || !confirmPassword}
              className="min-h-11 w-fit rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Update password"}
            </button>
          </form>
        </Panel>

        <Panel
          title="Linked devices"
          description="A TV signs in by showing a code. Campfire does not keep a list of paired devices, so this is the pairing flow itself rather than a device list."
        >
          <Link
            to="/link"
            className="inline-flex min-h-11 w-fit items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
          >
            Link a TV
          </Link>
        </Panel>

        <Panel title="Apps" description="The browser plays MP4, WebM and Ogg. The apps play everything, MKV included.">
          <div className="grid gap-3">
            <Row label="This web app" value={<span className="font-mono text-xs">v{__APP_VERSION__}</span>} />
            <Row
              label="Latest release"
              value={
                release.isLoading ? (
                  <span className="text-text-tertiary">checking…</span>
                ) : release.data ? (
                  <span className="font-mono text-xs">v{release.data.version}</span>
                ) : (
                  <span className="text-text-tertiary">unavailable</span>
                )
              }
            />
          </div>
          {release.data && (
            <div className="flex flex-wrap gap-2">
              <a
                href={release.data.windowsDownloadUrl}
                download="Campfire.exe"
                className="min-h-10 rounded-lg border border-divider-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
              >
                Windows app
              </a>
              <a
                href={release.data.androidDownloadUrl}
                download="Campfire.apk"
                className="min-h-10 rounded-lg border border-divider-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
              >
                Android app
              </a>
            </div>
          )}
        </Panel>

        <Panel title="Sign out" description="Signs this browser out. Other devices stay signed in.">
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="min-h-11 w-fit rounded-lg border border-danger px-5 py-2.5 text-sm font-bold text-danger transition hover:bg-danger-soft"
          >
            Sign out
          </button>
        </Panel>
      </div>
    </main>
  );
}
