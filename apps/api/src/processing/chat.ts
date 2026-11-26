// The Chat of a Material: the Tutor tells the Learner what Processing is doing. Messages come from
// flow transitions; the Tutor's model writes them by the Playbook, a Playbook fallback line stands
// in when it cannot. The Chat never fails the flow.
import type { FlowStep, MaterialProcessingContext } from "@airepetitor/flows";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { LanguageCode } from "../../../../libs/contract/src/server/api.schemas.ts";
import {
  digestVersion,
  material,
  materialTopic,
  message,
  profile,
  source,
  topic,
} from "../db/schema.ts";
import type { Env } from "../env.ts";
import { languageName } from "../languages.ts";
import { tutorModel } from "../models/roles.ts";
import { type Playbook, loadPlaybook } from "../playbook.ts";
import { PLAYBOOK_EDITION } from "../playbook.generated.ts";
import { ask, fill } from "./context.ts";
import { FAILURE_REASON, PROCESSING_BROKE } from "./reasons.ts";

/** Something the Learner hears about, keyed by its section in `content/templates/chat.md`. */
export type ChatEvent =
  | { kind: "Материал принят" }
  | { kind: "Исходник прочитан" | "Исходник не прочитан"; sourceId: string }
  | { kind: "Темы найдены" }
  | { kind: "Тема дополнена"; topicId: string }
  | { kind: "Без тем" }
  | { kind: "Ошибка материала"; reason: string }
  /** Processing broke outside the machine; «Повторить» cannot pick it up, so it is not offered. */
  | { kind: "Сбой обработки"; reason: string };

type Event = { type: string; sourceId?: string; ok?: boolean };

/** Longest wait for the Tutor's model; then the fallback line is written. */
const MODEL_WAIT_MS = 60_000;

/**
 * The Chat events of one «Обработка материала» transition, in order. Pure. One transition may
 * carry two: the last Source failing also fails the Material.
 */
export function materialChatEvents(from: FlowStep | null, to: FlowStep, event: Event): ChatEvent[] {
  if (!from) return [{ kind: "Материал принят" }];
  const before = from.snapshot.context as MaterialProcessingContext;
  const after = to.snapshot.context as MaterialProcessingContext;
  const events: ChatEvent[] = [];
  if (event.type === "SOURCE_DONE" && event.sourceId && before.awaiting.includes(event.sourceId))
    events.push({
      kind: event.ok ? "Исходник прочитан" : "Исходник не прочитан",
      sourceId: event.sourceId,
    });
  if (event.type === "TOPICS_COMMITTED") events.push({ kind: "Темы найдены" });
  if (to.snapshot.value === "noTopics" && from.snapshot.value !== "noTopics")
    events.push({ kind: "Без тем" });
  if (to.snapshot.value === "failed" && from.snapshot.value !== "failed")
    events.push({
      kind: "Ошибка материала",
      reason: after.failure ? FAILURE_REASON[after.failure] : PROCESSING_BROKE,
    });
  return events;
}

/** The Chat event of one «Конспект темы» transition: a saved Digest of a known Topic. Pure. */
export function digestChatEvents(to: FlowStep, topicId: string, event: Event): ChatEvent[] {
  return event.type === "SAVED" && to.snapshot.value === "saved"
    ? [{ kind: "Тема дополнена", topicId }]
    : [];
}

/** Facts for the fallback line and the model, as `{{name}}` values. */
async function factsOf(
  env: Env,
  materialId: string,
  event: ChatEvent,
): Promise<Record<string, string> | null> {
  const d = drizzle(env.DB);
  switch (event.kind) {
    case "Материал принят": {
      const rows = await d
        .select({ fileName: source.fileName })
        .from(source)
        .where(eq(source.materialId, materialId))
        .orderBy(asc(source.position));
      return { files: rows.map((r) => `«${r.fileName}»`).join(", ") };
    }
    case "Исходник прочитан":
    case "Исходник не прочитан": {
      const [row] = await d.select().from(source).where(eq(source.id, event.sourceId));
      return row ? { file: row.fileName, reason: row.errorReason ?? "причина неизвестна" } : null;
    }
    case "Темы найдены": {
      const rows = await d
        .select({ title: topic.title, mark: materialTopic.mark })
        .from(materialTopic)
        .innerJoin(topic, eq(topic.id, materialTopic.topicId))
        .where(eq(materialTopic.materialId, materialId));
      return {
        topics: rows
          .map((r) => `«${r.title}»${r.mark === "extended" ? " (уже была, дополню)" : ""}`)
          .join(", "),
      };
    }
    case "Тема дополнена": {
      // Only a Topic the Learner already had is «дополнена»; a new one was listed with the others.
      const [row] = await d
        .select({ title: topic.title, mark: materialTopic.mark })
        .from(materialTopic)
        .innerJoin(topic, eq(topic.id, materialTopic.topicId))
        .where(
          and(eq(materialTopic.materialId, materialId), eq(materialTopic.topicId, event.topicId)),
        );
      return row?.mark === "extended" ? { topic: row.title } : null;
    }
    case "Без тем":
      return {};
    case "Ошибка материала":
    case "Сбой обработки":
      return { reason: event.reason };
  }
}

