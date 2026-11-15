import { useId, useState } from "react";

/** Every password input in the app goes through this: a labelled field with an eye button that
 * toggles between hiding and showing the secret, and whose accessible name flips between
 * "Show password" and "Hide password" (a hard UI rule — login, sign-up, reset, and any settings
 * field holding a secret). */
export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  hint,
  error,
  id: idProp,
  trailingLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  hint?: string;
  error?: string | null;
  id?: string;
  /** Optional right-aligned link beside the label, e.g. "Forgot password?". */
  trailingLabel?: React.ReactNode;
}) {
  const generated = useId();
  const id = idProp ?? generated;
  const [visible, setVisible] = useState(false);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-semibold tracking-wide text-text-secondary uppercase">
          {label}
        </label>
        {trailingLabel}
      </div>
      <div className="relative flex">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`min-h-[44px] w-full rounded-lg border bg-background px-3 py-2.5 pr-12 text-sm text-white outline-none transition hover:border-text-tertiary focus:border-accent ${
            error ? "border-danger" : "border-divider-strong"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((previous) => !previous)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-text-secondary transition hover:bg-surface-hover hover:text-white"
        >
          {visible ? (
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M3 3l18 18" />
              <path d="M10.6 5.2A9.6 9.6 0 0 1 12 5c5 0 9 5 9 7 0 .7-.5 1.7-1.4 2.8M6.3 7.3C4.1 8.8 3 10.9 3 12c0 2 4 7 9 7 1.6 0 3-.5 4.2-1.2" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-text-tertiary">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
