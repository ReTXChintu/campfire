import { useNavigate } from "react-router-dom";
import { CloseIcon } from "./player-icons";

type EpisodeProgress = { positionSeconds: number; completed: boolean };

type Props = {
  episodes: { id: string; name: string }[];
  progressByFileId: Record<string, EpisodeProgress>;
  currentFileId: string;
  open: boolean;
  onClose: () => void;
};

export default function EpisodesPanel({ episodes, progressByFileId, currentFileId, open, onClose }: Props) {
  const navigate = useNavigate();

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex justify-end">
      <button
        type="button"
        aria-label="Close episodes"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/60"
      />
      <div className="flex w-full max-w-sm flex-col gap-1 overflow-y-auto bg-neutral-900/95 p-4 backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white/90">Episodes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close episodes"
            className="text-white/60 hover:text-white"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        {episodes.map((episode, index) => {
          const progress = progressByFileId[episode.id];
          const isCurrent = episode.id === currentFileId;
          return (
            <button
              key={episode.id}
              type="button"
              onClick={() => {
                onClose();
                if (!isCurrent) navigate(`/watch/${episode.id}`);
              }}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                isCurrent ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5"
              }`}
            >
              <span className="w-8 shrink-0 text-white/40">{index + 1}</span>
              <span className="flex-1 truncate">{episode.name}</span>
              {progress?.completed && <span className="text-xs text-emerald-400">Watched</span>}
              {progress && !progress.completed && (
                <span className="text-xs text-white/40">In progress</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