/** Sections of `content/templates/chat.md` by heading. */
function fallbackLine(p: Playbook, kind: string, facts: Record<string, string>): string {
  const sections = p.file("content/templates/chat.md").split(/^## /m).slice(1);
  const body = sections
    .find((s) => s.startsWith(`${kind}\n`))
    ?.slice(kind.length + 1)
    .trim();
  return (body ?? kind).replace(/\{\{(\w+)\}\}/g, (whole, name: string) => facts[name] ?? whole);
}

/** The previous and the new Digest of an extended Topic, for «что нового». */
async function digestsOf(env: Env, materialId: string, topicId: string): Promise<string> {
  const versions = await drizzle(env.DB)
    .select({ markdown: digestVersion.markdown, materialId: digestVersion.materialId })
    .from(digestVersion)
    .where(eq(digestVersion.topicId, topicId))
    .orderBy(asc(digestVersion.number));
  const at = versions.findIndex((v) => v.materialId === materialId);
  if (at < 1) return "";
  return `Прошлая версия Конспекта:\n\n${versions[at - 1]!.markdown}\n\nНовая версия Конспекта:\n\n${versions[at]!.markdown}`;
}

async function compose(
  env: Env,
  materialId: string,
  event: ChatEvent,
  facts: Record<string, string>,
): Promise<string> {
  const [row] = await drizzle(env.DB)
    .select({ edition: material.playbookEdition, language: profile.language })
    .from(material)
    .innerJoin(profile, eq(profile.id, material.profileId))
    .where(eq(material.id, materialId));
  // A Material without its edition still gets a line, by the Playbook built into this API.
  const p = await loadPlaybook(env, row?.edition ?? PLAYBOOK_EDITION);
  const fallback = fallbackLine(p, event.kind, facts);
  if (!row) return fallback;
  try {
    const system = [
      fill(p.file("content/tutor/chat.md"), languageName(row.language as LanguageCode)),
      p.file("content/plain-russian.md"),
      `# Запретные слова\n\n${p.checks.forbiddenWords.join(", ")}`,
    ].join("\n\n");
    const user = [
      `Событие: ${event.kind}.`,
      `Заготовка: ${fallback}`,
      event.kind === "Тема дополнена" ? await digestsOf(env, materialId, event.topicId) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    // A hanging provider must not hold the step until Workflows time it out and fail the flow.
    const text = await Promise.race([
      ask(
        env,
        tutorModel(env),
        materialId,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        false,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("the model took too long")), MODEL_WAIT_MS),
      ),
    ]);
    return text.trim() || fallback;
  } catch (error) {
    console.warn("Chat falls back to the Playbook line", materialId, event.kind, error);
    return fallback;
  }
}

/**
 * Writes the Tutor's Messages for the events of one flow step. `stepId` is unique per step, so a
 * replayed step writes nothing new. Never throws: the Chat must not stop Processing.
 */
export async function postMessages(
  env: Env,
  materialId: string,
  stepId: string,
  events: ChatEvent[],
): Promise<void> {
  for (const [i, event] of events.entries())
    await postMessage(env, materialId, `${materialId}:${stepId}:${i}`, event);
}

/** Work for a notify step, or null when the transition says nothing to the Learner. */
export function chatPoster(
  env: Env,
  materialId: string,
  events: ChatEvent[],
): ((stepId: string) => Promise<void>) | null {
  return events.length ? (stepId) => postMessages(env, materialId, stepId, events) : null;
}

async function postMessage(
  env: Env,
  materialId: string,
  id: string,
  event: ChatEvent,
): Promise<void> {
  try {
    const d = drizzle(env.DB);
    const [written] = await d.select({ id: message.id }).from(message).where(eq(message.id, id));
    if (written) return;
    const facts = await factsOf(env, materialId, event);
    if (!facts) return;
    const text = await compose(env, materialId, event, facts);
    await d.insert(message).values({ id, materialId, author: "tutor", text }).onConflictDoNothing();
  } catch (error) {
    console.error("Could not write a Chat Message", materialId, event.kind, error);
  }
}
