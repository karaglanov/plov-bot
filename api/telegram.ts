// Сюда Telegram присылает все события (сообщения, кнопки, посты канала).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { handleUpdate } from "../lib/flow";
import { webhookSecret } from "../lib/tg";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(200).send("ok");
  if (req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret()) return res.status(401).send("no");
  // Отвечаем Telegram сразу, а работу (в том числе написание поста) продолжаем в фоне.
  waitUntil(handleUpdate(req.body).catch((e) => console.error("update failed", e)));
  return res.status(200).json({ ok: true });
}
