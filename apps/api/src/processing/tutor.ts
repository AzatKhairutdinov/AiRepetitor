// The Tutor's steps in Processing. Each returns the event for its machine; a model that does
// not answer after the retries becomes TUTOR_FAILED, never an exception.
import type { MaterialProcessingEvent, TopicDigestEvent } from "@airepetitor/flows";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { LanguageCode } from "../../../../libs/contract/src/server/api.schemas.ts";
import {
  digestVersion,
  material,
  materialTopic,
  profile,
  source,
  sourceText,
  topic,
} from "../db/schema.ts";
import type { Env } from "../env.ts";
import { languageName } from "../languages.ts";
import { type ChatMessage, ModelUnavailable, chat, parseJson } from "../models/chat.ts";
import { tutorModel } from "../models/roles.ts";
import { type Playbook, loadPlaybook } from "../playbook.ts";

interface LabelledSource {
  id: string;
  /** `S1`, `S2`, … in Source order; the Tutor cites these. */
  label: string;
  fileName: string;
  text: string;
}

interface MaterialInput {
  materialId: string;
  profileId: string;
  language: string;
  playbook: Playbook;
  sources: LabelledSource[];
}

async function loadInput(env: Env, materialId: string): Promise<MaterialInput> {
  const d = drizzle(env.DB);
  const [row] = await d
    .select({ material, language: profile.language })
    .from(material)
    .innerJoin(profile, eq(profile.id, material.profileId))
    .where(eq(material.id, materialId));
  if (!row) throw new Error(`Material ${materialId} not found`);
  if (!row.material.playbookEdition)
    throw new Error(`Material ${materialId} has no Playbook edition`);

  const texts = await d
    .select({ id: source.id, fileName: source.fileName, textKey: sourceText.textKey })
    .from(sourceText)
    .innerJoin(source, eq(source.id, sourceText.sourceId))
    .where(eq(source.materialId, materialId))
    .orderBy(asc(source.position));
  const sources = await Promise.all(
    texts.map(async (t, i) => ({
      id: t.id,
      label: `S${i + 1}`,
      fileName: t.fileName,
      text: (await (await env.FILES.get(t.textKey))?.text()) ?? "",
    })),
  );
  return {
    materialId,
    profileId: row.material.profileId,
    language: languageName(row.language as LanguageCode),
    playbook: await loadPlaybook(env, row.material.playbookEdition),
    sources,
  };
}

const sourcesBlock = (sources: LabelledSource[]) =>
  sources.map((s) => `### [${s.label}] ${s.fileName}\n\n${s.text.trim()}`).join("\n\n");

const fill = (template: string, language: string) => template.replaceAll("{{language}}", language);

async function addCost(env: Env, materialId: string, micro: number) {
  if (micro <= 0) return;
  await drizzle(env.DB)
    .update(material)
    .set({ costMicroUsd: sql`${material.costMicroUsd} + ${micro}` })
    .where(eq(material.id, materialId));
}

async function ask(env: Env, materialId: string, messages: ChatMessage[], json: boolean) {
  const result = await chat(tutorModel(env), messages, { json });
  await addCost(env, materialId, result.costMicroUsd);
  return result.text;
}

interface SplitTopic {
  title: string;
  description: string;
}

function readTopics(answer: unknown): SplitTopic[] {
  const list = (answer as { topics?: unknown })?.topics;
  if (!Array.isArray(list)) throw new Error("topics is not a list");
  return list
    .filter(
      (t): t is SplitTopic =>
        typeof t?.title === "string" && t.title.trim() !== "" && typeof t?.description === "string",
    )
    .map((t) => ({ title: t.title.trim(), description: t.description.trim() }));
}

