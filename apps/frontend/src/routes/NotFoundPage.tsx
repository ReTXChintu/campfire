import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="font-display text-5xl tracking-wide text-white">Not Found</h1>
      <p className="text-text-secondary">This page doesn't exist, or you don't have access to it.</p>
      <Link to="/" className="text-sm font-medium text-accent hover:underline">
        ← Back to Library
      </Link>
    </div>
  );
}
