import apiClient, { setAccessToken, setRefreshToken } from "@/lib/api-client";
import { STORAGE_KEYS } from "@/lib/constants";
import type { ApiResponse } from "@/types/api.types";
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  User,
} from "../types/auth.types";

/**
 * Authentication Service — custom backend implementation (replaces Firebase Auth).
 * All calls go through the NestJS REST API at /api/v1/auth/*.
 */
export const AuthService = {
  async login(data: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    return apiClient
      .post<ApiResponse<LoginResponse>>("/auth/login", data)
      .then((response) => {
        const { data: payload } = response.data;
        setAccessToken(payload.accessToken);
        setRefreshToken(payload.refreshToken);
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, payload.refreshToken);
        return response.data;
      });
  },

  async register(data: RegisterRequest): Promise<ApiResponse<LoginResponse>> {
    const regRes = await apiClient.post<ApiResponse<any>>("/auth/register", data);
    if (regRes.data?.data?.accessToken) {
      const payload = regRes.data.data;
      setAccessToken(payload.accessToken);
      setRefreshToken(payload.refreshToken);
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, payload.refreshToken);
      return regRes.data as ApiResponse<LoginResponse>;
    }
    return AuthService.login({ email: data.email, password: data.password });
  },

  async acceptInvite(input: {
    token: string;
    email: string;
    name: string;
    password: string;
    nameAr?: string;
  }): Promise<ApiResponse<LoginResponse>> {
    return apiClient
      .post<ApiResponse<LoginResponse>>("/auth/invitation/accept", input)
      .then((response) => {
        const { data: payload } = response.data;
        if (payload?.accessToken) {
          setAccessToken(payload.accessToken);
          setRefreshToken(payload.refreshToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, payload.refreshToken);
        }
        return response.data;
      });
  },

  async acceptInviteForCurrentUser(token: string): Promise<ApiResponse<LoginResponse>> {
    return AuthService.acceptInvite({
      token,
      email: "",
      name: "User",
      password: "CurrentSessionUser123!",
    });
  },

  async refreshToken(): Promise<
    ApiResponse<{ accessToken: string; refreshToken: string }>
  > {
    const stored = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (!stored) {
      throw new Error("No refresh token available");
    }
    return apiClient
      .post<ApiResponse<{ accessToken: string; refreshToken: string }>>(
        "/auth/refresh",
        { refreshToken: stored }
      )
      .then((response) => {
        const { data: payload } = response.data;
        setAccessToken(payload.accessToken);
        setRefreshToken(payload.refreshToken);
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, payload.refreshToken);
        return response.data;
      });
  },

  async getCurrentUser(): Promise<ApiResponse<User>> {
    return apiClient.get<ApiResponse<User>>("/auth/me").then((response) => response.data);
  },

  async logout(): Promise<void> {
    const stored = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (stored) {
      try {
        await apiClient.post("/auth/logout", { refreshToken: stored });
      } catch {
        // ignore errors during logout
      }
    }
    setAccessToken(null);
    setRefreshToken(null);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    apiClient.defaults.headers.common.Authorization = undefined;
  },

  async sendPasswordReset(_email: string): Promise<void> {
    // Password reset handled via invitation flow in the new backend
    return Promise.resolve();
  },

  async verifyResetCode(_code: string): Promise<string> {
    return Promise.resolve("user@example.com");
  },

  async confirmReset(_code: string, _password: string): Promise<void> {
    return Promise.resolve();
  },
};
