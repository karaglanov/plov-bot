// Прогон всего сценария без Telegram и без Claude: Telegram подменён, Claude в режиме MOCK_CLAUDE.
process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.MOCK_CLAUDE = "1";
process.env.CHANNEL = "@marketing_plov";

const sent: { method: string; p: any }[] = [];
let nextId = 1000;
(globalThis as any).fetch = async (url: string, init: any) => {
  const method = String(url).split("/").pop()!;
  const p = init?.body ? JSON.parse(init.body) : {};
  sent.push({ method, p });
  let result: any = true;
  if (method === "getMe") result = { id: 999, username: "plov_test_bot" };
  else if (method === "getChatMember") result = { status: "administrator", can_post_messages: true };
  else if (method === "getChatMemberCount") result = 345;
  else if (method === "sendMessage" || method === "sendPhoto") result = { message_id: nextId++, chat: { id: p.chat_id } };
  return { ok: true, status: 200, json: async () => ({ ok: true, result }) } as any;
};

import assert from "node:assert";
import { handleUpdate, eveningJob, morningJob } from "../lib/flow";
import { getConfig, getDraft, hall, list, patchConfig } from "../lib/store";

const ADMIN = -100500, DISC = -100700, CH = -100900, AMET = 1, YANA = 2;
const topic = (name: string) => ({ forum_topic_created: { name } });
let uid = 1, mid = 10;
const msg = (o: any) => ({ update_id: uid++, message: { message_id: mid++, date: Math.floor(Date.now() / 1000), chat: { id: ADMIN, type: "supergroup" }, ...o } });
const lastOf = (m: string) => [...sent].reverse().find((s) => s.method === m)!;
const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.p.text as string);

