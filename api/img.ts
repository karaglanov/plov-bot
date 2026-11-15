// Отдаёт картинку поста по подписанной ссылке (токен бота наружу не уходит).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TOKEN, signFile, tg } from "../lib/tg";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const f = String(req.query.f || "");
  if (!f || String(req.query.s || "") !== signFile(f)) return res.status(403).send("no");
  try {
    const file = await tg("getFile", { file_id: f });
    const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
    if (!r.ok) return res.status(502).send("upstream");
    const ext = String(file.file_path).split(".").pop()?.toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    return res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch {
    return res.status(404).send("not found");
  }
}
