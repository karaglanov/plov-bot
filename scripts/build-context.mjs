// Собирает файлы из context/ в lib/context.generated.ts, чтобы бот всегда носил их с собой.
// Запуск: npm run context (после правки любого файла в context/).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const files = [
  ["Гайд по стилю постов", "context/style-guide.md"],
  ["Бриф проекта", "context/project-brief.md"],
  ["Решения команды (новое важнее старого)", "context/decisions.md"],
  ["Контент-план и рубрики", "context/content-plan.md"],
  ["Аудитория и каналы", "context/audience-channels.md"],
];
let docs = "";
for (const [title, path] of files) {
  docs += `\n\n<document title="${title}">\n${readFileSync(path, "utf8").trim()}\n</document>`;
}
const visual = readFileSync("context/visual-style.md", "utf8").trim();
const published = existsSync("context/published-topics.md")
  ? readFileSync("context/published-topics.md", "utf8").trim()
  : "";
const out =
  "// АВТОМАТИЧЕСКИ СОБРАНО scripts/build-context.mjs. Не править руками.\n" +
  `export const CONTEXT_DOCS = ${JSON.stringify(docs.trim())};\n` +
  `export const VISUAL_STYLE = ${JSON.stringify(visual)};\n` +
  `export const PUBLISHED_TOPICS = ${JSON.stringify(published)};\n`;
writeFileSync("lib/context.generated.ts", out);
console.log("lib/context.generated.ts:", Math.round(out.length / 1024), "KB");
