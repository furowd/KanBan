type Status = "todo" | "doing" | "done";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  ALLOWED_ORIGINS?: string;
};

const allowedStatuses: readonly Status[] = ["todo", "doing", "done"];

function isStatus(value: unknown): value is Status {
  return allowedStatuses.some((status) => status === value);
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (
    env.ALLOWED_ORIGINS || "http://localhost:5173"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function supabaseRequest(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
  return fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      ...init.headers,
    },
  });
}

function databaseError(status: number): Response {
  return json(
    { detail: "The database request failed. Check the API configuration and try again." },
    status,
  );
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  if (method === "GET" && url.pathname === "/cards") {
    const response = await supabaseRequest(
      env,
      "cards?select=*&order=created_at.asc",
    );
    if (!response.ok) return databaseError(502);
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  if (method === "POST" && url.pathname === "/cards") {
    const body = await readJson(request);
    if (!isRecord(body) || typeof body.title !== "string") {
      return json({ detail: "A card title is required." }, 422);
    }

    const response = await supabaseRequest(env, "cards?select=*", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ title: body.title, status: "todo" }),
    });
    if (!response.ok) return databaseError(502);

    const cards = (await response.json()) as unknown[];
    if (!cards[0]) return json({ detail: "The card could not be created." }, 502);
    return json(cards[0], 201);
  }

  const cardMatch = url.pathname.match(/^\/cards\/(\d+)$/);
  if (cardMatch && BigInt(cardMatch[1]) <= 0n) {
    return json({ detail: "Card ID must be greater than zero." }, 422);
  }

  if (cardMatch && method === "PATCH") {
    const body = await readJson(request);
    if (!isRecord(body) || !isStatus(body.status)) {
      return json(
        { detail: "Status must be todo, doing, or done." },
        422,
      );
    }

    const response = await supabaseRequest(
      env,
      `cards?id=eq.${cardMatch[1]}&select=*`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status: body.status }),
      },
    );
    if (!response.ok) return databaseError(502);

    const cards = (await response.json()) as unknown[];
    if (!cards[0]) return json({ detail: "Card not found." }, 404);
    return json(cards[0]);
  }

  if (cardMatch && method === "DELETE") {
    const response = await supabaseRequest(
      env,
      `cards?id=eq.${cardMatch[1]}`,
      { method: "DELETE" },
    );
    if (!response.ok) return databaseError(502);
    return new Response(null, { status: 204 });
  }

  return json({ detail: "Not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(request, env);
    const origin = request.headers.get("Origin");
    const allowsOrigin = headers.has("Access-Control-Allow-Origin");

    if (origin && !allowsOrigin) {
      return json({ detail: "Origin is not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: origin ? headers : undefined,
      });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
      console.error("SUPABASE_URL and SUPABASE_KEY must be configured.");
      return json({ detail: "The API is not configured." }, 500, headers);
    }

    try {
      const response = await handleRequest(request, env);
      const responseHeaders = new Headers(response.headers);
      headers.forEach((value, key) => responseHeaders.set(key, value));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error("Kanban API request failed:", error);
      return json({ detail: "The API could not complete the request." }, 502, headers);
    }
  },
};
