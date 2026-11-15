import { Link } from "react-router-dom";
import { useAdminRequestCounts } from "../../hooks/useAdminRequests";

type AdminTab = "catalog" | "requests";

export default function AdminNav({ active }: { active: AdminTab }) {
  // Counts-only call, so the "N new" badge doesn't drag the whole request list (and a user lookup
  // per voter) onto the Catalog tab.
  const { data } = useAdminRequestCounts();
  const newCount = data?.counts.new ?? 0;

  const tabClass = (tab: AdminTab) =>
    `border-b-2 px-1 pb-3 text-sm font-medium transition ${
      active === tab
        ? "border-accent text-white"
        : "border-transparent text-text-secondary hover:text-white"
    }`;

  return (
    <div className="mb-8 flex gap-6 border-b border-divider">
      <Link to="/admin" className={tabClass("catalog")}>
        Catalog
      </Link>
      <Link to="/admin/requests" className={tabClass("requests")}>
        Requests
        {newCount > 0 && (
          <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] text-black">
            {newCount}
          </span>
        )}
      </Link>
    </div>
  );
}
