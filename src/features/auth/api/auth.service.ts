import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut, 
  getIdToken,
  updateProfile,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  User,
} from "../types/auth.types";
import { mapFirestoreUser } from "../utils/map-user";
import { InvitesService } from "@/features/companies/api/invites.service";
import { STORAGE_KEYS } from "@/lib/constants";
import { DEFAULT_COMPANY_NAME } from "@/lib/constants/company";
import { isReservedCompanyName } from "@/lib/company-defaults";
import { acceptInvitationForUser } from "./invitation-onboarding";

const SERVICE_NAME = "AuthService";
const googleProvider = new GoogleAuthProvider();

async function buildLoginResponse(
  firebaseUser: {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    refreshToken: string;
    getIdToken: (forceRefresh?: boolean) => Promise<string>;
    getIdTokenResult?: (forceRefresh?: boolean) => Promise<{ claims: Record<string, unknown> }>;
  },
  userData: Record<string, unknown> | undefined
): Promise<LoginResponse> {
  const idToken = await firebaseUser.getIdToken();
  let customClaims: Record<string, unknown> | undefined;
  if (typeof firebaseUser.getIdTokenResult === "function") {
    try {
      const res = await firebaseUser.getIdTokenResult();
      customClaims = res.claims;
    } catch {
      // ignore
    }
  }
  const user = mapFirestoreUser(
    firebaseUser.uid,
    userData,
    {
      email: firebaseUser.email || "",
      name: firebaseUser.displayName || "",
      avatar: firebaseUser.photoURL || "",
      companyName: DEFAULT_COMPANY_NAME,
    },
    customClaims
  );

  return {
    user,
    accessToken: idToken,
    refreshToken: firebaseUser.refreshToken,
  };
}

/**
 * Authentication Service
 * Handles user login, registration, and session management.
 */
