import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type { User } from "../types/auth.types";
import { useAuthStore } from "@/stores/auth.store";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (partial: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    updateUser,
  } = useAuthStore();

  useEffect(() => {
    // Check for existing session on mount
    const storedToken = localStorage.getItem("d-arrow-refresh-token");
    if (storedToken && !isAuthenticated) {
      useAuthStore.getState().checkAuth();
    }
  }, [isAuthenticated]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        login,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
