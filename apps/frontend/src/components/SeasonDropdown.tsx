import { useSearchParams } from "react-router-dom";

export default function SeasonDropdown({
  seasons,
  selectedId,
}: {
  folderId: string;
  seasons: { id: string; name: string }[];
  selectedId: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <select
      id="season-select"
      value={selectedId}
      aria-label="Season"
      onChange={(event) => {
        const next = new URLSearchParams(searchParams);
        next.set("season", event.target.value);
        setSearchParams(next);
      }}
      className="min-h-10 rounded-lg border border-divider-strong bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-white outline-none transition focus:border-accent"
    >
      {seasons.map((season) => (
        <option key={season.id} value={season.id}>
          {season.name}
        </option>
      ))}
    </select>
  );
}
