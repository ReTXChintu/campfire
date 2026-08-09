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
      value={selectedId}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        next.set("season", e.target.value);
        setSearchParams(next);
      }}
      className="rounded-md border border-divider bg-surface px-4 py-2 text-sm font-medium text-white outline-none transition focus:border-white/30"
    >
      {seasons.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
