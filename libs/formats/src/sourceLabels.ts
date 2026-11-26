// Source labels of a Digest. The Tutor writes `[S1]` or, for a moment of a recording, `[S1 00:12:34]`;
// the Digest stores `[[source:<id>]]` or `[[source:<id>@00:12:34]]`. Shared by the API and the web app.

/** A stored label: group 1 is the Source id, group 2 the optional `hh:mm:ss`. */
export const STORED_LABEL = /\[\[source:([\w-]+)(?:@(\d{2}:\d{2}:\d{2}))?\]\]/g;

/** A label as the models write it: group 1 is `S1` or `P1`, group 2 the optional `hh:mm:ss`. */
export const MODEL_LABEL = /\[([SP]\d+)(?: (\d{2}:\d{2}:\d{2}))?\]/g;

export const storedLabel = (sourceId: string, at?: string) =>
  at ? `[[source:${sourceId}@${at}]]` : `[[source:${sourceId}]]`;

export const modelLabel = (label: string, at?: string) => (at ? `[${label} ${at}]` : `[${label}]`);

/** Seconds from `hh:mm:ss`. */
export function secondsOf(at: string): number {
  const [h = 0, m = 0, s = 0] = at.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}
