import { REQUEST_STATUS_CLASSES, REQUEST_STATUS_LABELS } from "../../lib/requestStatus";
import type { RequestStatus } from "../../lib/types";

export default function RequestStatusPill({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${REQUEST_STATUS_CLASSES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {REQUEST_STATUS_LABELS[status]}
    </span>
  );
}
