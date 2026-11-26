// The Tutor's steps in Processing. Each returns the event for its machine; a model that does
// not answer after the retries (or answers in a wrong shape) becomes MODEL_FAILED.
import type {
  MaterialProcessingEvent,
  ProposedTopic,
  ReviewError,
  TopicDigestEvent,
} from "@airepetitor/flows";
import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { digestVersion, material, materialTopic, topic } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { parseJson } from "../models/chat.ts";
import { tutorModel } from "../models/roles.ts";
import {
  ask,
  digestRules,
  fill,
  labelSources,
  loadInput,
  resolveLabels,
  sourcesBlock,
} from "./context.ts";

function readTopics(answer: unknown): ProposedTopic[] {
  const list = (answer as { topics?: unknown })?.topics;
  if (!Array.isArray(list)) throw new Error("topics is not a list");
  return list
    .filter(
      (t) =>
        typeof t?.title === "string" && t.title.trim() !== "" && typeof t?.description === "string",
    )
    .map((t) => ({
      title: String(t.title).trim(),
      description: String(t.description).trim(),
      existingTopicId: typeof t.existingTopicId === "string" ? t.existingTopicId : null,
    }));
}

const findingsBlock = (errors: ReviewError[]) =>
  errors.map((e, i) => `${i + 1}. [${e.kind}] «${e.quote}» — ${e.fix}`).join("\n");

/** «Деление на Темы»; after a wrong split it gets the Methodologist's findings. */
export async function splitTopics(
  env: Env,
  materialId: string,
  findings: ReviewError[],
): Promise<MaterialProcessingEvent> {
  const input = await loadInput(env, materialId);
  const known = await drizzle(env.DB)
    .select({ id: topic.id, title: topic.title, description: topic.description })
    .from(topic)
    .where(eq(topic.profileId, input.profileId));
  try {
    const answer = await ask(
      env,
      tutorModel(env),
      materialId,
      [
        {
          role: "system",
          content: `${fill(input.playbook.file("content/tutor/topics.md"), input.language)}\n\n${input.playbook.file("content/plain-russian.md")}`,
        },
        {
          role: "user",
          content: [
            `Темы Профиля:\n${known.length ? JSON.stringify(known, null, 2) : "пока нет"}`,
            findings.length
              ? `Замечания к прошлому делению, исправьте их:\n${findingsBlock(findings)}`
              : "",
            sourcesBlock(input.sources),
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      true,
    );
    return { type: "TOPICS_SPLIT", topics: readTopics(parseJson(answer)) };
  } catch (error) {
    console.error("Tutor could not split topics", materialId, error);
    return { type: "MODEL_FAILED" };
  }
}

/** Stores the split: new Topics of the Profile, all marked «new» for this Material. */
export async function commitTopics(
  env: Env,
  materialId: string,
  proposal: ProposedTopic[],
): Promise<MaterialProcessingEvent> {
  const d = drizzle(env.DB);
  // A replayed step must not create the Topics twice.
  const done = await d.select().from(materialTopic).where(eq(materialTopic.materialId, materialId));
  if (done.length > 0) return { type: "TOPICS_COMMITTED", count: done.length };
  const [m] = await d
    .select({ profileId: material.profileId })
    .from(material)
    .where(eq(material.id, materialId));
  if (!m || proposal.length === 0) return { type: "TOPICS_COMMITTED", count: 0 };

  // Every Topic is new in this version; extending a known Topic arrives with its own ticket.
  const rows = proposal.map((t) => ({
    id: crypto.randomUUID(),
    profileId: m.profileId,
    title: t.title,
    description: t.description,
  }));
  await d.batch([
    d.insert(topic).values(rows),
    d
      .insert(materialTopic)
      .values(rows.map((t, position) => ({ materialId, topicId: t.id, mark: "new", position }))),
  ]);
  return { type: "TOPICS_COMMITTED", count: rows.length };
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

async function loadTopic(env: Env, topicId: string) {
  const [t] = await drizzle(env.DB).select().from(topic).where(eq(topic.id, topicId));
  if (!t) throw new Error(`Topic ${topicId} not found`);
  return t;
}

/** «Черновик Конспекта» for one Topic. */
export async function writeDraft(
  env: Env,
  materialId: string,
  topicId: string,
): Promise<TopicDigestEvent> {
  const input = await loadInput(env, materialId);
  const t = await loadTopic(env, topicId);
  try {
    const markdown = await ask(
      env,
      tutorModel(env),
      materialId,
      [
        {
          role: "system",
          content: `${fill(input.playbook.file("content/tutor/digest.md"), input.language)}\n\n${digestRules(input.playbook)}`,
        },
        {
          role: "user",
          content: `Тема: ${t.title}\nОписание: ${t.description}\n\n${sourcesBlock(input.sources)}`,
        },
      ],
      false,
    );
    return { type: "DRAFTED", markdown: resolveLabels(markdown.trim(), input.sources) };
  } catch (error) {
    console.error("Tutor could not write the digest", materialId, topicId, error);
    return { type: "MODEL_FAILED" };
  }
}

/** A revision of the draft: by Code Check violations or by the Methodologist's report. */
export async function reviseDraft(
  env: Env,
  materialId: string,
  topicId: string,
  draft: string,
  remarks: string[],
): Promise<TopicDigestEvent> {
  const input = await loadInput(env, materialId);
  const t = await loadTopic(env, topicId);
  try {
    const markdown = await ask(
      env,
      tutorModel(env),
      materialId,
      [
        {
          role: "system",
          content: `${fill(input.playbook.file("content/tutor/revise.md"), input.language)}\n\n${digestRules(input.playbook)}`,
        },
        {
          role: "user",
          content: [
            `Тема: ${t.title}\nОписание: ${t.description}`,
            `Замечания:\n${remarks.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
            `Конспект:\n\n${labelSources(draft, input.sources)}`,
            sourcesBlock(input.sources),
          ].join("\n\n"),
        },
      ],
      false,
    );
    return { type: "DRAFTED", markdown: resolveLabels(markdown.trim(), input.sources) };
  } catch (error) {
    console.error("Tutor could not revise the digest", materialId, topicId, error);
    return { type: "MODEL_FAILED" };
  }
}

export const remarksFromReport = (errors: ReviewError[]) =>
  errors.map((e) => `[${e.kind}] «${e.quote}» — ${e.fix}`);

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
