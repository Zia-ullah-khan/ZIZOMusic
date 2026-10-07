import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const PRODUCTION_API_URL = "https://api.zizomusic.com";
export const DEV_API_URL = Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://127.0.0.1:8000";
export const API_URL = __DEV__ ? DEV_API_URL : PRODUCTION_API_URL;

const TOKEN_KEY = "sessionToken";

let sessionToken = "";

export function getSessionToken() {
  return sessionToken;
}

export async function apiFetch(path: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers,
        credentials: "include",
      });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    const delay = Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);
    await new Promise<void>((resolve) =>
    {
        setTimeout(() => resolve(), delay);
    });
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export async function ensureSession(): Promise<string> {
  if (!sessionToken) {
    const stored = await AsyncStorage.getItem(TOKEN_KEY);
    if (stored) {
      sessionToken = stored;
    }
  }

  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  const res = await fetch(`${API_URL}/session?client=native`, {
    method: "POST",
    headers,
  });
  if (!res.ok) {
    return "";
  }

  const data = await res.json();
  if (typeof data.token === "string" && data.token) {
    sessionToken = data.token;
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
  }
  if (typeof data.user_id === "string") {
    return data.user_id;
  }
  return "";
}

export function safeImageUrl(value: string | undefined | null): string {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return "";
  }

  const afterScheme = trimmed.replace(/^https?:\/\//i, "");
  if (afterScheme.includes("@")) {
    return "";
  }

  return trimmed;
}
