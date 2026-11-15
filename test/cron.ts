// Проверка расписания: вечером черновик на завтра, утром публикация одобренного и напоминание.
process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.MOCK_CLAUDE = "1";
process.env.POST_DAYS = "0,1,2,3,4,5,6";
const sent: { method: string; p: any }[] = [];
let nextId = 1000;
(globalThis as any).fetch = async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init?.body ? JSON.parse(init.body) : {};
  sent.push({ method, p });
  let result: any = true;
  if (method === "getMe") result = { id: 999, username: "plov_test_bot" };
  else if (method === "getChatMember") result = { status: "administrator" };
  else if (method === "getChatMemberCount") result = 345;
  else if (method.startsWith("send")) result = { message_id: nextId++ };
  return { ok: true, status: 200, json: async () => ({ ok: true, result }) } as any;
};
import assert from "node:assert";
import { eveningJob, morningJob } from "../lib/flow";
import { getDraft, hall, patchConfig, saveDraft } from "../lib/store";
(async () => {
  assert.equal(await eveningJob(), "бот не настроен");
  await patchConfig({ ownerId: 1, adminChat: -100500, draftsThread: 7 });
  const r1 = await eveningJob();
  assert.match(r1, /черновик на \d{4}-\d\d-\d\d/);
  assert.doesNotMatch(await eveningJob(), /черновик/); // второй раз за вечер не пишет
  const [id] = Object.keys(await hall("drafts"));
  const d = (await getDraft(id))!;
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  // пост на сегодня не одобрен -> напоминание, один раз
  d.slot = today; await saveDraft(d);
  assert.match(await morningJob(), /напоминание/);
  assert.equal(await morningJob(), "нечего делать");
  // одобрен -> публикуется, один раз
  d.status = "approved"; await saveDraft(d);
  assert.match(await morningJob(), /опубликован/);
  assert.equal((await getDraft(id))!.status, "published");
  assert.equal(sent.filter((s) => s.p.chat_id === "@marketing_plov" && s.method === "sendMessage").length, 1);
  assert.equal(await morningJob(), "нечего делать");
  console.log("РАСПИСАНИЕ: ВСЕ ПРОВЕРКИ ПРОШЛИ");
})().catch((e) => { console.error(e); process.exit(1); });
