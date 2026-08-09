import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

// A UX convenience only, not a security boundary — every protected backend route independently
// checks the Bearer token (see apps/backend/src/middleware/auth.ts), exactly like this app's old
// proxy.ts did a cheap cookie check while every real API route still enforced auth on its own.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to={`/login?callbackUrl=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { token, isAdmin, isLoading } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to={`/login?callbackUrl=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (isLoading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
