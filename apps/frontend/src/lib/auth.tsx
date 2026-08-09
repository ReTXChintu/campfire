/* eslint-disable react-refresh/only-export-components -- this is a context/hook module under
   lib/, not a component file Fast Refresh needs to isolate; AuthProvider, useAuth, and
   googleSignInUrl are meant to be imported together. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, apiGet, getToken, setToken, clearToken } from "./api";

type Me = { userId: string; email: string; name: string | null; avatarUrl: string | null; isAdmin: boolean };

type AuthContextValue = {
  token: string | null;
  user: Me | null;
  isAdmin: boolean;
  isLoading: boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// The OAuth callback (routes/auth.ts on the backend) redirects here as `/login#token=...` — a URL
// fragment, not a query param, so the token never gets logged by any server/proxy along the way.
// Read it once, persist it, and strip it from the URL so a page refresh/share doesn't re-expose it.
function consumeTokenFromHash(): string | null {
  if (!window.location.hash.startsWith("#token=")) return null;
  const token = window.location.hash.slice("#token=".length);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return token;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => consumeTokenFromHash() ?? getToken());

  useEffect(() => {
    if (token) setToken(token);
  }, [token]);

  const { data: user, isLoading } = useQuery({
    queryKey: ["me", token],
    queryFn: () => apiGet<Me>("/auth/me"),
    enabled: !!token,
    retry: false,
  });

  const logout = () => {
    clearToken();
    setTokenState(null);
    queryClient.clear();
  };

  return (
    <AuthContext.Provider
      value={{ token, user: user ?? null, isAdmin: user?.isAdmin ?? false, isLoading: !!token && isLoading, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function googleSignInUrl(): string {
  return `${API_URL}/auth/google`;
}
