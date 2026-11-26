// Playbook editions (ADR 0005): the embedded edition is stored in D1 when a Processing starts,
// and every call of that Processing reads the files of its own edition.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { playbookEdition } from "./db/schema.ts";
import type { Env } from "./env.ts";
import { PLAYBOOK_EDITION, PLAYBOOK_FILES } from "./playbook.generated.ts";

export interface Playbook {
  edition: string;
  file(path: string): string;
}

/** Stores the current edition (once) and returns its id. */
export async function fixCurrentEdition(env: Env): Promise<string> {
  await drizzle(env.DB)
    .insert(playbookEdition)
    .values({ edition: PLAYBOOK_EDITION, files: JSON.stringify(PLAYBOOK_FILES) })
    .onConflictDoNothing();
  return PLAYBOOK_EDITION;
}

export async function loadPlaybook(env: Env, edition: string): Promise<Playbook> {
  const files: Readonly<Record<string, string>> =
    edition === PLAYBOOK_EDITION
      ? PLAYBOOK_FILES
      : JSON.parse(
          (
            await drizzle(env.DB)
              .select()
              .from(playbookEdition)
              .where(eq(playbookEdition.edition, edition))
          )[0]?.files ?? "null",
        );
  if (!files) throw new Error(`Playbook edition ${edition} is not stored`);
  return {
    edition,
    file(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`Playbook ${edition} has no ${path}`);
      return text;
    },
  };
}
