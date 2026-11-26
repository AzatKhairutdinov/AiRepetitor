// What the Tutor and the Methodologist read in one Processing: the Material's Source texts,
// the Profile's language and the Playbook edition fixed at the start.
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { LanguageCode } from "../../../../libs/contract/src/server/api.schemas.ts";
import { material, profile, source, sourceText } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { languageName } from "../languages.ts";
import { type ChatMessage, type ModelConfig, chat } from "../models/chat.ts";
import { type Playbook, loadPlaybook } from "../playbook.ts";

export interface LabelledSource {
  id: string;
  /** `S1`, `S2`, … in Source order; the Tutor cites these. */
  label: string;
  fileName: string;
  text: string;
}

export interface MaterialInput {
  materialId: string;
  profileId: string;
  language: string;
  playbook: Playbook;
  sources: LabelledSource[];
}

export async function loadInput(env: Env, materialId: string): Promise<MaterialInput> {
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

export const sourcesBlock = (sources: LabelledSource[]) =>
  `Материалы (метки: ${sources.map((s) => s.label).join(", ")}):\n\n` +
  sources.map((s) => `### [${s.label}] ${s.fileName}\n\n${s.text.trim()}`).join("\n\n");

export const fill = (template: string, language: string) =>
  template.replaceAll("{{language}}", language);

/** Turns the Tutor's `[S1]` labels into `[[source:<id>]]`; unknown labels stay as they are. */
export function resolveLabels(markdown: string, sources: LabelledSource[]): string {
  const byLabel = new Map(sources.map((s) => [s.label, s.id]));
  return markdown.replace(/\[(S\d+)\]/g, (whole, label: string) => {
    const id = byLabel.get(label);
    return id ? `[[source:${id}]]` : whole;
  });
}

/** The reverse, so the models read `[S1]` again. */
export function labelSources(markdown: string, sources: LabelledSource[]): string {
  const byId = new Map(sources.map((s) => [s.id, s.label]));
  return markdown.replace(/\[\[source:([\w-]+)\]\]/g, (whole, id: string) => {
    const label = byId.get(id);
    return label ? `[${label}]` : whole;
  });
}

/** Calls a model and adds the call's cost to the Material. */
export async function ask(
  env: Env,
  model: ModelConfig,
  materialId: string,
  messages: ChatMessage[],
  json: boolean,
): Promise<string> {
  const result = await chat(model, messages, { json });
  if (result.costMicroUsd > 0) {
    await drizzle(env.DB)
      .update(material)
      .set({ costMicroUsd: sql`${material.costMicroUsd} + ${result.costMicroUsd}` })
      .where(eq(material.id, materialId));
  }
  return result.text;
}

/** Everything a writer or a reviewer of a Digest needs to know about the rules. */
export function digestRules(p: Playbook): string {
  return [
    p.file("content/templates/digest.md"),
    p.file("content/plain-russian.md"),
    `# Запретные слова\n\n${p.checks.forbiddenWords.join(", ")}`,
    `# Глоссарий\n\n${p.file("GLOSSARY.md")}`,
  ].join("\n\n");
}
