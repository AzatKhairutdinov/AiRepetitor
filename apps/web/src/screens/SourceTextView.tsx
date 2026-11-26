import { getSourceText } from "@airepetitor/contract/client";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { useParams } from "react-router";
import type { SourceText } from "../../../../libs/contract/src/client/api.schemas.ts";

/** The text taken from one file, where Digest references lead. */
export function SourceTextView() {
  const { sourceId = "" } = useParams();
  const [text, setText] = useState<SourceText | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setText(null);
    setMissing(false);
    getSourceText(sourceId)
      .then((res) => (res.status === 200 ? setText(res.data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [sourceId]);

  if (missing) return <main>Текст файла не найден.</main>;
  if (!text) return <main>Загрузка…</main>;

  return (
    <main style={{ flex: 1, maxWidth: "48rem" }}>
      <h2>{text.fileName}</h2>
      <Markdown>{text.markdown}</Markdown>
    </main>
  );
}
