import { Link } from "react-router-dom";

export default function AdminNav({ active }: { active: "converter" | "catalog" }) {
  const tabClass = (tab: "converter" | "catalog") =>
    `border-b-2 px-1 pb-3 text-sm font-medium transition ${
      active === tab
        ? "border-accent text-white"
        : "border-transparent text-text-secondary hover:text-white"
    }`;

  return (
    <div className="mb-8 flex gap-6 border-b border-divider">
      <Link to="/admin" className={tabClass("converter")}>
        Converter
      </Link>
      <Link to="/admin/catalog" className={tabClass("catalog")}>
        Catalog
      </Link>
    </div>
  );
}
