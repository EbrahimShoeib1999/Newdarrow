import apiClient, { setAccessToken, setRefreshToken } from "@/lib/api-client";
import { STORAGE_KEYS } from "@/lib/constants";
import type { ApiResponse } from "@/types/api.types";
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  User,
} from "../types/auth.types";

const SERVICE_NAME = "AuthService";

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
    return apiClient
      .post<ApiResponse<LoginResponse>>("/auth/register", data)
      .then((response) => {
        const { data: payload } = response.data;
        setAccessToken(payload.accessToken);
        setRefreshToken(payload.refreshToken);
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, payload.refreshToken);
        return response.data;
      });
  },

  async acceptInvite(input: {
    token: string;
    name: string;
    password: string;
  }): Promise<ApiResponse<LoginResponse>> {
    return apiClient
      .post<ApiResponse<LoginResponse>>("/auth/invitation/accept", input)
      .then((response) => {
        const { data: payload } = response.data;
        setAccessToken(payload.accessToken);
        setRefreshToken(payload.refreshToken);
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, payload.refreshToken);
        return response.data;
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
    return apiClient.get<ApiResponse<User>>("/auth/me");
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

  async sendPasswordReset(email: string): Promise<void> {
    // Password reset handled via invitation flow in the new backend
    return Promise.resolve();
  },
};
