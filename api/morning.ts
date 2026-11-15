// Расписание Vercel, каждое утро: публикует одобренные посты и напоминает о неодобренных.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { morningJob } from "../lib/flow";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).send("no");
  try {
    return res.status(200).json({ ok: true, result: await morningJob() });
  } catch (e: any) {
    console.error("morning failed", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