export const AuthService = {
  async login(data: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    return withLogging(SERVICE_NAME, "login", (async () => {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        data.email,
        data.password
      );
      
      const firebaseUser = userCredential.user;

      let userData: Record<string, unknown> | undefined;
      try {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        userData = userDoc.data() as Record<string, unknown> | undefined;

        if (!userDoc.exists()) {
          // Provision a placeholder profile, but do NOT graft a fabricated
          // tenant. The old hardcoded `companyId: "default-company"` silently
          // stranded these accounts in a fake workspace that never matched the
          // company-scoped `users` query, so they were invisible instead of
          // surfacing for reconciliation. An EMPTY companyId keeps the account
          // honest and findable by the reconciliation query (use-orphan-accounts).
          const defaultUserData: Partial<User> = {
            email: firebaseUser.email || "",
            name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
            nameAr: "",
            avatar: firebaseUser.photoURL || `https://avatar.vercel.sh/${firebaseUser.uid}`,
            role: "employee",
            companyId: "",
            companyName: "",
          };
          await setDoc(userDocRef, {
            ...defaultUserData,
            id: firebaseUser.uid,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          userData = defaultUserData as Record<string, unknown>;
        }
      } catch (err) {
        console.warn("Could not fetch or create user document during login:", err);
      }

      return {
        data: await buildLoginResponse(firebaseUser, userData),
        message: "Login successful",
      };
    })());
  },

  async loginWithGoogle(): Promise<ApiResponse<LoginResponse>> {
    return withLogging(SERVICE_NAME, "loginWithGoogle", (async () => {
      const userCredential = await signInWithPopup(auth, googleProvider);
      const firebaseUser = userCredential.user;
      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userDoc = await getDoc(userDocRef);
      let userData = userDoc.data() as Record<string, unknown> | undefined;

      if (!userDoc.exists()) {
        const displayName =
          firebaseUser.displayName ||
          firebaseUser.email?.split("@")[0] ||
          "User";
        const companyName = `${displayName}'s Workspace`;
        const companyId =
          `co-${firebaseUser.uid}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

        const newUser: User = {
          id: firebaseUser.uid,
          email: firebaseUser.email || "",
          name: displayName,
          nameAr: "",
          avatar:
            firebaseUser.photoURL ||
            `https://avatar.vercel.sh/${firebaseUser.uid}`,
          role: "admin",
          companyId,
          companyName,
        };

        await setDoc(userDocRef, {
          ...newUser,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        await setDoc(doc(db, "companies", companyId), {
          name: companyName,
          commercialRegister: "",
          defaultCurrency: "SAR",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        userData = newUser as unknown as Record<string, unknown>;
      }

      return {
        data: await buildLoginResponse(firebaseUser, userData),
        message: "Login successful",
      };
    })());
  },

  async register(data: RegisterRequest): Promise<ApiResponse<LoginResponse>> {
    return withLogging(SERVICE_NAME, "register", (async () => {
      // Prevent public registration from duplicating or claiming the DArrow organization
      if (isReservedCompanyName(data.companyName)) {
        throw new Error(
          "COMPANY_RESERVED: هذه الشركة مسجلة بالفعل في النظام. إذا كنت موظفاً، يُرجى طلب رابط دعوة من مسؤول الشركة أو تسجيل الدخول بدلاً من ذلك."
        );
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        data.email,
        data.password
      );

      const firebaseUser = userCredential.user;

      await updateProfile(firebaseUser, {
        displayName: data.name
      });

      const idToken = await getIdToken(firebaseUser);

      // Generate a collision-free, secure company ID decoupled from just the company name
      const cleanPrefix = data.companyName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 16) || "company";
      const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const generatedCompanyId = `${cleanPrefix}-${uniqueSuffix}`;
      const companySlug = cleanPrefix;

      const userData: User = {
        id: firebaseUser.uid,
        email: data.email,
        name: data.name,
        nameAr: "",
        avatar: `https://avatar.vercel.sh/${firebaseUser.uid}`,
        role: "admin",
        companyId: generatedCompanyId,
        companyName: data.companyName,
      };

      await setDoc(doc(db, "users", firebaseUser.uid), {
        ...userData,
        companyName: data.companyName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await setDoc(doc(db, "companies", userData.companyId), {
        id: userData.companyId,
        name: data.companyName,
        slug: companySlug,
        commercialRegister: data.commercialRegister?.trim() || "",
        defaultCurrency: "SAR",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return {
        data: {
          user: userData,
          accessToken: idToken,
          refreshToken: firebaseUser.refreshToken,
        },
        message: "Registration successful",
      };
    })());
  },

  async acceptInvite(input: {
    token: string;
    name: string;
    password: string;
  }): Promise<ApiResponse<LoginResponse>> {
    return withLogging(SERVICE_NAME, "acceptInvite", (async () => {
      const invite = await InvitesService.getByToken(input.token);
      if (!invite) {
        throw new Error("INVITE_NOT_FOUND");
      }
      if (invite.status === "expired" || new Date(invite.expiresAt).getTime() <= Date.now()) {
        throw new Error("INVITE_EXPIRED");
      }
      if (invite.status === "revoked") {
        throw new Error("INVITE_REVOKED");
      }
      if (invite.status === "accepted") {
        throw new Error("INVITE_ACCEPTED");
      }
      if (invite.status !== "pending") {
        throw new Error("INVITE_INVALID");
      }

      let firebaseUser;
      try {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          invite.email,
          input.password
        );
        firebaseUser = userCredential.user;
      } catch (authErr: any) {
        if (authErr?.code === "auth/email-already-in-use") {
          try {
            const loginCred = await signInWithEmailAndPassword(
              auth,
              invite.email,
              input.password
            );
            firebaseUser = loginCred.user;
          } catch (loginErr: any) {
            if (
              loginErr?.code === "auth/wrong-password" ||
              loginErr?.code === "auth/invalid-credential"
            ) {
              throw new Error("EXISTING_ACCOUNT_WRONG_PASSWORD");
            }
            throw loginErr;
          }
        } else {
          throw authErr;
        }
      }

      if (input.name.trim() && !firebaseUser.displayName) {
        try {
          await updateProfile(firebaseUser, {
            displayName: input.name.trim(),
          });
        } catch {
          // non-blocking
        }
      }

      const userData = await acceptInvitationForUser(
        db,
        firebaseUser,
        input.token,
        input.name
      );

      const idToken = await getIdToken(firebaseUser);
      try {
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, firebaseUser.refreshToken);
      } catch {
        // ignore
      }

      return {
        data: {
          user: userData,
          accessToken: idToken,
          refreshToken: firebaseUser.refreshToken,
        },
        message: "Invite accepted",
      };
    })());
  },

  async acceptInviteForCurrentUser(token: string): Promise<ApiResponse<LoginResponse>> {
    return withLogging(SERVICE_NAME, "acceptInviteForCurrentUser", (async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error("NO_CURRENT_USER");
      }
      const userData = await acceptInvitationForUser(db, firebaseUser, token);
      const idToken = await getIdToken(firebaseUser, true);

      return {
        data: {
          user: userData,
          accessToken: idToken,
          refreshToken: firebaseUser.refreshToken,
        },
        message: "Invite accepted",
      };
    })());
  },

  async refreshToken(): Promise<ApiResponse<{ accessToken: string; refreshToken: string }>> {
    return withLogging(SERVICE_NAME, "refreshToken", (async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error("No user logged in");
      }

      const idToken = await getIdToken(firebaseUser, true);
      return {
        data: {
          accessToken: idToken,
          refreshToken: firebaseUser.refreshToken,
        },
        message: "Token refreshed",
      };
    })());
  },

  async getCurrentUser(): Promise<ApiResponse<User>> {
    return withLogging(SERVICE_NAME, "getCurrentUser", (async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error("No user logged in");
      }

      const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
      const userData = userDoc.data() as any;
      
      const user = mapFirestoreUser(firebaseUser.uid, userData, {
        email: firebaseUser.email || "",
        name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
        avatar: firebaseUser.photoURL || `https://avatar.vercel.sh/${firebaseUser.uid}`,
      });

      return {
        data: user,
        message: "Success",
      };
    })());
  },

  async logout(): Promise<void> {
    return withLogging(SERVICE_NAME, "logout", signOut(auth));
  },

  async sendPasswordReset(email: string): Promise<void> {
    return withLogging(
      SERVICE_NAME,
      "sendPasswordReset",
      sendPasswordResetEmail(auth, email)
    );
  },

  async verifyResetCode(oobCode: string): Promise<string> {
    return withLogging(
      SERVICE_NAME,
      "verifyResetCode",
      verifyPasswordResetCode(auth, oobCode)
    );
  },

  async confirmReset(oobCode: string, newPassword: string): Promise<void> {
    return withLogging(
      SERVICE_NAME,
      "confirmReset",
      confirmPasswordReset(auth, oobCode, newPassword)
    );
  },
};
