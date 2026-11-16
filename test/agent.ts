// Бесплатный режим: бот ставит задания в очередь, Claude из проекта забирает их и возвращает готовый пост.
const sent: { method: string; p: any }[] = [];
let nextId = 1000;
(globalThis as any).fetch = async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init?.body ? JSON.parse(init.body) : {};
  sent.push({ method, p });
  let result: any = true;
  if (method === "getMe") result = { id: 999, username: "plov_test_bot" };
  else if (method === "getChatMember") result = { status: "administrator" };
  else if (method.startsWith("send")) result = { message_id: nextId++ };
  return { ok: true, status: 200, json: async () => ({ ok: true, result }) } as any;
};
import assert from "node:assert";
import agent from "../api/agent";
import { eveningJob, handleUpdate } from "../lib/flow";
import { getDraft, hall, patchConfig } from "../lib/store";

const mk = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => ((r.code = c), r); r.json = (b: any) => ((r.body = b), r); return r; };
const call = async (method: string, body?: any, key = process.env.AGENT_KEY, query: any = {}) => { const r = mk(); await agent({ method, headers: { authorization: "Bearer " + key }, body, query } as any, r); return r; };
const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.p.text as string);
let uid = 1, mid = 10;
const say = (text: string, extra: any = {}) => handleUpdate({ update_id: uid++, message: { message_id: mid++, date: Math.floor(Date.now() / 1000), chat: { id: -100500, type: "supergroup" }, from: { id: 1, first_name: "Amet-Khan" }, text, is_topic_message: true, message_thread_id: 7, ...extra } });

(async () => {
  await patchConfig({ ownerId: 1, adminChat: -100500, draftsThread: 7, ideaThreads: [5] });
  assert.equal((await call("GET", undefined, "wrong-key-wrong-key-wrong")).code, 401);
  assert.equal((await call("GET", undefined, "")).code, 401);

  await say("Идея: пост про чаевые в кафе", { message_thread_id: 5 });
  // вечернее расписание и /post ставят задания, а не пишут сами
  assert.match(await eveningJob(), /задание на черновик/);
  await say("/post Как назвать кафе");
  assert.match(texts().at(-1)!, /при следующем запуске/);
  let r = await call("GET", undefined, undefined, { data: "1" });
  assert.equal(r.code, 200); assert.equal(r.body.jobs.length, 2);
  assert.equal(r.body.jobs[0].type, "draft"); assert.equal(r.body.jobs[0].input.ideas[0].text, "Идея: пост про чаевые в кафе");
  assert.equal(r.body.jobs[1].input.forcedTopic, "Как назвать кафе");
  assert.equal(r.body.data.ideas.length, 1);

  // плохой результат отклоняется, задание остаётся
  assert.equal((await call("POST", { jobId: r.body.jobs[0].id, result: { topic: "x" } })).code, 400);
  // хороший результат превращается в черновик в Telegram
  const good = { topic: "Чаевые", source: "идея от Amet-Khan (#10)", usedIdeas: [10], html: "<b>Чаевые</b>\n\nТекст", imagePrompt: "A tip jar", alts: ["А", "Б", "В"], note: "ок" };
  r = await call("POST", { jobId: r.body.jobs[0].id, result: good });
  assert.equal(r.code, 200); assert.equal(r.body.done, "draft");
  const control = sent.filter((s) => s.method === "sendMessage").at(-1)!;
  assert.match(control.p.text, /Черновик на/);
  const draftId = control.p.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
  let d = (await getDraft(draftId))!;
  assert.equal(d.alts.length, 2); assert.deepEqual(d.ideaIds, [10]);
  assert.equal(Object.keys(await hall("jobs")).length, 1);
  // повторная сдача того же задания не создаёт второй черновик
  assert.equal((await call("POST", { jobId: "nope", result: good })).code, 400);

  // правка: ставится задание, Claude возвращает новую версию
  await say("сделай короче", { reply_to_message: { message_id: d.controlMsg } });
  assert.match(texts().at(-1)!, /Записал правку/);
  await say("и добавь пример про чайхану", { reply_to_message: { message_id: d.controlMsg } });
  r = await call("GET");
  const rev = r.body.jobs.find((j: any) => j.type === "revise");
  assert.deepEqual(rev.instructions, ["сделай короче", "и добавь пример про чайхану"]);
  assert.equal(r.body.jobs.filter((j: any) => j.type === "revise").length, 1);
  r = await call("POST", { jobId: rev.id, result: { html: "<b>Чаевые</b>\n\nКороче", topic: "Чаевые" } });
  assert.equal(r.code, 200);
  d = (await getDraft(draftId))!;
  assert.match(d.html, /Короче/); assert.equal(d.imagePrompt, "A tip jar"); assert.equal(d.status, "pending");
  console.log("БЕСПЛАТНЫЙ РЕЖИМ: ВСЕ ПРОВЕРКИ ПРОШЛИ");
})().catch((e) => { console.error(e); process.exit(1); });
