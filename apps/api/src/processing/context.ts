// What the Tutor and the Methodologist read in one Processing: the Material's Source texts,
// the Profile's language and the Playbook edition fixed at the start.
import {
  MODEL_LABEL,
  STORED_LABEL,
  modelLabel,
  storedLabel,
} from "@airepetitor/formats/source-labels";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { LanguageCode } from "../../../../libs/contract/src/server/api.schemas.ts";
import { digestVersion, material, profile, source, sourceText } from "../db/schema.ts";
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

/** Turns the Tutor's `[S1]` and `[S1 00:12:34]` labels into stored ones; unknown labels stay as they are. */
export function resolveLabels(markdown: string, sources: LabelledSource[]): string {
  const byLabel = new Map(sources.map((s) => [s.label, s.id]));
  return markdown.replace(MODEL_LABEL, (whole, label: string, at?: string) => {
    const id = byLabel.get(label);
    return id ? storedLabel(id, at) : whole;
  });
}

/** The reverse, so the models read `[S1]` and `[S1 00:12:34]` again. */
export function labelSources(markdown: string, sources: LabelledSource[]): string {
  const byId = new Map(sources.map((s) => [s.id, s.label]));
  return markdown.replace(STORED_LABEL, (whole, id: string, at?: string) => {
    const label = byId.get(id);
    return label ? modelLabel(label, at) : whole;
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

/** The Topic's latest Digest version written by an earlier Material, if any. */
export interface PreviousVersion {
  number: number;
  markdown: string;
  sourceMaterialIds: string[];
  /** Sources the previous version cites, labelled `P1`, `P2`, … (their texts are not re-read). */
  labels: LabelledSource[];
}

export async function previousVersion(
  env: Env,
  topicId: string,
  materialId: string,
): Promise<PreviousVersion | null> {
  const [last] = await drizzle(env.DB)
    .select()
    .from(digestVersion)
    .where(and(eq(digestVersion.topicId, topicId), ne(digestVersion.materialId, materialId)))
    .orderBy(desc(digestVersion.number))
    .limit(1);
  if (!last) return null;
  const ids = [...new Set([...last.markdown.matchAll(STORED_LABEL)].map((m) => m[1]!))];
  return {
    number: last.number,
    markdown: last.markdown,
    sourceMaterialIds: JSON.parse(last.sourceMaterialIds),
    labels: ids.map((id, i) => ({ id, label: `P${i + 1}`, fileName: "", text: "" })),
  };
}

/**
 * Source ids a Digest of this Processing may cite: this Material's, the previous version's
 * Materials', and every label the previous version already carried, even when its Material was
 * deleted since (the label then reads «материал удалён»).
 */
export async function citableSourceIds(
  env: Env,
  materialId: string,
  previous: PreviousVersion | null,
) {
  const materials = [materialId, ...(previous?.sourceMaterialIds ?? [])];
  const rows = await drizzle(env.DB)
    .select({ id: source.id })
    .from(source)
    .where(inArray(source.materialId, materials));
  return new Set([...rows.map((r) => r.id), ...(previous?.labels.map((l) => l.id) ?? [])]);
}
