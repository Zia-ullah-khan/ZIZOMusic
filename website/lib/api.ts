export const PRODUCTION_API_URL = "https://api.zizomusic.com";
export const DEV_API_URL = "http://localhost:8000";

export const API_URL =
    process.env.NEXT_PUBLIC_API_URL ||
    (process.env.NODE_ENV === "development" ? DEV_API_URL : PRODUCTION_API_URL);

export function safeImageUrl(value: string | undefined | null): string
{
    if (typeof value !== "string" || !value)
    {
        return "";
    }

    if (value.startsWith("/images/") || value.startsWith("/logo"))
    {
        return value;
    }

    try
    {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        {
            return "";
        }
        if (parsed.username || parsed.password)
        {
            return "";
        }
        return parsed.href;
    }
    catch
    {
        return "";
    }
}

export function mediaUrl(path: string): string
{
    if (!path.startsWith("/hls/") && !path.startsWith("/stream/"))
    {
        return "";
    }
    return `${API_URL}${path}`;
}

export async function apiFetch(path: string, init: RequestInit = {}, attempts = 4): Promise<Response>
{
    const headers = new Headers(init.headers || {});
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++)
    {
        try
        {
            const response = await fetch(`${API_URL}${path}`, {
                ...init,
                credentials: "include",
                headers,
            });
            if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429))
            {
                return response;
            }
            lastError = new Error(`HTTP ${response.status}`);
        }
        catch (error)
        {
            lastError = error;
        }

        const delay = Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export async function ensureSession(): Promise<string>
{
    try
    {
        const res = await apiFetch("/session", { method: "POST" });
        if (!res.ok)
        {
            return "";
        }
        const data = await res.json();
        return typeof data.user_id === "string" ? data.user_id : "";
    }
    catch
    {
        return "";
    }
}
