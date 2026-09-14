export const PRODUCTION_API_URL = "https://api.zizomusic.com";
export const DEV_API_URL = "http://localhost:8000";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "development" ? DEV_API_URL : PRODUCTION_API_URL);
