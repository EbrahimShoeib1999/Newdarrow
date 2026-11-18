import { create } from "zustand";
import type { User } from "@/features/auth/types/auth.types";
import { AuthService } from "@/features/auth/api/auth.service";
import { STORAGE_KEYS } from "@/lib/constants";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearAuth: () => void;
  updateUser: (partial: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    try {
      const response = await AuthService.login({ email, password });
      const { user: rawUser, refreshToken } = response.data;
      const userData = rawUser
        ? ({
            ...rawUser,
            role: (rawUser.role ? String(rawUser.role).toLowerCase() : "viewer") as any,
          } as User)
        : null;

      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);

      set({
        user: userData,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      throw error;
    }
  },

  logout: async () => {
    try {
      await AuthService.logout();
    } catch {
      // ignore
    }
    get().clearAuth();
  },

  checkAuth: async () => {
    try {
      const response = await AuthService.getCurrentUser();
      const rawUser = response.data;
      const userData = rawUser
        ? ({
            ...rawUser,
            role: (rawUser.role ? String(rawUser.role).toLowerCase() : "viewer") as any,
          } as User)
        : null;
      set({
        user: userData,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      console.warn("checkAuth failed:", error);
      get().clearAuth();
    }
  },

  clearAuth: () => {
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);

    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  updateUser: (partial: Partial<User>) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...partial } : state.user,
    })),
}));
