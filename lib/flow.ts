// Вся логика бота: идеи -> черновик -> одобрение -> публикация -> сводка.
import {
  Comment, Config, Draft, Idea, LogLine, Post,
  del, getConfig, getDraft, getJSON, hall, hdel, hget, hset, list, once, patchConfig, push, saveDraft, setJSON,
} from "./store";
import { CHANNEL, TgError, esc, imageUrl, sendHtml, stripTags, tg, userName } from "./tg";
import { revisePost, writePost } from "./claude";

// ---------------------------------------------------------------- время и расписание

const TZ = Number(process.env.TZ_OFFSET_HOURS ?? 5); // Ташкент, UTC+5
const POST_DAYS = (process.env.POST_DAYS || "1,3,5").split(",").map((s) => Number(s.trim())); // 0 = вс, 1 = пн ...
const POST_TIME = process.env.POST_TIME_LABEL || "10:00";
const DIGEST_DAY = Number(process.env.DIGEST_DAY ?? 0);
const LONG_MODE = process.env.LONG_POST_MODE || "preview"; // preview | split
const DAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const DAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function localNow(): Date {
  return new Date(Date.now() + TZ * 3600e3);
}
function dstr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400e3);
}
function label(slot: string, long = false): string {
  const d = new Date(slot + "T00:00:00Z");
  const dm = `${slot.slice(8, 10)}.${slot.slice(5, 7)}`;
  return long ? `${DAYS[d.getUTCDay()]}, ${dm}.${slot.slice(0, 4)}` : `${DAYS_SHORT[d.getUTCDay()]} ${dm}`;
}
function nextSlotAfter(d: Date): string {
  for (let i = 1; i <= 7; i++) {
    const x = addDays(d, i);
    if (POST_DAYS.includes(x.getUTCDay())) return dstr(x);
  }
  return dstr(addDays(d, 1));
}
function fmtTime(ts: number): string {
  const d = new Date(ts * 1000 + TZ * 3600e3);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function firstLine(s: string, n = 90): string {
  const l = (s || "").trim().split("\n")[0].trim();
  return l.length > n ? l.slice(0, n - 1) + "…" : l;
}
function scheduleText(): string {
  return `${POST_DAYS.map((d) => DAYS_SHORT[d]).join(", ")} около ${POST_TIME} по Ташкенту`;
}

// ---------------------------------------------------------------- права

function isBoss(cfg: Config, userId?: number): boolean {
  return !!userId && (userId === cfg.ownerId || (cfg.approvers || []).includes(userId));
}

async function say(cfg: Config, html: string, extra: Record<string, unknown> = {}): Promise<any> {
  if (!cfg.adminChat) return null;
  return sendHtml(cfg.adminChat, html, {
    message_thread_id: cfg.draftsThread,
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

// ---------------------------------------------------------------- черновики

function keyboard(d: Draft): any {
  const k = (text: string, action: string) => ({ text, callback_data: `d:${d.id}:${action}` });
  if (d.status === "pending") {
    const rows: any[] = [[k(`✅ Опубликовать ${label(d.slot)} в ${POST_TIME}`, "ok")], [k("🚀 Опубликовать сейчас", "now"), k("✏️ Переделать", "redo")]];
    d.alts.forEach((a, i) => rows.push([k(`🔄 ${a.slice(0, 44)}`, "alt" + i)]));
    rows.push([k("♻️ Другая тема", "other"), k("❌ Отменить", "cancel")]);
    return { inline_keyboard: rows };
  }
  if (d.status === "approved") {
    return { inline_keyboard: [[k("🚀 Опубликовать сейчас", "now")], [k("↩️ Вернуть на правку", "back"), k("❌ Отменить", "cancel")]] };
  }
  return { inline_keyboard: [] };
}

function controlText(d: Draft): string {
  const lines = [
    `📝 <b>Черновик на ${label(d.slot, true)}</b>`,
    `Тема: ${esc(d.topic)}`,
    d.source ? `Откуда: ${esc(d.source)}` : "",
    "",
    `🎨 <b>Промпт для картинки</b> (нажмите, чтобы скопировать):`,
    `<code>${esc(d.imagePrompt)}</code>`,
    "",
    d.photo ? "🖼 Картинка прикреплена. Чтобы заменить, пришлите новую ответом." : "📎 Пришлите картинку ответом на это сообщение.",
    "✏️ Чтобы поправить текст, ответьте на это сообщение и напишите, что изменить.",
  ];
  if (d.note) lines.push("", `ℹ️ ${esc(d.note)}`);
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

async function dropKeyboard(cfg: Config, msgId?: number): Promise<void> {
  if (!msgId || !cfg.adminChat) return;
  await tg("editMessageReplyMarkup", { chat_id: cfg.adminChat, message_id: msgId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
}
async function refreshKeyboard(cfg: Config, d: Draft): Promise<void> {
  if (!d.controlMsg || !cfg.adminChat) return;
  await tg("editMessageReplyMarkup", { chat_id: cfg.adminChat, message_id: d.controlMsg, reply_markup: keyboard(d) }).catch(() => {});
}

async function sendDraftMessages(cfg: Config, d: Draft): Promise<void> {
  const oldControl = d.controlMsg;
  const preview = await say(cfg, d.html);
  d.previewMsg = preview.message_id;
  const control = await say(cfg, controlText(d), {
    reply_parameters: { message_id: preview.message_id, allow_sending_without_reply: true },
    reply_markup: keyboard(d),
  });
  d.controlMsg = control.message_id;
  await hset("msg2draft", preview.message_id, d.id);
  await hset("msg2draft", control.message_id, d.id);
  await saveDraft(d);
  await dropKeyboard(cfg, oldControl);
}

async function gatherInput(slot: string, forcedTopic?: string, avoid?: string[]) {
  const used = await hall<string>("idea_used");
  const ideas = (await list<Idea>("ideas")).filter((i) => !(String(i.id) in used)).slice(-25);
  const posts = (await list<Post>("posts")).slice(-12);
  const comments = (await list<Comment>("comments")).slice(-20);
  const log = (await list<LogLine>("log")).slice(-40);
  const now = localNow();
  return {
    today: `${DAYS[now.getUTCDay()]}, ${dstr(now).split("-").reverse().join(".")}`,
    slotLabel: label(slot, true),
    ideas: ideas.map((i) => ({ id: i.id, author: i.author, topic: i.topic, text: (i.media ? i.media + " " : "") + i.text.slice(0, 3000) })),
    recentPosts: posts.map((p) => `- ${fmtTime(p.date)}: ${firstLine(p.text, 140)}`),
    recentComments: comments.map((c) => `- ${c.author}${c.postId ? ` (к посту #${c.postId})` : ""}: ${c.text.slice(0, 300)}`),
    teamChat: log.map((l) => `- [${fmtTime(l.date)}${l.topic ? " · " + l.topic : ""}] ${l.author}: ${l.text.slice(0, 300)}`),
    forcedTopic,
    avoidTopics: avoid,
  };
}

export async function makeDraft(opts: { slot?: string; forcedTopic?: string } = {}): Promise<Draft> {
  const cfg = await getConfig();
  if (!cfg.adminChat) throw new Error("Бот ещё не настроен: напишите /start в теме для черновиков");
  const slot = opts.slot || nextSlotAfter(localNow());
  const avoid = (await getJSON<string[]>("avoid:" + slot)) || [];
  const out = await writePost(await gatherInput(slot, opts.forcedTopic, avoid));
  const d: Draft = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    created: Math.floor(Date.now() / 1000),
    slot,
    topic: out.topic,
    source: out.source,
    html: out.html,
    imagePrompt: out.imagePrompt,
    alts: out.alts,
    note: out.note,
    ideaIds: out.usedIdeas,
    status: "pending",
    revisions: [],
  };
  for (const id of d.ideaIds) await hset("idea_used", id, d.id);
  await sendDraftMessages(cfg, d);
  return d;
}

async function cancelDraft(cfg: Config, d: Draft, rememberTopic: boolean): Promise<void> {
  d.status = "cancelled";
  await saveDraft(d);
  for (const id of d.ideaIds) await hdel("idea_used", id);
  if (rememberTopic) {
    const avoid = (await getJSON<string[]>("avoid:" + d.slot)) || [];
    avoid.push(d.topic);
    await setJSON("avoid:" + d.slot, avoid, 14 * 86400);
  }
  await dropKeyboard(cfg, d.controlMsg);
}

function photoRef(cfg: Config, d: Draft): string {
  // Файл, присланный «без сжатия», Telegram не даёт переслать как фото по id, поэтому отдаём его ссылкой.
  if (d.photo!.startsWith("doc:")) return imageUrl(cfg.baseUrl || "", d.photo!.slice(4));
  return d.photo!;
}

/** Отправляет пост (с картинкой, если есть) в указанный чат. Возвращает первое сообщение. */
async function sendPost(cfg: Config, d: Draft, chat: number | string, extra: Record<string, unknown> = {}): Promise<any> {
  if (!d.photo) return sendHtml(chat, d.html, { link_preview_options: { is_disabled: true }, ...extra });
  const fileId = d.photo.replace(/^doc:/, "");
  if (stripTags(d.html).length <= 1000) {
    try {
      return await tg("sendPhoto", { chat_id: chat, photo: photoRef(cfg, d), caption: d.html, parse_mode: "HTML", ...extra });
    } catch (e) {
      if (!(e instanceof TgError) || e.code !== 400) throw e;
      return await tg("sendPhoto", { chat_id: chat, photo: photoRef(cfg, d), caption: stripTags(d.html), ...extra });
    }
  }
  // Длинный пост не помещается в подпись к фото (лимит Telegram 1024 знака).
  if (LONG_MODE === "preview" && cfg.baseUrl) {
    // Картинка показывается большим превью над текстом, пост остаётся одним сообщением.
    return sendHtml(chat, d.html, {
      link_preview_options: { url: imageUrl(cfg.baseUrl, fileId), prefer_large_media: true, show_above_text: true },
      ...extra,
    });
  }
  await tg("sendPhoto", { chat_id: chat, photo: photoRef(cfg, d), ...extra });
  return sendHtml(chat, d.html, { link_preview_options: { is_disabled: true }, ...extra });
}

export async function publishDraft(cfg: Config, d: Draft): Promise<void> {
  const m = await sendPost(cfg, d, CHANNEL);
  d.status = "published";
  d.publishedId = m.message_id;
  await saveDraft(d);
  await push("posts", { id: m.message_id, date: Math.floor(Date.now() / 1000), text: stripTags(d.html) } satisfies Post, 80);
  await dropKeyboard(cfg, d.controlMsg);
  const link = typeof CHANNEL === "string" ? `https://t.me/${CHANNEL.slice(1)}/${m.message_id}` : "";
  await say(cfg, `🚀 Опубликовано: ${esc(d.topic)}${link ? `\n${link}` : ""}`, {
    reply_parameters: d.controlMsg ? { message_id: d.controlMsg, allow_sending_without_reply: true } : undefined,
  });
}

// ---------------------------------------------------------------- кнопки

async function answer(cqId: string, text?: string, alert = false): Promise<void> {
  await tg("answerCallbackQuery", { callback_query_id: cqId, text, show_alert: alert }).catch(() => {});
}

export async function handleCallback(cq: any): Promise<void> {
  const cfg = await getConfig();
  const m = /^d:([a-z0-9]+):(\w+)$/.exec(cq.data || "");
  if (!m) return answer(cq.id);
  if (!isBoss(cfg, cq.from?.id)) return answer(cq.id, "Кнопки работают только у владельца канала.", true);
  const d = await getDraft(m[1]);
  const action = m[2];
  if (!d) return answer(cq.id, "Черновик не найден.", true);
  if (d.status === "published") return answer(cq.id, "Этот пост уже опубликован.", true);
  if (d.status === "cancelled") return answer(cq.id, "Этот черновик отменён.", true);

  if (action === "redo") {
    return answer(cq.id, "Ответьте на это сообщение и напишите, что изменить. Я перепишу пост.", true);
  }
  if ((action === "ok" || action === "now") && !d.photo && !d.noPhotoOk) {
    d.noPhotoOk = true;
    await saveDraft(d);
    return answer(cq.id, "Картинки пока нет. Пришлите её ответом на черновик. Если хотите пост без картинки, нажмите кнопку ещё раз.", true);
  }
  if (action === "back") {
    d.status = "pending";
    await saveDraft(d);
    await refreshKeyboard(cfg, d);
    return answer(cq.id, "Вернул в черновики.");
  }
  if (action === "cancel") {
    await cancelDraft(cfg, d, false);
    await answer(cq.id, "Отменено.");
    await say(cfg, `❌ Черновик «${esc(d.topic)}» отменён. Новый можно попросить командой /post.`);
    return;
  }

  // Дальше идут долгие действия: защищаемся от двойного нажатия.
  if (!(await once("lock:" + d.id, 240))) return answer(cq.id, "Уже делаю, секунду…");
  try {
    if (action === "ok") {
      if (d.slot <= dstr(localNow()) && (await getJSON("pubdone:" + d.slot))) {
        await answer(cq.id, "Время публикации уже прошло, публикую сейчас.");
        await publishDraft(cfg, d);
      } else {
        d.status = "approved";
        await saveDraft(d);
        await refreshKeyboard(cfg, d);
        await answer(cq.id, "Одобрено.");
        await say(cfg, `✅ Одобрено. Пост «${esc(d.topic)}» выйдет ${label(d.slot)} около ${POST_TIME} по Ташкенту.`);
      }
    } else if (action === "now") {
      await answer(cq.id, "Публикую…");
      await publishDraft(cfg, d);
    } else if (action === "other" || /^alt\d$/.test(action)) {
      const forced = action === "other" ? undefined : d.alts[Number(action.slice(3))];
      await answer(cq.id, "Пишу новый вариант, это займёт 1–2 минуты.");
      await cancelDraft(cfg, d, true);
      await say(cfg, `♻️ Пишу другой пост${forced ? ` на тему «${esc(forced)}»` : ""}. Пришлю через 1–2 минуты.`);
      await makeDraft({ slot: d.slot, forcedTopic: forced });
    } else {
      await answer(cq.id);
    }
  } catch (e) {
    await reportError(cfg, e);
  } finally {
    await del("lock:" + d.id);
  }
}

export async function reportError(cfg: Config, e: unknown): Promise<void> {
  console.error(e);
  const text = e instanceof Error ? e.message : String(e);
  await say(cfg, `⚠️ Не получилось: ${esc(text.slice(0, 300))}`).catch(() => {});
}

// ---------------------------------------------------------------- сообщения

function command(text: string, botUsername?: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[3] || "").trim() };
}

function mediaMark(msg: any): string {
  if (msg.photo) return "[фото]";
  if (msg.video) return "[видео]";
  if (msg.voice) return "[голосовое]";
  if (msg.video_note) return "[видео-кружок]";
  if (msg.document) return `[файл ${msg.document.file_name || ""}]`.replace(" ]", "]");
  return "";
}
function forwardMark(msg: any): string {
  const o = msg.forward_origin;
  if (!o) return "";
  const from = o.chat?.title || o.sender_chat?.title || userName(o.sender_user) || o.sender_user_name || "";
  return `(переслано${from && from !== "Аноним" ? " из «" + from + "»" : ""}) `;
}

async function statusText(cfg: Config): Promise<string> {
  const topics = await hall<string>("topics");
  const ideaNames = (cfg.ideaThreads || []).map((t) => `«${topics[String(t)] || "тема " + t}»`);
  const used = await hall<string>("idea_used");
  const unused = (await list<Idea>("ideas")).filter((i) => !(String(i.id) in used)).length;
  let channel = "не проверен";
  try {
    const me = cfg.botId || (await tg("getMe")).id;
    const member = await tg("getChatMember", { chat_id: CHANNEL, user_id: me });
    channel = member.status === "administrator" && member.can_post_messages !== false ? "могу публиковать ✅" : "я не админ канала ❌ (добавьте меня админом с правом публиковать)";
  } catch {
    channel = "нет доступа ❌ (добавьте меня админом канала с правом публиковать)";
  }
  return [
    "🍚 <b>Бот «Маркетинговый плов»</b>",
    `Владелец: ${esc(cfg.ownerName || "не задан")}`,
    `Черновики присылаю: ${cfg.draftsThread ? `в тему «${esc(topics[String(cfg.draftsThread)] || "эта тема")}»` : "в этот чат"}`,
    `Идеи читаю из тем: ${ideaNames.length ? esc(ideaNames.join(", ")) : "пока не знаю. Напишите /ideas_here в теме с идеями"}`,
    `Неиспользованных идей: ${unused}`,
    `Канал ${esc(String(CHANNEL))}: ${channel}`,
    `Группа с комментариями: ${cfg.discussionChat ? "вижу ✅" : "пока не вижу (добавьте меня в группу канала, появится после первого поста)"}`,
    `Расписание постов: ${scheduleText()}. Черновик приходит накануне вечером.`,
    "",
    "Команды: /post [тема] — написать пост сейчас · /ideas — идеи в запасе · /digest — сводка · /status — это сообщение",
  ].join("\n");
}

async function setup(msg: any, cfg: Config): Promise<void> {
  const uid = msg.from?.id;
  if (cfg.ownerId && uid !== cfg.ownerId) return;
  if (!cfg.ownerId) {
    const envOwner = Number(process.env.OWNER_ID || 0);
    if (envOwner && uid !== envOwner) return;
    const member = await tg("getChatMember", { chat_id: msg.chat.id, user_id: uid }).catch(() => null);
    if (!member || !["creator", "administrator"].includes(member.status)) {
      await sendHtml(msg.chat.id, "Настроить меня может только админ этой группы.", { message_thread_id: msg.message_thread_id });
      return;
    }
  }
  const me = await tg("getMe");
  const topicName = msg.reply_to_message?.forum_topic_created?.name;
  if (msg.is_topic_message && topicName) await hset("topics", msg.message_thread_id, topicName);
  cfg = await patchConfig({
    ownerId: uid,
    ownerName: userName(msg.from),
    adminChat: msg.chat.id,
    draftsThread: msg.is_topic_message ? msg.message_thread_id : undefined,
    botId: me.id,
    botUsername: me.username,
  });
  await say(cfg, "Готово ✅ Теперь я работаю в этой группе, а черновики буду присылать сюда.\n\n" + (await statusText(cfg)));
}

async function attachPhoto(cfg: Config, d: Draft, msg: any): Promise<void> {
  const doc = msg.document && /^image\//.test(msg.document.mime_type || "") ? msg.document : null;
  d.photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : "doc:" + doc.file_id;
  d.noPhotoOk = false;
  await saveDraft(d);
  if (d.status === "published" || d.status === "cancelled") return;
  // Показываем, как пост будет выглядеть в канале (заодно Telegram заранее подгружает картинку).
  const final = await sendPost(cfg, d, cfg.adminChat!, { message_thread_id: cfg.draftsThread });
  d.finalMsg = final.message_id;
  await hset("msg2draft", final.message_id, d.id);
  await saveDraft(d);
  await say(cfg, "🖼 Картинка прикреплена. Выше показано, как пост будет выглядеть в канале. Если всё хорошо, жмите ✅ под черновиком.", {
    reply_parameters: { message_id: d.controlMsg, allow_sending_without_reply: true },
  });
}

async function revise(cfg: Config, d: Draft, instruction: string): Promise<void> {
  if (d.status === "published") return void (await say(cfg, "Этот пост уже опубликован, поправить его можно только вручную в канале."));
  if (d.status === "cancelled") return void (await say(cfg, "Этот черновик отменён. Новый можно попросить командой /post."));
  if (!(await once("lock:" + d.id, 240))) return;
  try {
    await say(cfg, "✍️ Переписываю, пришлю через минуту.");
    d.revisions.push(instruction);
    const out = await revisePost(
      { topic: d.topic, source: d.source, usedIdeas: d.ideaIds, html: d.html, imagePrompt: d.imagePrompt, alts: d.alts, note: d.note || "" },
      d.revisions,
    );
    const wasApproved = d.status === "approved";
    Object.assign(d, { topic: out.topic, html: out.html, imagePrompt: out.imagePrompt, alts: out.alts, note: out.note, status: "pending", noPhotoOk: false });
    await sendDraftMessages(cfg, d);
    if (wasApproved) await say(cfg, "Текст изменился, поэтому одобрение снято. Нажмите ✅ под новой версией.");
  } catch (e) {
    await reportError(cfg, e);
  } finally {
    await del("lock:" + d.id);
  }
}

export async function handleMessage(msg: any): Promise<void> {
  let cfg = await getConfig();
  const text: string = msg.text || msg.caption || "";
  const c = command(text, cfg.botUsername);

  if (msg.chat.type === "private") {
    if (c) {
      await sendHtml(
        msg.chat.id,
        "Привет! Я работаю в группе админов. Добавьте меня туда админом, потом напишите <code>/start</code> в теме, куда присылать черновики постов.",
      );
    }
    return;
  }

  // --- группа с комментариями канала
  if (msg.is_automatic_forward && msg.sender_chat) {
    const sc = msg.sender_chat;
    const isOurs = sc.id === cfg.channelId || sc.id === CHANNEL || (typeof CHANNEL === "string" && sc.username && "@" + sc.username.toLowerCase() === CHANNEL.toLowerCase());
    if (isOurs) {
      if (cfg.discussionChat !== msg.chat.id || cfg.channelId !== sc.id) cfg = await patchConfig({ discussionChat: msg.chat.id, channelId: sc.id });
      if (msg.forward_origin?.message_id) await hset("roots", msg.message_id, msg.forward_origin.message_id);
    }
    return;
  }
  if (cfg.discussionChat && msg.chat.id === cfg.discussionChat && msg.chat.id !== cfg.adminChat) {
    if (!text || msg.from?.is_bot) return;
    const root = msg.message_thread_id ?? msg.reply_to_message?.message_id;
    const postId = root ? await hget<number>("roots", root) : null;
    await push("comments", { id: msg.message_id, author: userName(msg.sender_chat || msg.from), text, date: msg.date, postId: postId ?? undefined } satisfies Comment, 300);
    return;
  }

  // --- настройка
  if (c && (c.cmd === "start" || c.cmd === "setup")) return setup(msg, cfg);
  if (!cfg.adminChat || msg.chat.id !== cfg.adminChat) return;

  // --- запоминаем названия тем группы
  const thread: number | undefined = msg.is_topic_message ? msg.message_thread_id : undefined;
  let topicName: string | undefined;
  if (thread) {
    const name = msg.forum_topic_created?.name || msg.forum_topic_edited?.name || msg.reply_to_message?.forum_topic_created?.name;
    if (name) {
      await hset("topics", thread, name);
      topicName = name;
      if (/иде|сыр/i.test(name) && thread !== cfg.draftsThread && !(cfg.ideaThreads || []).includes(thread)) {
        cfg = await patchConfig({ ideaThreads: [...(cfg.ideaThreads || []), thread] });
      }
    } else {
      topicName = (await hget<string>("topics", thread)) || undefined;
    }
  }
  if (msg.from?.is_bot || msg.forum_topic_created || msg.forum_topic_edited) return;

  const boss = isBoss(cfg, msg.from?.id);

  // --- команды
  if (c) {
    if (!boss) return;
    try {
      if (c.cmd === "post") {
        await say(cfg, c.arg ? `✍️ Пишу пост на тему «${esc(c.arg)}». Пришлю через 1–2 минуты.` : "✍️ Выбираю тему и пишу пост. Пришлю через 1–2 минуты.");
        await makeDraft({ forcedTopic: c.arg || undefined });
      } else if (c.cmd === "ideas") {
        const used = await hall<string>("idea_used");
        const ideas = (await list<Idea>("ideas")).filter((i) => !(String(i.id) in used)).slice(-15);
        await say(cfg, ideas.length ? "💡 <b>Идеи в запасе:</b>\n" + ideas.map((i) => `• ${esc(i.author)}: ${esc(firstLine(i.text, 120))}`).join("\n") : "Идей в запасе нет. Следующую тему найду сам.");
      } else if (c.cmd === "status" || c.cmd === "help") {
        await say(cfg, await statusText(cfg));
      } else if (c.cmd === "digest") {
        await digest(cfg);
      } else if (c.cmd === "ideas_here" && thread) {
        if (!(cfg.ideaThreads || []).includes(thread)) cfg = await patchConfig({ ideaThreads: [...(cfg.ideaThreads || []), thread] });
        await sendHtml(cfg.adminChat!, "💡 Запомнил: из этой темы беру идеи для постов.", { message_thread_id: thread });
      } else if (c.cmd === "drafts_here") {
        cfg = await patchConfig({ draftsThread: thread });
        await say(cfg, "📝 Запомнил: черновики присылаю сюда.");
      } else if (c.cmd === "approver" && msg.from?.id === cfg.ownerId && msg.reply_to_message?.from && !msg.reply_to_message.forum_topic_created) {
        const u = msg.reply_to_message.from;
        if (!u.is_bot && !(cfg.approvers || []).includes(u.id)) cfg = await patchConfig({ approvers: [...(cfg.approvers || []), u.id] });
        await sendHtml(cfg.adminChat!, `✅ ${esc(userName(u))} теперь тоже может одобрять и править посты.`, { message_thread_id: thread });
      }
    } catch (e) {
      await reportError(cfg, e);
    }
    return;
  }

  // --- ответ на черновик: картинка или правка
  const replyId = msg.reply_to_message && !msg.reply_to_message.forum_topic_created ? msg.reply_to_message.message_id : undefined;
  if (replyId) {
    const draftId = await hget<string>("msg2draft", replyId);
    const d = draftId ? await getDraft(String(draftId)) : null;
    if (d) {
      const isImage = msg.photo || (msg.document && /^image\//.test(msg.document.mime_type || ""));
      try {
        if (isImage) await attachPhoto(cfg, d, msg);
        else if (text && boss) await revise(cfg, d, text);
      } catch (e) {
        await reportError(cfg, e);
      }
      return;
    }
  }

  // --- журнал чата и идеи
  if (thread !== cfg.draftsThread || !cfg.draftsThread) {
    const body = (forwardMark(msg) + [mediaMark(msg), text].filter(Boolean).join(" ")).trim();
    if (body) await push("log", { id: msg.message_id, topic: topicName, author: userName(msg.from), text: body.slice(0, 1500), date: msg.date } satisfies LogLine, 200);
  }
  if (thread && (cfg.ideaThreads || []).includes(thread) && text.trim().length >= 3) {
    await push(
      "ideas",
      { id: msg.message_id, thread, topic: topicName, author: userName(msg.from), text: forwardMark(msg) + text, date: msg.date, media: mediaMark(msg) || undefined } satisfies Idea,
      300,
    );
    await tg("setMessageReaction", { chat_id: msg.chat.id, message_id: msg.message_id, reaction: [{ type: "emoji", emoji: "👀" }] }).catch(() => {});
  }
}

export async function handleChannelPost(post: any): Promise<void> {
  const cfg = await getConfig();
  const ch = post.chat;
  const isOurs = ch.id === cfg.channelId || ch.id === CHANNEL || (typeof CHANNEL === "string" && ch.username && "@" + ch.username.toLowerCase() === CHANNEL.toLowerCase());
  if (!isOurs) return;
  if (cfg.channelId !== ch.id) await patchConfig({ channelId: ch.id });
  const text = post.text || post.caption || "";
  if (text) await push("posts", { id: post.message_id, date: post.date, text } satisfies Post, 80);
}

export async function handleReactionCount(r: any): Promise<void> {
  const total = (r.reactions || []).reduce((s: number, x: any) => s + (x.total_count || 0), 0);
  await hset("post_react", r.message_id, total);
}

export async function handleUpdate(u: any): Promise<void> {
  if (u.update_id && !(await once("upd:" + u.update_id, 86400))) return;
  if (u.message) return handleMessage(u.message);
  if (u.callback_query) return handleCallback(u.callback_query);
  if (u.channel_post) return handleChannelPost(u.channel_post);
  if (u.message_reaction_count) return handleReactionCount(u.message_reaction_count);
}

// ---------------------------------------------------------------- расписание

export async function digest(cfg: Config): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 86400;
  const lines: string[] = ["📊 <b>Сводка за неделю</b>", ""];
  try {
    const subs: number = await tg("getChatMemberCount", { chat_id: CHANNEL });
    const prev = await getJSON<{ n: number; t: number }>("subs_prev");
    lines.push(`Подписчиков: <b>${subs}</b>${prev ? ` (${subs - prev.n >= 0 ? "+" : ""}${subs - prev.n} с прошлой сводки)` : ""}`);
    await setJSON("subs_prev", { n: subs, t: now });
  } catch {
    lines.push("Подписчиков: не удалось узнать (я не админ канала?)");
  }
  const posts = (await list<Post>("posts")).filter((p) => p.date >= weekAgo);
  const react = await hall<number>("post_react");
  const comments = await list<Comment>("comments");
  const weekComments = comments.filter((c) => c.date >= weekAgo);
  lines.push(`Постов за неделю: ${posts.length}`, "");
  for (const p of posts) {
    const cc = comments.filter((c) => c.postId === p.id).length;
    lines.push(`• ${fmtTime(p.date)} ${esc(firstLine(p.text, 60))}\n   реакций: ${react[String(p.id)] ?? "нет данных"}, комментариев: ${cc}`);
  }
  if (weekComments.length) {
    lines.push("", `💬 Новых комментариев: ${weekComments.length}. Последние:`);
    for (const c of weekComments.slice(-5)) lines.push(`• ${esc(c.author)}: ${esc(firstLine(c.text, 100))}`);
  }
  const used = await hall<string>("idea_used");
  const unused = (await list<Idea>("ideas")).filter((i) => !(String(i.id) in used)).length;
  lines.push("", `💡 Идей в запасе: ${unused}${unused ? "" : ". Следующие темы буду искать сам, либо накидайте идей в тему с идеями"}`);
  lines.push("", "Просмотры постов Telegram ботам не показывает, их видно в статистике канала.");
  await say(cfg, lines.join("\n"));
}

export async function eveningJob(): Promise<string> {
  const cfg = await getConfig();
  if (!cfg.adminChat) return "бот не настроен";
  const now = localNow();
  const done: string[] = [];
  const tomorrow = addDays(now, 1);
  if (POST_DAYS.includes(tomorrow.getUTCDay())) {
    const slot = dstr(tomorrow);
    if (await once("gen:" + slot, 3 * 86400)) {
      try {
        await makeDraft({ slot });
        done.push("черновик на " + slot);
      } catch (e) {
        await del("gen:" + slot);
        await reportError(cfg, e);
        done.push("ошибка черновика");
      }
    }
  }
  if (now.getUTCDay() === DIGEST_DAY && (await once("digest:" + dstr(now), 3 * 86400))) {
    await digest(cfg).catch((e) => reportError(cfg, e));
    done.push("сводка");
  }
  return done.join(", ") || "нечего делать";
}

export async function morningJob(): Promise<string> {
  const cfg = await getConfig();
  if (!cfg.adminChat) return "бот не настроен";
  const today = dstr(localNow());
  await setJSON("pubdone:" + today, 1, 3 * 86400);
  const index = await hall<{ status: string; slot: string; created: number }>("drafts");
  const done: string[] = [];
  for (const [id, meta] of Object.entries(index)) {
    if (meta.created < Date.now() / 1000 - 30 * 86400) {
      await hdel("drafts", id);
      continue;
    }
    if (meta.slot > today) continue;
    if (meta.status === "approved") {
      const d = await getDraft(id);
      if (!d || d.status !== "approved") continue;
      if (!(await once("lock:" + id, 240))) continue;
      try {
        await publishDraft(cfg, d);
        done.push("опубликован " + id);
      } catch (e) {
        await reportError(cfg, e);
      } finally {
        await del("lock:" + id);
      }
    } else if (meta.status === "pending" && meta.slot === today && (await once("remind:" + id, 3 * 86400))) {
      const d = await getDraft(id);
      if (d?.status === "pending") {
        await say(cfg, `⏰ Пост на сегодня «${esc(d.topic)}» ещё не одобрен. Нажмите «🚀 Опубликовать сейчас» под черновиком, когда будет готов.`, {
          reply_parameters: d.controlMsg ? { message_id: d.controlMsg, allow_sending_without_reply: true } : undefined,
        });
        done.push("напоминание " + id);
      }
    }
  }
  return done.join(", ") || "нечего делать";
}
