import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import PasswordField from "../components/ui/PasswordField";

export default function ResetPasswordPage() {
  const { token, isLoading, resetPassword } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (token && !isLoading) navigate("/", { replace: true });
  }, [token, isLoading, navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(email, newPassword);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid w-full flex-1 lg:grid-cols-[minmax(0,1fr)_480px]">
      <section className="relative hidden flex-col justify-end overflow-hidden p-10 lg:flex" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 78% 18%, rgba(255,106,61,.3), transparent 60%), linear-gradient(100deg,#0e0d0c 12%, #241710 58%, #3d1e11 100%)",
          }}
        />
        <div className="relative">
          <p className="font-display text-5xl leading-none tracking-wide text-white">
            Locked out?
            <br />
            Set a new one.
          </p>
          <p className="mt-4 max-w-md text-sm text-text-secondary">
            Campfire has no mail server, so a reset is simply your email plus the password you want
            from now on.
          </p>
        </div>
      </section>

      <section className="flex flex-col justify-center gap-7 border-divider px-4 py-12 sm:px-8 lg:border-l lg:px-10">
        <div>
          <h1 className="font-display text-3xl tracking-wide text-white">Reset password</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Enter your email and a new password — that is it, no verification.
          </p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4">
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
            id="newPassword"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={8}
            required
            hint="At least 8 characters."
          />

          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !newPassword}
            className="mt-1 min-h-12 rounded-lg bg-accent px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? "Please wait…" : "Reset password"}
          </button>
        </form>

        <p className="rounded-lg border border-divider bg-surface px-3.5 py-3 text-xs text-text-tertiary">
          Resetting the seeded admin account? Also update <code className="font-mono">ADMIN_PASSWORD</code> in the
          backend&apos;s <code className="font-mono">.env</code> — otherwise this change reverts on the next server
          restart.
        </p>

        <p className="text-sm text-text-secondary">
          <Link to="/login" className="rounded font-semibold text-white underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