(async () => {
  await patchConfig({ baseUrl: "https://plov.example" });

  // 1. чужой человек не может настроить, если он не админ
  // (в моке все админы, поэтому проверяем основной путь)
  await handleUpdate(msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "/start", is_topic_message: true, message_thread_id: 7, reply_to_message: topic("Контент Production") }));
  let cfg = await getConfig();
  assert.equal(cfg.ownerId, AMET); assert.equal(cfg.adminChat, ADMIN); assert.equal(cfg.draftsThread, 7);
  assert.match(texts().at(-1)!, /Готово/);

  // 2. идея в теме «Идеи контента» сохраняется, тема определяется по названию
  await handleUpdate(msg({ from: { id: YANA, first_name: "Яна" }, text: "Давайте пост про коллтрекинг для кафе", is_topic_message: true, message_thread_id: 5, reply_to_message: topic("Идеи контента") }));
  await handleUpdate(msg({ from: { id: YANA, first_name: "Яна" }, text: "просто болтаем", is_topic_message: true, message_thread_id: 3, reply_to_message: topic("Планирование") }));
  cfg = await getConfig();
  assert.deepEqual(cfg.ideaThreads, [5]);
  assert.equal((await list<any>("ideas")).length, 1);
  assert.equal((await list<any>("log")).length, 2);
  assert.equal(lastOf("setMessageReaction").p.reaction[0].emoji, "👀");

  // 3. /post от не-владельца игнорируется, от владельца создаёт черновик
  const before = sent.length;
  await handleUpdate(msg({ from: { id: YANA, first_name: "Яна" }, text: "/post", is_topic_message: true, message_thread_id: 7 }));
  assert.equal(sent.length, before);
  await handleUpdate(msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "/post", is_topic_message: true, message_thread_id: 7 }));
  const control = lastOf("sendMessage");
  assert.match(control.p.text, /Черновик на/); assert.match(control.p.text, /Промпт для картинки/);
  assert.equal(control.p.message_thread_id, 7);
  const kb = control.p.reply_markup.inline_keyboard;
  const draftId = kb[0][0].callback_data.split(":")[1];
  let d = (await getDraft(draftId))!;
  assert.equal(d.status, "pending"); assert.deepEqual(d.ideaIds, [11]);
  assert.equal(Object.keys(await hall("idea_used")).length, 1);
  console.log("кнопки:", kb.map((r: any) => r.map((b: any) => b.text).join(" | ")).join("\n        "));

  const press = (from: number, action: string, id = draftId) => handleUpdate({ update_id: uid++, callback_query: { id: "cq" + uid, from: { id: from }, data: `d:${id}:${action}` } });

  // 4. чужой не может нажать кнопку
  await press(YANA, "ok");
  assert.match(lastOf("answerCallbackQuery").p.text, /только у владельца/);
  // 5. одобрение без картинки сначала предупреждает
  await press(AMET, "ok");
  assert.match(lastOf("answerCallbackQuery").p.text, /Картинки пока нет/);
  assert.equal((await getDraft(draftId))!.status, "pending");

  // 6. правка текстом в ответ на черновик
  await handleUpdate(msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "сделай короче", is_topic_message: true, message_thread_id: 7, reply_to_message: { message_id: d.controlMsg } }));
  d = (await getDraft(draftId))!;
  assert.match(d.html, /правка: сделай короче/); assert.deepEqual(d.revisions, ["сделай короче"]);

  // 7. картинка ответом (от дизайнера), показывается итоговый вид
  await handleUpdate(msg({ from: { id: YANA, first_name: "Яна" }, photo: [{ file_id: "small" }, { file_id: "BIG" }], is_topic_message: true, message_thread_id: 7, reply_to_message: { message_id: d.controlMsg } }));
  d = (await getDraft(draftId))!;
  assert.equal(d.photo, "BIG");
  assert.equal(sent.filter((s) => s.method === "sendPhoto").at(-1)!.p.chat_id, ADMIN);

  // 8. одобрение -> утром публикация в канал
  await press(AMET, "ok");
  assert.equal((await getDraft(draftId))!.status, "approved");
  // слот в будущем, утренняя задача сегодня ничего не публикует
  assert.equal(sent.filter((s) => s.p.chat_id === "@marketing_plov" && s.method !== "getChatMember").length, 0);
  await press(AMET, "now");
  d = (await getDraft(draftId))!;
  assert.equal(d.status, "published");
  const pub = sent.filter((s) => s.p.chat_id === "@marketing_plov" && s.method === "sendPhoto");
  assert.equal(pub.length, 1); assert.equal(pub[0].p.photo, "BIG"); assert.match(pub[0].p.caption, /правка/);
  assert.match(texts().at(-1)!, /Опубликовано/);
  assert.equal((await list<any>("posts")).length, 1);

  // 9. длинный пост с картинкой уходит одним сообщением с превью
  await handleUpdate(msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "/post Длинная тема", is_topic_message: true, message_thread_id: 7 }));
  const id2 = lastOf("sendMessage").p.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
  let d2 = (await getDraft(id2))!;
  d2.html = "<b>Длинный</b> " + "текст ".repeat(300); d2.photo = "PIC2";
  const { saveDraft } = await import("../lib/store"); await saveDraft(d2);
  await press(AMET, "now", id2);
  const long = sent.filter((s) => s.p.chat_id === "@marketing_plov" && s.method === "sendMessage").at(-1)!;
  assert.match(long.p.link_preview_options.url, /^https:\/\/plov\.example\/api\/img\?f=PIC2&s=[0-9a-f]{32}$/);
  assert.equal(long.p.link_preview_options.show_above_text, true);

  // 10. «другая тема»: старый отменяется, идеи возвращаются, пишется новый
  await handleUpdate(msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "/post", is_topic_message: true, message_thread_id: 7 }));
  const id3 = lastOf("sendMessage").p.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
  await press(AMET, "alt0", id3);
  assert.equal((await getDraft(id3))!.status, "cancelled");
  const id4 = lastOf("sendMessage").p.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
  assert.notEqual(id4, id3); assert.equal((await getDraft(id4))!.topic, "Запасная тема А");

  // 11. комментарии: авто-копия поста и комментарий к нему
  await handleUpdate({ update_id: uid++, message: { message_id: 500, date: 1, chat: { id: DISC, type: "supergroup" }, is_automatic_forward: true, sender_chat: { id: CH, username: "marketing_plov" }, forward_origin: { message_id: 77 }, text: "пост" } });
  await handleUpdate({ update_id: uid++, message: { message_id: 501, date: Math.floor(Date.now() / 1000), chat: { id: DISC, type: "supergroup" }, from: { id: 55, first_name: "Подписчик" }, text: "А как это в кафе применить?", message_thread_id: 500 } });
  const comments = await list<any>("comments");
  assert.equal(comments.length, 1); assert.equal(comments[0].postId, 77);
  assert.equal((await getConfig()).discussionChat, DISC);

  // 12. сообщения из чужих групп игнорируются
  const n = sent.length;
  await handleUpdate({ update_id: uid++, message: { message_id: 1, date: 1, chat: { id: -42, type: "supergroup" }, from: { id: 66 }, text: "/post" } });
  await handleUpdate({ update_id: uid++, message: { message_id: 2, date: 1, chat: { id: -42, type: "supergroup" }, from: { id: 66 }, text: "/start" } });
  assert.equal(sent.length, n); assert.equal((await getConfig()).adminChat, ADMIN);

  // 13. повтор того же update не обрабатывается дважды
  const u = msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "/ideas", is_topic_message: true, message_thread_id: 7 });
  await handleUpdate(u); const n2 = sent.length; await handleUpdate(u); assert.equal(sent.length, n2);

  // 14. расписание и сводка
  console.log("вечер:", await eveningJob(), "| повтор:", await eveningJob());
  console.log("утро:", await morningJob());
  await handleUpdate(msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "/digest", is_topic_message: true, message_thread_id: 7 }));
  console.log("\n" + texts().at(-1));
  await handleUpdate(msg({ from: { id: AMET, first_name: "Amet-Khan" }, text: "/status", is_topic_message: true, message_thread_id: 7 }));
  console.log("\n" + texts().at(-1));
  console.log("\nВСЕ ПРОВЕРКИ ПРОШЛИ");
})().catch((e) => { console.error(e); process.exit(1); });
