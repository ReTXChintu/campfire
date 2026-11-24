import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { ApiError, apiGet, apiPut } from "../lib/api";
import PasswordField from "../components/ui/PasswordField";
import { PAGE_X } from "../lib/layout";
import { useLanguageOptions } from "../hooks/useCatalog";
import type { LanguagePrefs } from "../lib/types";

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

const SELECT =
  "min-h-11 w-full min-w-0 rounded-lg border border-divider-strong bg-background px-3 text-sm text-white outline-none focus:border-accent";
const SMALL_BUTTON =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-divider-strong px-2 text-sm text-white transition hover:bg-surface-hover disabled:opacity-40";

const SUBTITLE_MODES: { value: LanguagePrefs["subtitleMode"]; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "foreign", label: "Only when the audio isn't one of my languages" },
  { value: "always", label: "Always" },
];

/**
 * The languages every title starts in. The server ranks these below whatever the viewer picked on
 * a video (or last picked in its series), so they only decide where a title *starts*.
 */
function LanguagesPanel({ initial }: { initial: LanguagePrefs | null }) {
  const queryClient = useQueryClient();
  const options = useLanguageOptions();
  const [audio, setAudio] = useState<string[]>(initial?.audio ?? []);
  const [mode, setMode] = useState<LanguagePrefs["subtitleMode"]>(initial?.subtitleMode ?? "off");
  const [subtitles, setSubtitles] = useState(initial?.subtitles ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (languages: LanguagePrefs | null) =>
      apiPut<{ languages: LanguagePrefs | null }>("/auth/me/languages", { languages }),
    onSuccess: ({ languages }) => {
      setAudio(languages?.audio ?? []);
      setMode(languages?.subtitleMode ?? "off");
      setSubtitles(languages?.subtitles ?? "");
      setSaved(languages ? "Saved. Titles start in these from now on." : "Cleared.");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      // Where a video starts is worked out per viewer, so any cached one is now out of date.
      queryClient.invalidateQueries({ queryKey: ["video"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "That did not go through — please try again."),
  });

  const languages = options.data ?? [];
  const nameOf = (code: string) => languages.find((l) => l.code === code)?.name ?? code;
  const touched = () => {
    setSaved(null);
    setError(null);
  };
  const move = (from: number, to: number) => {
    setAudio((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    touched();
  };

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    touched();
    if (mode !== "off" && !subtitles) {
      setError("Pick a subtitle language, or turn subtitles off.");
      return;
    }
    save.mutate({ audio: audio.filter(Boolean), subtitles: subtitles || null, subtitleMode: mode });
  };

  /** One language select; a saved code the list lacks is kept as an option rather than lost. */
  const languageSelect = (id: string, value: string, onChange: (code: string) => void, exclude: string[] = []) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
      <option value="">Choose a language</option>
      {value && !languages.some((l) => l.code === value) && <option value={value}>{nameOf(value)}</option>}
      {languages
        .filter((l) => l.code === value || !exclude.includes(l.code))
        .map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
    </select>
  );

  return (
    <Panel
      title="Languages"
      description="What every title starts in. Applies to the player in the Campfire apps, and to subtitles on the web (the browser can't switch a file's audio)."
    >
      <form onSubmit={onSave} className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold text-white">Audio, most wanted first</legend>
          {audio.length === 0 && (
            <p className="text-sm text-text-tertiary">None set — each title starts in its own default audio.</p>
          )}
          <ol className="grid gap-2">
            {audio.map((code, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 shrink-0 font-mono text-xs text-text-tertiary">{i + 1}.</span>
                <label htmlFor={`settings-audio-${i}`} className="sr-only">
                  Audio language {i + 1}
                </label>
                <div className="min-w-0 flex-1">
                  {languageSelect(
                    `settings-audio-${i}`,
                    code,
                    (next) => {
                      setAudio((list) => list.map((c, j) => (j === i ? next : c)));
                      touched();
                    },
                    audio,
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${code ? nameOf(code) : "this language"} up`}
                  className={SMALL_BUTTON}
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === audio.length - 1}
                  aria-label={`Move ${code ? nameOf(code) : "this language"} down`}
                  className={SMALL_BUTTON}
                >
                  &darr;
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAudio((list) => list.filter((_, j) => j !== i));
                    touched();
                  }}
                  aria-label={`Remove ${code ? nameOf(code) : "this language"}`}
                  className={SMALL_BUTTON}
                >
                  &times;
                </button>
              </li>
            ))}
          </ol>
          {audio.length < 3 && (
            <button
              type="button"
              onClick={() => {
                setAudio((list) => [...list, ""]);
                touched();
              }}
              className="min-h-10 w-fit rounded-lg border border-divider-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-surface-hover"
            >
              Add a language
            </button>
          )}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold text-white">Subtitles</legend>
          {SUBTITLE_MODES.map((option) => (
            <label key={option.value} className="flex items-center gap-2.5 text-sm text-text-secondary">
              <input
                type="radio"
                name="settings-subtitle-mode"
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value);
                  touched();
                }}
              />
              {option.label}
            </label>
          ))}
          <div className="mt-2 grid gap-1.5">
            <label htmlFor="settings-subtitle-language" className="text-xs font-semibold text-text-secondary">
              Subtitle language{mode === "off" && <span className="text-text-tertiary"> (not used while off)</span>}
            </label>
            {languageSelect("settings-subtitle-language", subtitles, (code) => {
              setSubtitles(code);
              touched();
            })}
          </div>
        </fieldset>

        <div aria-live="polite">
          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {saved && <p className="rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-sm text-live">{saved}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="min-h-11 w-fit rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save languages"}
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => {
              touched();
              save.mutate(null);
            }}
            className="min-h-11 w-fit rounded-lg border border-divider-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </form>
    </Panel>
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

        {isAdmin ? (
          <Panel
            title="Change password"
            description="The admin password is set on the server, so nobody can reset it from a browser."
          >
            <p className="text-sm text-text-secondary">
              Change <code className="font-mono">ADMIN_PASSWORD</code> in the backend&apos;s{" "}
              <code className="font-mono">.env</code>, then restart the server.
            </p>
          </Panel>
        ) : (
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
        )}

        <LanguagesPanel initial={user.languages ?? null} />

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
          {/* TMDb's API terms ask for this notice wherever its data appears. */}
          <p className="text-xs text-text-tertiary">
            Artwork and synopses come from TMDb. This product uses the TMDB API but is not endorsed or certified by
            TMDB.
          </p>
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
