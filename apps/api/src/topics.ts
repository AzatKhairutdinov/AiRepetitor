import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  SourceText,
  Topic,
  TopicSummary,
} from "../../../libs/contract/src/server/api.schemas.ts";
import { digestVersion, material, profile, source, sourceText, topic } from "./db/schema.ts";
import type { Env } from "./env.ts";

const db = (env: Env) => drizzle(env.DB);

export async function listTopics(
  env: Env,
  userId: string,
  profileId: string,
): Promise<TopicSummary[] | null> {
  const d = db(env);
  const [owned] = await d
    .select({ id: profile.id })
    .from(profile)
    .where(and(eq(profile.id, profileId), eq(profile.userId, userId)));
  if (!owned) return null;
  return d
    .select({ id: topic.id, title: topic.title, description: topic.description })
    .from(topic)
    .where(eq(topic.profileId, profileId))
    .orderBy(asc(topic.title));
}

/** The Topic with its latest Digest version; another Learner's Topic looks missing. */
export async function getTopic(env: Env, userId: string, topicId: string): Promise<Topic | null> {
  const d = db(env);
  const [row] = await d
    .select({ topic })
    .from(topic)
    .innerJoin(profile, eq(profile.id, topic.profileId))
    .where(and(eq(topic.id, topicId), eq(profile.userId, userId)));
  if (!row) return null;
  const t = row.topic;

  const [latest] = await d
    .select()
    .from(digestVersion)
    .where(eq(digestVersion.topicId, topicId))
    .orderBy(desc(digestVersion.number))
    .limit(1);
  const materialIds: string[] = latest ? JSON.parse(latest.sourceMaterialIds) : [];
  const sources =
    materialIds.length === 0
      ? []
      : await d
          .select({ sourceId: source.id, fileName: source.fileName, materialId: source.materialId })
          .from(source)
          .innerJoin(sourceText, eq(sourceText.sourceId, source.id))
          .where(inArray(source.materialId, materialIds))
          .orderBy(asc(source.position));

  return {
    id: t.id,
    profileId: t.profileId,
    title: t.title,
    description: t.description,
    ...(latest
      ? {
          digest: {
            version: latest.number,
            markdown: latest.markdown,
            createdAt: latest.createdAt.toISOString(),
          },
        }
      : {}),
    sources,
  };
}

/** The text extracted from a Source of this Learner. */
export async function getSourceText(
  env: Env,
  userId: string,
  sourceId: string,
): Promise<SourceText | null> {
  const [row] = await db(env)
    .select({
      sourceId: source.id,
      fileName: source.fileName,
      materialId: source.materialId,
      profileId: material.profileId,
      textKey: sourceText.textKey,
    })
    .from(sourceText)
    .innerJoin(source, eq(source.id, sourceText.sourceId))
    .innerJoin(material, eq(material.id, source.materialId))
    .innerJoin(profile, eq(profile.id, material.profileId))
    .where(and(eq(source.id, sourceId), eq(profile.userId, userId)));
  if (!row) return null;
  const object = await env.FILES.get(row.textKey);
  if (!object) return null;
  const { textKey: _key, ...rest } = row;
  return { ...rest, markdown: await object.text() };
}
