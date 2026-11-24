import { useState } from "react";
import PasswordField from "../ui/PasswordField";
import { useCreateSource, useUpdateSource, type SourceKind, type VideoSource } from "../../lib/sources";

const LABEL = "text-xs font-semibold tracking-wide text-text-secondary uppercase";
const FIELD =
  "min-h-[44px] w-full rounded-lg border border-divider-strong bg-background px-3 py-2.5 text-sm text-white outline-none focus:border-accent";

function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid content-start gap-1.5">
      <span className={LABEL}>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={FIELD}
      />
      {hint && <span className="text-xs text-text-tertiary">{hint}</span>}
    </label>
  );
}

/** Adds a Bunny or Cloudflare source, or changes one's connection. The host is asked for its videos
 * before anything is saved, so a wrong key or ID is reported here. */
export default function SourceForm({ source, onDone }: { source?: VideoSource; onDone: () => void }) {
  const [kind, setKind] = useState<SourceKind>(source && source.kind !== "drive" ? source.kind : "bunny");
  const [name, setName] = useState(source?.name ?? "");
  const [libraryId, setLibraryId] = useState(source?.config?.libraryId ?? "");
  const [cdnHostname, setCdnHostname] = useState(source?.config?.cdnHostname ?? "");
  const [accountId, setAccountId] = useState(source?.config?.accountId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [tokenKey, setTokenKey] = useState("");
  const [dropTokenKey, setDropTokenKey] = useState(false);
  const create = useCreateSource();
  const update = useUpdateSource();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const submit = () => {
    const input = {
      name: name.trim() || (kind === "bunny" ? "Bunny" : "Cloudflare"),
      config: kind === "bunny" ? { libraryId, cdnHostname } : { accountId },
      apiKey,
      tokenKey: dropTokenKey ? null : tokenKey,
    };
    if (source) update.mutate({ id: source.id, ...input }, { onSuccess: onDone });
    else create.mutate({ kind, ...input }, { onSuccess: onDone });
  };

  const keep = source ? "Leave empty to keep the saved one." : undefined;
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {!source && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Service">
          {(["bunny", "cloudflare"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-11 rounded-lg border px-4 text-sm font-semibold transition ${
                kind === k
                  ? "border-accent bg-accent-soft text-amber"
                  : "border-divider-strong text-white hover:bg-surface-hover"
              }`}
            >
              {k === "bunny" ? "Bunny Stream" : "Cloudflare Stream"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder={kind === "bunny" ? "Bunny" : "Cloudflare"}
          hint="Shown to viewers in the source menu."
        />
        {kind === "bunny" ? (
          <>
            <TextField label="Library ID" value={libraryId} onChange={setLibraryId} placeholder="123456" hint="Stream → your library → API." />
            <TextField
              label="CDN hostname"
              value={cdnHostname}
              onChange={setCdnHostname}
              placeholder="vz-abc123-456.b-cdn.net"
              hint="On the same page."
            />
            <PasswordField label="API key" value={apiKey} onChange={setApiKey} autoComplete="new-password" hint={keep ?? "The library's own key; the read-only one is enough."} />
            <PasswordField
              label="Token authentication key"
              value={tokenKey}
              onChange={setTokenKey}
              autoComplete="new-password"
              hint={
                source?.hasTokenKey
                  ? "Saved: addresses are signed and expire. Leave empty to keep it."
                  : "Optional. Only if the pull zone has token authentication on."
              }
            />
            {source?.hasTokenKey && (
              <label className="flex items-center gap-2 self-center text-sm text-text-secondary">
                <input type="checkbox" checked={dropTokenKey} onChange={(event) => setDropTokenKey(event.target.checked)} />
                Remove the token key
              </label>
            )}
          </>
        ) : (
          <>
            <TextField label="Account ID" value={accountId} onChange={setAccountId} hint="On the account's overview page." />
            <PasswordField
              label="API token"
              value={apiKey}
              onChange={setApiKey}
              autoComplete="new-password"
              hint={keep ?? "With the Stream Read permission, or Stream Write if your videos need signed URLs."}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-accent px-5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Checking…" : source ? "Save connection" : "Add source"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 rounded-lg border border-divider-strong px-4 text-sm font-semibold text-white transition hover:bg-surface-hover"
        >
          Cancel
        </button>
        {error && (
          <span role="alert" className="text-sm text-danger">
            {error.message}
          </span>
        )}
      </div>
    </form>
  );
}
