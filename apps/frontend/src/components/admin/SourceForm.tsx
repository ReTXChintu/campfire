import { useEffect, useState } from "react";
import PasswordField from "../ui/PasswordField";
import {
  frameCode,
  type FrameKind,
  useCreateSource,
  useFramePreview,
  useUpdateSource,
  type FramePreview,
  type SourceKind,
  type VideoSource,
} from "../../lib/sources";

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

const KINDS: { kind: SourceKind; label: string; name: string }[] = [
  { kind: "bunny", label: "Bunny Stream", name: "Bunny" },
  { kind: "cloudflare", label: "Cloudflare Stream", name: "Cloudflare" },
  { kind: "frame", label: "Any player", name: "" },
];

const FRAMES: { kind: FrameKind; label: string; hint: string }[] = [
  { kind: "movie", label: "Movies", hint: "Films, and loose videos TMDb doesn't know." },
  { kind: "tv", label: "TV series", hint: "Episodes." },
  {
    kind: "anime",
    label: "Anime",
    hint: "Japanese animation, films and series alike. Leave it empty to use the two above for anime too.",
  },
];

const codeExample = (kind: FrameKind) => `<iframe
  src="https://player.example.com/${kind}/{{file_id}}"
  allow="autoplay; fullscreen"
  allowfullscreen
></iframe>`;

const list = (values: string, strip = "") =>
  values
    .split(/[;\s]+/)
    .filter(Boolean)
    .map((v) => v.replace(strip, "").replaceAll("-", " "))
    .join(", ") || "nothing";

/** What an embed code was read as. */
function FrameSummary({ preview: { config, ignored } }: { preview: FramePreview }) {
  const rows: [string, string][] = [
    ["Plays from", config.template],
    ["May use", list(config.allow)],
    ["Sandbox allows", list(config.sandbox, "allow-")],
    ["Full screen", config.allowFullscreen ? "Yes" : "No"],
    ["Referrer", config.referrerPolicy],
    ["Corners", config.radius === null ? "As Campfire's own player" : `${config.radius}px`],
    ["Shape", config.ratio === null ? "16:9" : `${config.ratio.toFixed(2)}:1`],
    ...(ignored.length ? [["Left out", ignored.join(", ")] as [string, string]] : []),
  ];
  return (
    <dl className="grid content-start gap-x-4 gap-y-2 rounded-lg border border-divider p-4 text-sm sm:grid-cols-[auto_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-tertiary">{label}</dt>
          <dd className={`min-w-0 break-words ${label === "Left out" ? "text-amber" : "text-white"}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type CodeState = {
  code: string;
  setCode: (code: string) => void;
  preview: FramePreview | undefined;
  error: Error | null;
  /** Empty, or read without a problem. */
  ready: boolean;
};

/** One embed code as it's typed, and what the server reads in it. */
function useCode(saved: string, active: boolean): CodeState {
  const [code, setCode] = useState(saved);
  const [settledCode, setSettledCode] = useState(code.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledCode(code.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [code]);
  const read = useFramePreview(active ? settledCode : "");
  const settled = settledCode === code.trim() && settledCode !== "";
  const preview = settled ? read.data : undefined;
  return { code, setCode, preview, error: settled ? read.error : null, ready: !code.trim() || !!preview };
}

function FrameFields({ kind, label, hint, state }: { kind: FrameKind; label: string; hint: string; state: CodeState }) {
  const { code, setCode, preview, error } = state;
  return (
    <div className="grid gap-4 border-t border-divider pt-4 lg:grid-cols-2">
      <label className="grid content-start gap-1.5">
        <span className={LABEL}>{label}</span>
        <textarea
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={codeExample(kind)}
          rows={6}
          autoComplete="off"
          spellCheck={false}
          className={`${FIELD} font-mono`}
        />
        <span className="text-xs text-text-tertiary">{hint}</span>
      </label>
      <div className="grid content-start gap-1.5" aria-live="polite">
        <span className={LABEL}>Recognized</span>
        {error ? (
          <p className="text-sm text-danger">{error.message}</p>
        ) : preview ? (
          <FrameSummary preview={preview} />
        ) : (
          <p className="text-sm text-text-tertiary">{code.trim() ? "Reading…" : "Nothing here yet."}</p>
        )}
      </div>
    </div>
  );
}

/** Adds a source, or changes one's connection. A host is asked for its videos before anything is
 * saved, so a wrong key or ID is reported here; an embed code shows what was recognized in it. */
export default function SourceForm({ source, onDone }: { source?: VideoSource; onDone: () => void }) {
  const [kind, setKind] = useState<SourceKind>(source && source.kind !== "drive" ? source.kind : "bunny");
  const [name, setName] = useState(source?.name ?? "");
  const [libraryId, setLibraryId] = useState(source?.config?.libraryId ?? "");
  const [cdnHostname, setCdnHostname] = useState(source?.config?.cdnHostname ?? "");
  const [accountId, setAccountId] = useState(source?.config?.accountId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [tokenKey, setTokenKey] = useState("");
  const [dropTokenKey, setDropTokenKey] = useState(false);
  const saved = source?.kind === "frame" ? source.config : null;
  const isFrame = kind === "frame";
  const codes: Record<FrameKind, CodeState> = {
    movie: useCode(frameCode(saved?.movie), isFrame),
    tv: useCode(frameCode(saved?.tv), isFrame),
    anime: useCode(frameCode(saved?.anime), isFrame),
  };
  const all = FRAMES.map((f) => codes[f.kind]);
  const siteName = all.find((state) => state.preview)?.preview?.siteName;
  const framesReady = siteName !== undefined && all.every((state) => state.ready);
  const create = useCreateSource();
  const update = useUpdateSource();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const placeholder = KINDS.find((k) => k.kind === kind)!.name || siteName || "";

  const submit = () => {
    const input = {
      name: name.trim() || placeholder,
      ...(isFrame
        ? { codes: { movie: codes.movie.code, tv: codes.tv.code, anime: codes.anime.code } }
        : {
            config: kind === "bunny" ? { libraryId, cdnHostname } : { accountId },
            apiKey,
            tokenKey: dropTokenKey ? null : tokenKey,
          }),
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
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              aria-pressed={kind === k.kind}
              onClick={() => setKind(k.kind)}
              className={`min-h-11 rounded-lg border px-4 text-sm font-semibold transition ${
                kind === k.kind
                  ? "border-accent bg-accent-soft text-amber"
                  : "border-divider-strong text-white hover:bg-surface-hover"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder={placeholder}
          hint="Shown to viewers in the source menu."
        />
        {kind === "bunny" && (
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
        )}
        {kind === "cloudflare" && (
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
      {isFrame && (
        <>
          <p className="text-xs text-text-tertiary">
            Put {"{{tmdb_id}}"} where the movie or series' TMDb ID goes. Campfire selects the matching movie, TV series,
            or anime player. Only add a player that holds your own files.
          </p>
          {FRAMES.map((f) => (
            <FrameFields key={f.kind} kind={f.kind} label={f.label} hint={f.hint} state={codes[f.kind]} />
          ))}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="submit"
          disabled={pending || (isFrame && !framesReady)}
          className="min-h-11 rounded-lg bg-accent px-5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {pending ? (kind === "frame" ? "Saving…" : "Checking…") : !source ? "Add source" : kind === "frame" ? "Save player" : "Save connection"}
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
