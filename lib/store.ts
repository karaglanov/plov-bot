// Хранилище: Upstash Redis (подключается в Vercel одной кнопкой). Без него работает в памяти (только для тестов).
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasDb = Boolean(url && token);
const redis = hasDb ? new Redis({ url: url!, token: token! }) : null;
const P = "plov:";

// --- запасной вариант в памяти (тесты)
const mem = new Map<string, any>();

export async function getJSON<T>(key: string): Promise<T | null> {
  if (redis) return ((await redis.get<T>(P + key)) ?? null) as T | null;
  return mem.has(key) ? structuredClone(mem.get(key)) : null;
}
export async function setJSON(key: string, value: unknown, ttlSec?: number): Promise<void> {
  if (redis) {
    if (ttlSec) await redis.set(P + key, value, { ex: ttlSec });
    else await redis.set(P + key, value);
    return;
  }
  mem.set(key, structuredClone(value));
}
/** true, если ключ создан сейчас (то есть раньше его не было). */
export async function once(key: string, ttlSec: number): Promise<boolean> {
  if (redis) return (await redis.set(P + key, 1, { nx: true, ex: ttlSec })) === "OK";
  if (mem.has(key)) return false;
  mem.set(key, 1);
  return true;
}
export async function del(key: string): Promise<void> {
  if (redis) await redis.del(P + key);
  else mem.delete(key);
}
export async function push(key: string, item: unknown, cap: number): Promise<void> {
  if (redis) {
    await redis.rpush(P + key, item);
    await redis.ltrim(P + key, -cap, -1);
    return;
  }
  const a: any[] = mem.get(key) || [];
  a.push(structuredClone(item));
  mem.set(key, a.slice(-cap));
}
export async function list<T>(key: string): Promise<T[]> {
  if (redis) return ((await redis.lrange<T>(P + key, 0, -1)) || []) as T[];
  return structuredClone(mem.get(key) || []);
}
export async function hset(key: string, field: string | number, value: unknown): Promise<void> {
  if (redis) {
    await redis.hset(P + key, { [String(field)]: value });
    return;
  }
  const h = mem.get(key) || {};
  h[String(field)] = structuredClone(value);
  mem.set(key, h);
}
export async function hget<T>(key: string, field: string | number): Promise<T | null> {
  if (redis) return ((await redis.hget<T>(P + key, String(field))) ?? null) as T | null;
  const h = mem.get(key) || {};
  return String(field) in h ? structuredClone(h[String(field)]) : null;
}
export async function hdel(key: string, field: string | number): Promise<void> {
  if (redis) {
    await redis.hdel(P + key, String(field));
    return;
  }
  const h = mem.get(key) || {};
  delete h[String(field)];
  mem.set(key, h);
}
export async function hall<T>(key: string): Promise<Record<string, T>> {
  if (redis) return ((await redis.hgetall<Record<string, T>>(P + key)) || {}) as Record<string, T>;
  return structuredClone(mem.get(key) || {});
}
export async function ping(): Promise<boolean> {
  if (!redis) return false;
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}

// --- типы данных
export interface Config {
  ownerId?: number;
  ownerName?: string;
  approvers?: number[];
  adminChat?: number;
  draftsThread?: number;
  ideaThreads?: number[];
  channelId?: number;
  discussionChat?: number;
  baseUrl?: string;
  botId?: number;
  botUsername?: string;
}
export async function getConfig(): Promise<Config> {
  return (await getJSON<Config>("cfg")) || {};
}
export async function patchConfig(patch: Partial<Config>): Promise<Config> {
  const cfg = { ...(await getConfig()), ...patch };
  await setJSON("cfg", cfg);
  return cfg;
}

export interface Idea {
  id: number; // id сообщения в группе админов
  thread?: number;
  topic?: string;
  author: string;
  text: string;
  date: number;
  media?: string;
}
export interface LogLine {
  id: number;
  topic?: string;
  author: string;
  text: string;
  date: number;
}
export interface Comment {
  id: number;
  author: string;
  text: string;
  date: number;
  postId?: number;
}
export interface Post {
  id: number;
  date: number;
  text: string;
}
export interface Draft {
  id: string;
  created: number;
  slot: string; // дата выхода ГГГГ-ММ-ДД (по времени канала)
  topic: string;
  source: string;
  html: string;
  imagePrompt: string;
  alts: string[];
  note?: string;
  ideaIds: number[];
  status: "pending" | "approved" | "published" | "cancelled";
  photo?: string;
  previewMsg?: number;
  controlMsg?: number;
  finalMsg?: number;
  noPhotoOk?: boolean;
  revisions: string[];
  publishedId?: number;
}
export async function saveDraft(d: Draft): Promise<void> {
  await setJSON("draft:" + d.id, d);
  await hset("drafts", d.id, { status: d.status, slot: d.slot, created: d.created });
}
export async function getDraft(id: string): Promise<Draft | null> {
  return getJSON<Draft>("draft:" + id);
}
