import { getSourceText } from "@airepetitor/contract/client";
import { secondsOf } from "@airepetitor/formats/source-labels";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { useLocation, useParams } from "react-router";
import { ScriptToggle, rehypeCyrillic, useSerbianScript } from "../serbian/script.tsx";
import { useProfile } from "./ProfileLayout.tsx";
import type { SourceText } from "../../../../libs/contract/src/client/api.schemas.ts";

/** A transcript line starts with its time: `[00:12:34] …`. */
const TIMED_LINE = /^\[(\d{2}:\d{2}:\d{2})\]/;

/** The latest transcript line that starts at or before `#t=hh:mm:ss`, or null. */
function lineAt(markdown: string, hash: string): string | null {
  const wanted = /^#t=(\d{2}:\d{2}:\d{2})$/.exec(hash)?.[1];
  if (!wanted) return null;
  let found: string | null = null;
  for (const line of markdown.split("\n")) {
    const at = TIMED_LINE.exec(line)?.[1];
    if (at && secondsOf(at) <= secondsOf(wanted)) found = at;
  }
  return found ?? markdown.match(TIMED_LINE)?.[1] ?? null;
}

/** The text taken from one file, where Digest references lead; `#t=` scrolls to a moment of a recording. */
export function SourceTextView() {
  const { sourceId = "" } = useParams();
  const { hash } = useLocation();
  const [text, setText] = useState<SourceText | null>(null);
  const [missing, setMissing] = useState(false);
  const { profile } = useProfile();
  const serbian = profile.language === "sr";
  const [script, setScript] = useSerbianScript();
  const plugins = serbian && script === "cyrillic" ? [rehypeCyrillic] : [];
  const active = text ? lineAt(text.markdown, hash) : null;

  useEffect(() => {
    setText(null);
    setMissing(false);
    getSourceText(sourceId)
      .then((res) => (res.status === 200 ? setText(res.data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [sourceId]);

  useEffect(() => {
    if (active)
      document.querySelector(`[data-time="${active}"]`)?.scrollIntoView({ block: "center" });
  }, [active]);

  if (missing) return <main>Текст файла не найден.</main>;
  if (!text) return <main>Загрузка…</main>;

  return (
    <main style={{ flex: 1, maxWidth: "48rem" }}>
      {serbian && <ScriptToggle script={script} onChange={setScript} />}
      <h2>{text.fileName}</h2>
      <Markdown
        rehypePlugins={plugins}
        components={{
          p: ({ node, children }) => {
            const first = node?.children[0];
            const at = first?.type === "text" ? TIMED_LINE.exec(first.value)?.[1] : undefined;
            return (
              <p
                data-time={at}
                style={at && at === active ? { background: "Mark", color: "MarkText" } : undefined}
              >
                {children}
              </p>
            );
          },
        }}
      >
        {text.markdown}
      </Markdown>
    </main>
  );
}
