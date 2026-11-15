import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import PasswordField from "../components/ui/PasswordField";

type Mode = "signin" | "signup";

const mobileAppDownloadUrl = import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL;
const desktopAppDownloadUrl = import.meta.env.VITE_DESKTOP_APP_DOWNLOAD_URL;

export default function LoginPage() {
  const { token, isLoading, login, signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (token && !isLoading) navigate(callbackUrl || "/", { replace: true });
  }, [token, isLoading, callbackUrl, navigate]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signup(email, password, name.trim() || undefined);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid w-full flex-1 lg:grid-cols-[minmax(0,1fr)_480px]">
      {/* The brand panel takes the width a centred card used to waste; it collapses away on
          phones, where the form is the whole screen. */}
      <section
        className="relative hidden flex-col justify-end gap-4 overflow-hidden p-10 lg:flex"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 78% 18%, rgba(255,106,61,.34), transparent 60%), radial-gradient(90% 80% at 20% 90%, rgba(255,178,94,.14), transparent 60%), linear-gradient(100deg,#0e0d0c 12%, #2a1a12 58%, #4a2414 100%)",
          }}
        />
        <div className="relative">
          <img src="/full_logo.png" alt="" className="mb-6 h-24 w-auto" />
          <p className="font-display text-5xl leading-none tracking-wide text-white">
            Your library,
            <br />
            ready to watch.
          </p>
          <p className="mt-4 max-w-md text-sm text-text-secondary">
            Films and series on every screen in the house, with watch parties, synced progress and
            subtitles that remember what you picked.
          </p>
        </div>
        <div className="filmstrip relative" />
      </section>

      <section className="flex flex-col justify-center gap-7 border-divider px-4 py-12 sm:px-8 lg:border-l lg:px-10">
        <div className="lg:hidden">
          <img src="/full_logo.png" alt="Campfire" className="h-20 w-auto" />
        </div>

        <div>
          <h1 className="font-display text-3xl tracking-wide text-white">
            {mode === "signup" ? "Create your account" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {mode === "signup"
              ? "Pick a password you will remember — there is no email verification here."
              : "Welcome back."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4">
          {mode === "signup" && (
            <div className="grid gap-1.5">
              <label htmlFor="name" className="text-xs font-semibold tracking-wide text-text-secondary uppercase">
                Name <span className="text-text-tertiary">(optional)</span>
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-divider-strong bg-background px-3 py-2.5 text-sm text-white outline-none transition hover:border-text-tertiary focus:border-accent"
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <label htmlFor="email" className="text-xs font-semibold tracking-wide text-text-secondary uppercase">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-divider-strong bg-background px-3 py-2.5 text-sm text-white outline-none transition hover:border-text-tertiary focus:border-accent"
            />
          </div>

          <PasswordField
            id="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 8 : undefined}
            required
            hint={mode === "signup" ? "At least 8 characters." : undefined}
            trailingLabel={
              mode === "signin" ? (
                <Link
                  to="/reset-password"
                  className="rounded px-1 text-xs text-text-secondary underline-offset-2 hover:underline"
                >
                  Forgot password?
                </Link>
              ) : undefined
            }
          />

          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="mt-1 min-h-12 rounded-lg bg-accent px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="text-sm text-text-secondary">
          {mode === "signup" ? "Already have an account?" : "No account yet?"}{" "}
          <button
            type="button"
            onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
            className="rounded font-semibold text-white underline-offset-2 hover:underline"
          >
            {mode === "signup" ? "Sign in" : "Sign up"}
          </button>
        </p>

        {(mobileAppDownloadUrl || desktopAppDownloadUrl) && (
          <div className="grid gap-2 border-t border-divider pt-6">
            <p className="text-xs text-text-tertiary">
              The apps play every format, including MKV, which the browser cannot.
            </p>
            <div className="flex flex-wrap gap-2">
              {desktopAppDownloadUrl && (
                <a
                  href={desktopAppDownloadUrl}
                  download={desktopAppDownloadUrl.split("/").pop()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-9 rounded-full border border-divider-strong px-3.5 py-2 text-xs font-semibold text-white transition hover:border-text-tertiary"
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
                  className="min-h-9 rounded-full border border-divider-strong px-3.5 py-2 text-xs font-semibold text-white transition hover:border-text-tertiary"
                >
                  Android app
                </a>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