/** «Деление на Темы»: Topics of this Material. In this version every Topic is new. */
export async function splitTopics(env: Env, materialId: string): Promise<MaterialProcessingEvent> {
  const d = drizzle(env.DB);
  // A replayed step must not create the Topics twice.
  const done = await d.select().from(materialTopic).where(eq(materialTopic.materialId, materialId));
  if (done.length > 0) return { type: "TOPICS_SPLIT", count: done.length };

  const input = await loadInput(env, materialId);
  const known = await d
    .select({ id: topic.id, title: topic.title, description: topic.description })
    .from(topic)
    .where(eq(topic.profileId, input.profileId));

  let topics: SplitTopic[];
  try {
    const answer = await ask(
      env,
      materialId,
      [
        {
          role: "system",
          content: `${fill(input.playbook.file("content/tutor/topics.md"), input.language)}\n\n${input.playbook.file("content/plain-russian.md")}`,
        },
        {
          role: "user",
          content: `Темы Профиля:\n${known.length ? JSON.stringify(known, null, 2) : "пока нет"}\n\nФайлы Материала:\n\n${sourcesBlock(input.sources)}`,
        },
      ],
      true,
    );
    topics = readTopics(parseJson(answer));
  } catch (error) {
    // No answer after the retries (ModelUnavailable) or an answer that is not the JSON we asked for.
    console.error(
      "Tutor could not split topics",
      materialId,
      error instanceof ModelUnavailable ? error.message : error,
    );
    return { type: "TUTOR_FAILED" };
  }
  if (topics.length === 0) return { type: "TOPICS_SPLIT", count: 0 };

  const rows = topics.map((t) => ({ id: crypto.randomUUID(), profileId: input.profileId, ...t }));
  await d.batch([
    d.insert(topic).values(rows),
    d
      .insert(materialTopic)
      .values(rows.map((t, position) => ({ materialId, topicId: t.id, mark: "new", position }))),
  ]);
  return { type: "TOPICS_SPLIT", count: rows.length };
}

/** Topics of this Material in the Tutor's order, for the per-Topic flows. */
export async function materialTopicIds(env: Env, materialId: string): Promise<string[]> {
  const rows = await drizzle(env.DB)
    .select({ topicId: materialTopic.topicId })
    .from(materialTopic)
    .where(eq(materialTopic.materialId, materialId))
    .orderBy(asc(materialTopic.position));
  return rows.map((r) => r.topicId);
}

/** Turns the Tutor's `[S1]` labels into `[[source:<id>]]`; unknown labels stay as they are. */
function resolveLabels(markdown: string, sources: LabelledSource[]): string {
  const byLabel = new Map(sources.map((s) => [s.label, s.id]));
  return markdown.replace(/\[(S\d+)\]/g, (whole, label: string) => {
    const id = byLabel.get(label);
    return id ? `[[source:${id}]]` : whole;
  });
}

/** «Черновик Конспекта» for one Topic. */
export async function writeDraft(
  env: Env,
  materialId: string,
  topicId: string,
): Promise<TopicDigestEvent> {
  const input = await loadInput(env, materialId);
  const [t] = await drizzle(env.DB).select().from(topic).where(eq(topic.id, topicId));
  if (!t) throw new Error(`Topic ${topicId} not found`);
  const p = input.playbook;
  try {
    const markdown = await ask(
      env,
      materialId,
      [
        {
          role: "system",
          content: [
            fill(p.file("content/tutor/digest.md"), input.language),
            p.file("content/templates/digest.md"),
            p.file("content/plain-russian.md"),
            `# Глоссарий\n\n${p.file("GLOSSARY.md")}`,
          ].join("\n\n"),
        },
        {
          role: "user",
          content: `Тема: ${t.title}\nОписание: ${t.description}\n\nФайлы (метки: ${input.sources.map((s) => s.label).join(", ")}):\n\n${sourcesBlock(input.sources)}`,
        },
      ],
      false,
    );
    return { type: "DRAFTED", markdown: resolveLabels(markdown.trim(), input.sources) };
  } catch (error) {
    console.error("Tutor could not write the digest", materialId, topicId, error);
    return { type: "TUTOR_FAILED" };
  }
}

/** Stores the draft as the next version of the Topic's Digest (once per Material). */
export async function saveVersion(
  env: Env,
  materialId: string,
  topicId: string,
  markdown: string,
): Promise<TopicDigestEvent> {
  const d = drizzle(env.DB);
  const [m] = await d
    .select({ edition: material.playbookEdition })
    .from(material)
    .where(eq(material.id, materialId));
  const [last] = await d
    .select()
    .from(digestVersion)
    .where(eq(digestVersion.topicId, topicId))
    .orderBy(desc(digestVersion.number))
    .limit(1);
  if (last?.materialId === materialId) return { type: "SAVED" };
  const earlier: string[] = last ? JSON.parse(last.sourceMaterialIds) : [];
  await d
    .insert(digestVersion)
    .values({
      id: crypto.randomUUID(),
      topicId,
      number: (last?.number ?? 0) + 1,
      markdown,
      playbookEdition: m?.edition ?? "",
      materialId,
      sourceMaterialIds: JSON.stringify([...new Set([...earlier, materialId])]),
    })
    .onConflictDoNothing();
  return { type: "SAVED" };
}
