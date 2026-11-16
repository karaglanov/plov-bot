// Минимальный клиент Telegram Bot API.
import { createHash, createHmac } from "node:crypto";

export const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim().replace(/^bot/i, "");
export const CHANNEL = normalizeChannel(process.env.CHANNEL || "@marketing_plov");

function normalizeChannel(c: string): string | number {
  c = c.trim().replace(/^https?:\/\/t\.me\//, "");
  if (/^-?\d+$/.test(c)) return Number(c);
  return c.startsWith("@") ? c : "@" + c;
}

export class TgError extends Error {
  constructor(public method: string, public code: number, public description: string) {
    super(`Telegram ${method}: ${code} ${description}`);
  }
}

export async function tg<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const j: any = await r.json().catch(() => ({ ok: false, error_code: r.status, description: "bad response" }));
  if (!j.ok) throw new TgError(method, j.error_code, j.description || "");
  return j.result as T;
}

export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Отправка HTML-сообщения. Если Telegram не принял разметку, отправляет тем же текстом без неё. */
export async function sendHtml(chat: number | string, html: string, extra: Record<string, unknown> = {}): Promise<any> {
  try {
    return await tg("sendMessage", { chat_id: chat, text: html, parse_mode: "HTML", ...extra });
  } catch (e) {
    if (e instanceof TgError && e.code === 400 && /parse entities|unsupported start tag|can't find end tag/i.test(e.description)) {
      return await tg("sendMessage", { chat_id: chat, text: stripTags(html), ...extra });
    }
    throw e;
  }
}

export function webhookSecret(): string {
  return createHash("sha256").update("hook:" + TOKEN).digest("hex").slice(0, 40);
}
export function signFile(fileId: string): string {
  return createHmac("sha256", TOKEN).update(fileId).digest("hex").slice(0, 32);
}
export function imageUrl(baseUrl: string, fileId: string): string {
  return `${baseUrl}/api/img?f=${encodeURIComponent(fileId)}&s=${signFile(fileId)}`;
}

export function userName(u: any): string {
  if (!u) return "Аноним";
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.title || u.username || "Аноним";
}
