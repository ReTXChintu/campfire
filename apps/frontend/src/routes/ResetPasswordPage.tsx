import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 30%, #3a1a12 0%, #1a0e12 40%, #0A0B0F 75%)",
        }}
      />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-8 rounded-2xl border border-divider bg-surface/60 px-10 py-14 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="flex flex-col items-center gap-2">
          <h1 className="flex items-center gap-0.5 font-display text-4xl tracking-wide text-white">
            Reset password
          </h1>
          <p className="text-center text-sm text-text-secondary">
            Enter your email and a new password — that's it, no verification.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-white/90">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label htmlFor="newPassword" className="mb-1.5 block text-sm font-medium text-white/90">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
            <p className="mt-1 text-xs text-text-tertiary">At least 8 characters.</p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !email || !newPassword}
            className="mt-2 rounded-lg bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {submitting ? "Please wait…" : "Reset password"}
          </button>
        </form>

        <p className="max-w-xs text-center text-xs text-text-tertiary">
          Resetting the seeded admin account? Also update <code>ADMIN_PASSWORD</code> in the
          backend's <code>.env</code> — otherwise this change reverts on the next server restart.
        </p>

        <p className="text-sm text-text-secondary">
          <Link to="/login" className="font-medium text-white underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
