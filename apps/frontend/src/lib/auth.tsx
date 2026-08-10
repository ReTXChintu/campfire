/* eslint-disable react-refresh/only-export-components -- this is a context/hook module under
   lib/, not a component file Fast Refresh needs to isolate; AuthProvider and useAuth are meant to
   be imported together. */
import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, getToken, setToken, clearToken } from "./api";

type Me = { userId: string; email: string; name: string | null; avatarUrl: string | null; isAdmin: boolean };

type AuthContextValue = {
  token: string | null;
  user: Me | null;
  isAdmin: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// One seeded admin account (apps/backend/src/lib/users.ts's seedAdminUser) plus open signup for
// everyone else — POST /auth/login and /auth/signup (both email+password) are the only ways in,
// on both web and mobile. Signup never grants admin.
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const { data: user, isLoading } = useQuery({
    queryKey: ["me", token],
    queryFn: () => apiGet<Me>("/auth/me"),
    enabled: !!token,
    retry: false,
  });

  const login = async (email: string, password: string) => {
    const { token: newToken } = await apiPost<{ token: string }>("/auth/login", { email, password });
    setToken(newToken);
    setTokenState(newToken);
  };

  const signup = async (email: string, password: string, name?: string) => {
    const { token: newToken } = await apiPost<{ token: string }>("/auth/signup", { email, password, name });
    setToken(newToken);
    setTokenState(newToken);
  };

  const logout = () => {
    clearToken();
    setTokenState(null);
    queryClient.clear();
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user: user ?? null,
        isAdmin: user?.isAdmin ?? false,
        isLoading: !!token && isLoading,
        login,
        signup,
        logout,
      }}
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
