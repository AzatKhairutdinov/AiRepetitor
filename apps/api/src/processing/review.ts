// Checks of the Tutor's work: Code Checks first, then the Methodologist. Every check stores a
// Check Report; the Learner never sees them.
import type {
  MaterialProcessingEvent,
  ProposedTopic,
  ReviewError,
  TopicDigestEvent,
} from "@airepetitor/flows";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { runCodeChecks } from "../checks.ts";
import { checkReport, topic } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { parseJson } from "../models/chat.ts";
import { methodologistModel } from "../models/roles.ts";
import {
  ask,
  citableSourceIds,
  digestRules,
  fill,
  labelSources,
  loadInput,
  previousVersion,
  sourcesBlock,
} from "./context.ts";

const KINDS = new Set<ReviewError["kind"]>([
  "факт",
  "пропуск",
  "шаблон",
  "простой русский",
  "тема",
]);

function readReview(answer: unknown): { passed: boolean; errors: ReviewError[] } {
  const a = answer as { passed?: unknown; errors?: unknown };
  if (typeof a?.passed !== "boolean") throw new Error("passed is not a boolean");
  const errors = (Array.isArray(a.errors) ? a.errors : [])
    .filter((e) => KINDS.has(e?.kind))
    .map((e) => ({ kind: e.kind, quote: String(e.quote ?? ""), fix: String(e.fix ?? "") }));
  // Findings decide: «passed: false» without a usable finding gives the Tutor nothing to fix.
  return { passed: errors.length === 0, errors };
}

async function saveReport(
  env: Env,
  report: {
    materialId: string;
    topicId: string | null;
    kind: string;
    round: number;
    passed: boolean;
    findings: unknown;
  },
) {
  await drizzle(env.DB)
    .insert(checkReport)
    .values({ id: crypto.randomUUID(), ...report, findings: JSON.stringify(report.findings) });
}

/** Code Checks of the current draft. */
export async function checkDraft(
  env: Env,
  materialId: string,
  topicId: string,
  draft: string,
  round: number,
): Promise<TopicDigestEvent> {
  const input = await loadInput(env, materialId);
  const previous = await previousVersion(env, topicId, materialId);
  const violations = runCodeChecks(
    draft,
    input.playbook.checks,
    await citableSourceIds(env, materialId, previous),
  );
  await saveReport(env, {
    materialId,
    topicId,
    kind: "codeChecks",
    round,
    passed: violations.length === 0,
    findings: violations,
  });
  return { type: "CHECKED", violations };
}

/** The Methodologist checks the draft against the Source texts of this Material. */
export async function reviewDigest(
  env: Env,
  materialId: string,
  topicId: string,
  draft: string,
  round: number,
  violations: string[],
): Promise<TopicDigestEvent> {
  const input = await loadInput(env, materialId);
  const [t] = await drizzle(env.DB).select().from(topic).where(eq(topic.id, topicId));
  const previous = await previousVersion(env, topicId, materialId);
  const labels = [...input.sources, ...(previous?.labels ?? [])];
  const instruction = previous
    ? "content/methodologist/digest-update.md"
    : "content/methodologist/digest.md";
  try {
    const answer = await ask(
      env,
      methodologistModel(env),
      materialId,
      [
        {
          role: "system",
          content: `${fill(input.playbook.file(instruction), input.language)}\n\n${digestRules(input.playbook)}`,
        },
        {
          role: "user",
          content: [
            `Тема: ${t?.title}\nОписание: ${t?.description}`,
            violations.length
              ? `Нарушения Проверок кодом, которые остались:\n${violations.join("\n")}`
              : "",
            previous
              ? `Прошлая проверенная версия (${previous.number}):\n\n${labelSources(previous.markdown, labels)}`
              : "",
            `${previous ? "Новая версия" : "Конспект"}:\n\n${labelSources(draft, labels)}`,
            sourcesBlock(input.sources),
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      true,
    );
    const review = readReview(parseJson(answer));
    await saveReport(env, {
      materialId,
      topicId,
      kind: "methodologist",
      round,
      passed: review.passed,
      findings: { errors: review.errors, codeViolations: violations },
    });
    return { type: "REVIEWED", ...review };
  } catch (error) {
    console.error("Methodologist could not review the digest", materialId, topicId, error);
    return { type: "MODEL_FAILED" };
  }
}

/** The Methodologist checks the Tutor's split against the Profile's Topics. */
export async function reviewTopics(
  env: Env,
  materialId: string,
  proposal: ProposedTopic[],
  round: number,
): Promise<MaterialProcessingEvent> {
  const input = await loadInput(env, materialId);
  const known = await drizzle(env.DB)
    .select({ id: topic.id, title: topic.title, description: topic.description })
    .from(topic)
    .where(eq(topic.profileId, input.profileId));
  try {
    const answer = await ask(
      env,
      methodologistModel(env),
      materialId,
      [
        {
          role: "system",
          content: `${fill(input.playbook.file("content/methodologist/topics.md"), input.language)}\n\n${input.playbook.file("content/plain-russian.md")}`,
        },
        {
          role: "user",
          content: [
            `Темы Профиля:\n${known.length ? JSON.stringify(known, null, 2) : "пока нет"}`,
            `Деление Репетитора:\n${JSON.stringify(proposal, null, 2)}`,
            sourcesBlock(input.sources),
          ].join("\n\n"),
        },
      ],
      true,
    );
    const review = readReview(parseJson(answer));
    await saveReport(env, {
      materialId,
      topicId: null,
      kind: "topics",
      round,
      passed: review.passed,
      findings: review.errors,
    });
    return { type: "TOPICS_REVIEWED", ...review };
  } catch (error) {
    console.error("Methodologist could not review the topics", materialId, error);
    return { type: "MODEL_FAILED" };
  }
}
