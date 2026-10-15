import type { Card, Status } from "./types";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);

  if (!response.ok) {
    const responseText = await response.text();
    let message = responseText || `Request failed (${response.status})`;

    try {
      const body: { detail?: string } = JSON.parse(responseText);
      if (body.detail) message = body.detail;
    } catch {
      // Keep the response text when the server does not return JSON.
    }

    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getCards(): Promise<Card[]> {
  return request<Card[]>("/cards");
}

export function addCard(title: string): Promise<Card> {
  return request<Card>("/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function changeCardStatus(id: number, status: Status): Promise<Card> {
  return request<Card>(`/cards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export function removeCard(id: number): Promise<void> {
  return request<void>(`/cards/${id}`, { method: "DELETE" });
}
