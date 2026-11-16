// Дверь для Claude из проекта (бесплатный режим): забрать задания и свежие данные, вернуть готовые посты.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { completeJob, exportData, listJobs, reportError } from "../lib/flow";
import { getConfig } from "../lib/store";

function authorized(req: VercelRequest): boolean {
  const key = process.env.AGENT_KEY || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (key.length < 16 || got.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(key));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    if (req.method === "GET") {
      const jobs = await listJobs();
      return res.status(200).json({ ok: true, jobs, data: req.query.data === "1" ? await exportData() : undefined });
    }
    if (req.method === "POST") {
      const { jobId, result, error } = req.body || {};
      if (error) {
        await reportError(await getConfig(), new Error("Claude не смог написать пост: " + String(error).slice(0, 200)));
        return res.status(200).json({ ok: true });
      }
      const type = await completeJob(String(jobId || ""), result);
      return res.status(200).json({ ok: true, done: type });
    }
    return res.status(405).json({ ok: false });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
}
