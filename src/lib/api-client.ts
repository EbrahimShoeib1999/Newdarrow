import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { API_BASE_URL } from "./constants";
import { STORAGE_KEYS } from "./constants";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

let accessToken: string | null = null;
let refreshToken: string | null = null;
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

// Request interceptor: attach Bearer token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 with refresh token rotation
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (!isRefreshing) {
        isRefreshing = true;
        originalRequest._retry = true;

        try {
          const storedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
          if (!storedRefresh) {
            throw new Error("No refresh token");
          }

          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refreshToken: storedRefresh,
          });

          const { accessToken: newAccessToken, refreshToken: newRefreshToken } = response.data.data;
          setAccessToken(newAccessToken);
          setRefreshToken(newRefreshToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, newRefreshToken);
          apiClient.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;
          onRefreshed(newAccessToken);
          isRefreshing = false;

          return apiClient(originalRequest);
        } catch (refreshError) {
          isRefreshing = false;
          return Promise.reject(refreshError);
        }
      }

      return new Promise((resolve) => {
        addRefreshSubscriber((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(apiClient(originalRequest));
        });
      });
    }

    return Promise.reject(error);
  }
);

export default apiClient;
