// Code Checks of a Digest (content/checks.yaml). Pure and cheap: they run before the
// Methodologist so model calls are not spent on plain defects.
import type { CodeChecks } from "../../../libs/contract/src/server/api.schemas.ts";

const LABEL = /\[\[source:([\w-]+)\]\]/g;
const RAW_LABEL = /\[[SP]\d+\]/g;

/** Markdown to plain text: no labels, links, emphasis or code marks. */
const plain = (line: string) =>
  line
    .replace(LABEL, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, " ")
    .replace(/^\s*[-+]\s+|^\s*\d+\.\s+/, "");

const words = (text: string) => text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? [];
const sentences = (text: string) => text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim() !== "");

interface Section {
  title: string;
  lines: string[];
}

function splitSections(markdown: string): { headings: string[]; sections: Section[] } {
  const sections: Section[] = [];
  const headings: string[] = [];
  let current: Section | null = null;
  for (const line of markdown.split("\n")) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      current = { title: h2[1]!, lines: [] };
      headings.push(current.title);
      sections.push(current);
    } else if (current && line.trim() !== "") {
      current.lines.push(line);
    }
  }
  return { headings, sections };
}

/** Russian part of a line; in «Примеры» the studied-language part before the dash is skipped. */
function russianPart(section: string, line: string): string {
  if (section !== "Примеры") return line;
  const dash = line.search(/\s[—–-]\s/);
  return dash < 0 ? "" : line.slice(dash + 2);
}

/** Violations in Russian, for the Tutor to fix; empty when the Digest passes. */
export function runCodeChecks(
  markdown: string,
  checks: CodeChecks,
  sourceIds: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  const { headings, sections } = splitSections(markdown);

  // (1) Template sections, in order.
  const expected = checks.sections.join(" → ");
  if (headings.join(" → ") !== expected) {
    const missing = checks.sections.filter((s) => !headings.includes(s));
    const extra = headings.filter((h) => !checks.sections.includes(h));
    violations.push(
      [
        `Заголовки второго уровня должны быть ровно такие и в таком порядке: ${expected}.`,
        missing.length ? `Не хватает: ${missing.join(", ")}.` : "",
        extra.length ? `Лишние: ${extra.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  if (!/^#\s+\S/m.test(markdown)) violations.push("Нет заголовка первого уровня с названием Темы.");

  const forbidden = checks.forbiddenWords.map((w) => w.toLowerCase());
  for (const section of sections) {
    for (const line of section.lines) {
      const text = plain(russianPart(section.title, line));
      // (2) Sentence length.
      for (const sentence of sentences(text)) {
        const count = words(sentence).length;
        if (count > checks.maxSentenceWords) {
          violations.push(
            `Предложение длиннее ${checks.maxSentenceWords} слов (${count}): «${sentence.trim().slice(0, 120)}».`,
          );
        }
      }
      // (3) Forbidden words, as whole words or phrases.
      const lower = ` ${words(text).join(" ").toLowerCase()} `;
      for (const word of forbidden) {
        if (lower.includes(` ${word} `))
          violations.push(`Запретное слово «${word}» в строке: «${line.trim().slice(0, 120)}».`);
      }
    }
  }

  // (4) Source labels point at Sources of this Processing.
  if (checks.checkSourceLabels) {
    for (const [, id] of markdown.matchAll(LABEL)) {
      if (!sourceIds.has(id!))
        violations.push(`Метка источника ${id} не указывает на материал этой загрузки.`);
    }
    for (const [raw] of markdown.matchAll(RAW_LABEL))
      violations.push(`Метки ${raw} нет в списке источников.`);
  }
  return [...new Set(violations)];
}
