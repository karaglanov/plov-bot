// Страница настройки: открыть один раз после установки. Подключает бота к Telegram и показывает, что ещё осталось.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkKey } from "../lib/claude";
import { getConfig, hasDb, patchConfig, ping } from "../lib/store";
import { CHANNEL, TOKEN, esc, tg, webhookSecret } from "../lib/tg";

type Row = { ok: boolean; title: string; hint?: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const baseUrl = `https://${host}`;
  const rows: Row[] = [];
  let botName = "";

  // 1. Токен бота и подключение к Telegram
  let botOk = false;
  let botId = 0;
  if (!TOKEN) {
    rows.push({ ok: false, title: "Токен бота", hint: "В Vercel → Settings → Environment Variables добавьте TELEGRAM_BOT_TOKEN (его выдаёт @BotFather), потом Deployments → Redeploy." });
  } else {
    try {
      const me = await tg("getMe");
      botName = me.username;
      botId = me.id;
      await tg("setWebhook", {
        url: `${baseUrl}/api/telegram`,
        secret_token: webhookSecret(),
        allowed_updates: ["message", "channel_post", "callback_query", "my_chat_member", "message_reaction_count"],
      });
      await tg("setMyCommands", {
        commands: [
          { command: "post", description: "Написать пост сейчас (можно указать тему)" },
          { command: "ideas", description: "Идеи в запасе" },
          { command: "digest", description: "Сводка по каналу" },
          { command: "status", description: "Состояние бота" },
        ],
      }).catch(() => {});
      botOk = true;
      rows.push({ ok: true, title: `Бот @${me.username} подключён к Telegram` });
    } catch (e: any) {
      rows.push({ ok: false, title: "Токен бота", hint: "Telegram не принял токен: " + esc(String(e?.message || e)) + ". Проверьте TELEGRAM_BOT_TOKEN." });
    }
  }

  // 2. База
  const dbOk = hasDb && (await ping());
  rows.push(
    dbOk
      ? { ok: true, title: "База данных подключена" }
      : { ok: false, title: "База данных", hint: "В Vercel откройте проект → Storage → Create Database → Upstash for Redis → Create (бесплатный тариф). Потом Deployments → Redeploy." },
  );
  if (dbOk) await patchConfig({ baseUrl, ...(botId ? { botId, botUsername: botName } : {}) });

  // 3. Кто пишет посты
  if (process.env.ANTHROPIC_API_KEY) {
    const keyErr = await checkKey();
    rows.push(
      keyErr
        ? { ok: false, title: "Ключ Claude API", hint: `Не работает (${esc(keyErr)}). Проверьте ANTHROPIC_API_KEY в Vercel или удалите его, чтобы посты писал Claude из проекта.` }
        : { ok: true, title: "Посты пишет Claude API (платный режим, ответ за 1–2 минуты)" },
    );
  } else if ((process.env.AGENT_KEY || "").length >= 16) {
    rows.push({ ok: true, title: "Посты пишет Claude из вашего проекта по расписанию (бесплатный режим)" });
  } else {
    rows.push({ ok: false, title: "Ключ для Claude", hint: "В Vercel → Settings → Environment Variables добавьте AGENT_KEY (строку прислал Claude в чате), потом Deployments → Redeploy." });
  }

  // 4. Канал
  if (botOk) {
    try {
      const m = await tg("getChatMember", { chat_id: CHANNEL, user_id: botId });
      const can = m.status === "administrator" && m.can_post_messages !== false;
      rows.push(can ? { ok: true, title: `Бот может публиковать в ${CHANNEL}` } : { ok: false, title: `Канал ${CHANNEL}`, hint: `Добавьте @${botName} администратором канала и включите право «Публикация сообщений».` });
    } catch {
      rows.push({ ok: false, title: `Канал ${CHANNEL}`, hint: `Добавьте @${botName} администратором канала и включите право «Публикация сообщений». Остальные права можно выключить.` });
    }
  }

  // 5. Группа админов
  if (dbOk) {
    const cfg = await getConfig();
    rows.push(
      cfg.adminChat
        ? { ok: true, title: `Группа админов настроена, владелец: ${esc(cfg.ownerName || "")}` }
        : { ok: false, title: "Группа админов", hint: `Добавьте @${botName || "бота"} в группу админов и сделайте его админом (чтобы он видел сообщения). Потом в теме «Контент Production» напишите <code>/start</code>.` },
    );
    if (cfg.adminChat) {
      rows.push(
        cfg.discussionChat
          ? { ok: true, title: "Группа с комментариями канала видна" }
          : { ok: false, title: "Группа с комментариями (необязательно)", hint: `Добавьте @${botName} в группу канала, где подписчики пишут комментарии. Бот подхватит её после первого нового поста.` },
      );
    }
  }

  const allOk = rows.every((r) => r.ok);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Настройка бота</title>
<style>
:root{--bg:#F6E9D6;--card:#fffaf1;--fg:#2b2218;--mut:#7a6a55;--ok:#2e7d32;--no:#c0392b;--line:#e6d6bd}
@media (prefers-color-scheme: dark){:root{--bg:#1d1812;--card:#272018;--fg:#f3e8d6;--mut:#b3a38c;--ok:#7bd37f;--no:#ff8a75;--line:#3a3024}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px}
h1{font-size:24px;margin:0 0 4px}p.sub{color:var(--mut);margin:0 0 24px}
.row{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.row b{display:block}.row .hint{color:var(--mut);margin-top:4px;font-size:15px}
.ok b::before{content:"✅ "}.no b::before{content:"⬜ "}
.done{margin-top:20px;padding:16px;border-radius:12px;background:var(--card);border:1px solid var(--line)}
code{background:rgba(127,127,127,.18);padding:1px 6px;border-radius:6px}
</style></head><body><main>
<h1>🍚 Бот «Маркетинговый плов»</h1>
<p class="sub">Страница сама проверяет настройку. Сделали шаг — обновите страницу.</p>
${rows.map((r) => `<div class="row ${r.ok ? "ok" : "no"}"><b>${r.title}</b>${r.hint ? `<div class="hint">${r.hint}</div>` : ""}</div>`).join("\n")}
<div class="done">${allOk ? "Всё готово. Напишите <code>/post</code> в теме с черновиками, чтобы получить первый пост на проверку." : "Осталось сделать шаги, отмеченные пустым квадратом."}</div>
</main></body></html>`;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  return res.status(200).send(html);
}
