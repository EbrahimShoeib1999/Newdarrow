import { create } from "zustand";
import type { User } from "@/features/auth/types/auth.types";
import { mapFirestoreUser } from "@/features/auth/utils/map-user";
import { AuthService } from "@/features/auth/api/auth.service";
import { STORAGE_KEYS } from "@/lib/constants";
import { onIdTokenChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearAuth: () => void;
  updateUser: (partial: Partial<User>) => void;
  initialize: () => () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    try {
      const response = await AuthService.login({ email, password });
      const { user: userData, refreshToken } = response.data;
      
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

  loginWithGoogle: async () => {
    try {
      const response = await AuthService.loginWithGoogle();
      const { user: userData, refreshToken } = response.data;

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
    await AuthService.logout();
    get().clearAuth();
  },

  checkAuth: async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const tokenResult = await currentUser.getIdTokenResult(true);
        const customClaims = (tokenResult.claims as Record<string, unknown>) || {};
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (auth.currentUser?.uid !== currentUser.uid) return;
        const userData = userDoc.exists() ? userDoc.data() : undefined;
        const user = mapFirestoreUser(
          currentUser.uid,
          userData,
          {
            email: currentUser.email || "",
            name: currentUser.displayName || currentUser.email?.split("@")[0] || "User",
            avatar: currentUser.photoURL || `https://avatar.vercel.sh/${currentUser.uid}`,
          },
          customClaims
        );
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (error) {
        console.warn("checkAuth failed:", error);
      }
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

  initialize: () => {
    set({ user: null, isAuthenticated: false, isLoading: true });
    let callbackVersion = 0;
    // onIdTokenChanged also observes account switches and refreshed custom claims.
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      const version = ++callbackVersion;
      if (firebaseUser) {
        const sameAuthenticatedUser =
          get().isAuthenticated && get().user?.id === firebaseUser.uid;
        if (!sameAuthenticatedUser) {
          set({ user: null, isAuthenticated: false, isLoading: true });
        }
        let userData: any = undefined;
        let customClaims: Record<string, unknown> = {};
        try {
          const tokenResult = await firebaseUser.getIdTokenResult();
          customClaims = (tokenResult.claims as Record<string, unknown>) || {};
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc.exists()) {
            userData = userDoc.data();
          }
        } catch (error) {
          console.warn("Could not fetch user document or claims during initialize", {
            code:
              error && typeof error === "object" && "code" in error
                ? String(error.code)
                : "unknown",
          });
        }

        if (
          version !== callbackVersion ||
          auth.currentUser?.uid !== firebaseUser.uid
        ) {
          return;
        }
        const user = mapFirestoreUser(
          firebaseUser.uid,
          userData,
          {
            email: firebaseUser.email || "",
            name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
            avatar: firebaseUser.photoURL || `https://avatar.vercel.sh/${firebaseUser.uid}`,
          },
          customClaims
        );

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        if (version !== callbackVersion) return;
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    });

    return () => {
      callbackVersion += 1;
      unsubscribe();
    };
  },
}));
