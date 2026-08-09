"use client";

import { useRouter } from "next/navigation";

export default function SeasonDropdown({
  folderId,
  seasons,
  selectedId,
}: {
  folderId: string;
  seasons: { id: string; name: string }[];
  selectedId: string;
}) {
  const router = useRouter();

  return (
    <select
      value={selectedId}
      onChange={(e) => router.push(`/folder/${folderId}?season=${e.target.value}`)}
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
