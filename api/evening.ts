// Расписание Vercel, каждый вечер: готовит черновик на завтра (если завтра день поста) и по воскресеньям сводку.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { eveningJob } from "../lib/flow";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).send("no");
  try {
    return res.status(200).json({ ok: true, result: await eveningJob() });
  } catch (e: any) {
    console.error("evening failed", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
