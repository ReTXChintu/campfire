import { CloseIcon } from "./player-icons";
import QualitySection, { type QualitySelection } from "./QualitySection";

export type CaptionOption = { index: number; label: string };
export type SourceOption = { id: string; name: string };
/** "settings" holds every section; the others are one section each, behind their own button. */
export type MenuView = "settings" | "captions" | "quality" | "source";

const TITLES: Record<MenuView, string> = {
  settings: "Settings",
  captions: "Captions",
  quality: "Quality",
  source: "Source",
};

type Props = {
  view: MenuView | null;
  onClose: () => void;
  quality: {
    available: { label: string; height: number }[];
    /** Null when there is no untouched original to offer (a hosted stream). */
    original: { height: number | null } | null;
    selection: QualitySelection;
    autoHeight: number | null;
    onSelect: (value: QualitySelection) => void;
  } | null;
  captions: { tracks: CaptionOption[]; selected: number | null; onSelect: (index: number | null) => void } | null;
  audio: { tracks: CaptionOption[]; selected: number; onSelect: (index: number) => void } | null;
  speed: { options: number[]; selected: number; onSelect: (speed: number) => void } | null;
  source: { options: SourceOption[]; selected: string; onSelect: (id: string) => void } | null;
};

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-8 items-center gap-2 text-sm text-white/80">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs uppercase tracking-wide text-white/40">{children}</h3>;
}

/** The player's side menu for directly seekable video: quality, captions, audio, speed and where
 * it's playing from. (TrackSettingsMenu is the live-remux player's equivalent.) */
export default function PlayerMenu({ view, onClose, quality, captions, audio, speed, source }: Props) {
  if (!view) return null;
  const shows = (section: MenuView) => view === "settings" || view === section;

  return (
    <div className="absolute inset-0 z-20 flex justify-end">
      <button
        type="button"
        aria-label={`Close ${TITLES[view].toLowerCase()}`}
        onClick={onClose}
        className="flex-1 cursor-default bg-black/60"
      />
      <div className="flex w-full max-w-sm flex-col gap-5 overflow-y-auto bg-neutral-900/95 p-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white/90">{TITLES[view]}</h2>
          <button type="button" onClick={onClose} aria-label="Close menu" className="text-white/60 hover:text-white">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {source && shows("source") && source.options.length > 1 && (
          <section className="flex flex-col gap-1">
            <Heading>Playing from</Heading>
            {source.options.map((s) => (
              <Choice key={s.id} name="player-source" checked={s.id === source.selected} onChange={() => source.onSelect(s.id)}>
                {s.name}
              </Choice>
            ))}
          </section>
        )}

        {quality && shows("quality") && (
          <QualitySection
            availableQualities={quality.available}
            sourceHeight={quality.original?.height ?? null}
            hideOriginal={!quality.original}
            selection={quality.selection}
            autoResolvedHeight={quality.autoHeight}
            onSelect={quality.onSelect}
          />
        )}

        {audio && view === "settings" && audio.tracks.length > 1 && (
          <section className="flex flex-col gap-1">
            <Heading>Audio</Heading>
            {audio.tracks.map((t) => (
              <Choice key={t.index} name="player-audio" checked={t.index === audio.selected} onChange={() => audio.onSelect(t.index)}>
                {t.label}
              </Choice>
            ))}
          </section>
        )}

        {captions && shows("captions") && (
          <section className="flex flex-col gap-1">
            <Heading>Captions</Heading>
            <Choice name="player-captions" checked={captions.selected == null} onChange={() => captions.onSelect(null)}>
              Off
            </Choice>
            {captions.tracks.map((t) => (
              <Choice key={t.index} name="player-captions" checked={t.index === captions.selected} onChange={() => captions.onSelect(t.index)}>
                {t.label}
              </Choice>
            ))}
            {captions.tracks.length === 0 && <p className="text-sm text-white/50">No captions available.</p>}
          </section>
        )}

        {speed && view === "settings" && (
          <section className="flex flex-col gap-1">
            <Heading>Speed</Heading>
            {speed.options.map((s) => (
              <Choice key={s} name="player-speed" checked={s === speed.selected} onChange={() => speed.onSelect(s)}>
                {s === 1 ? "Normal" : `${s}x`}
              </Choice>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
