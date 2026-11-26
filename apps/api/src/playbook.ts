// Playbook editions (ADR 0005): the embedded edition is stored in D1 when a Processing starts,
// and every call of that Processing reads the files of its own edition.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { playbookEdition } from "./db/schema.ts";
import type { Env } from "./env.ts";
import type { CodeChecks } from "../../../libs/contract/src/server/api.schemas.ts";
import { PLAYBOOK_CHECKS, PLAYBOOK_EDITION, PLAYBOOK_FILES } from "./playbook.generated.ts";

export interface Playbook {
  edition: string;
  file(path: string): string;
  checks: CodeChecks;
}

/** Stores the current edition (once) and returns its id. */
export async function fixCurrentEdition(env: Env): Promise<string> {
  await drizzle(env.DB)
    .insert(playbookEdition)
    .values({
      edition: PLAYBOOK_EDITION,
      files: JSON.stringify(PLAYBOOK_FILES),
      checks: JSON.stringify(PLAYBOOK_CHECKS),
    })
    .onConflictDoNothing();
  return PLAYBOOK_EDITION;
}

export async function loadPlaybook(env: Env, edition: string): Promise<Playbook> {
  let files: Readonly<Record<string, string>> | null = PLAYBOOK_FILES;
  let checks: CodeChecks | null = PLAYBOOK_CHECKS;
  if (edition !== PLAYBOOK_EDITION) {
    const [row] = await drizzle(env.DB)
      .select()
      .from(playbookEdition)
      .where(eq(playbookEdition.edition, edition));
    files = row ? JSON.parse(row.files) : null;
    // Editions stored before Code Checks existed have none: check them by today's rules.
    checks = row ? (JSON.parse(row.checks) ?? PLAYBOOK_CHECKS) : null;
  }
  if (!files || !checks) throw new Error(`Playbook edition ${edition} is not stored`);
  const stored = files;
  return {
    edition,
    checks,
    file(path) {
      const text = stored[path];
      if (text === undefined) throw new Error(`Playbook ${edition} has no ${path}`);
      return text;
    },
  };
}
