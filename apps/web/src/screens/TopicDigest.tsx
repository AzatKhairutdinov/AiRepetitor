import { getTopic } from "@airepetitor/contract/client";
import { STORED_LABEL } from "@airepetitor/formats/source-labels";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { Link, useParams } from "react-router";
import { ScriptToggle, rehypeCyrillic, useSerbianScript } from "../serbian/script.tsx";
import { useProfile } from "./ProfileLayout.tsx";
import type { Topic } from "../../../../libs/contract/src/client/api.schemas.ts";

/**
 * `[[source:<id>]]` → a link to that Source text, named after its file; a time label leads to that
 * moment. A Source of a deleted Material is no longer listed: its label reads «материал удалён».
 */
function withSourceLinks(topic: Topic): string {
  const names = new Map(topic.sources.map((s) => [s.sourceId, s.fileName]));
  return (topic.digest?.markdown ?? "").replace(STORED_LABEL, (_, id: string, at?: string) => {
    const name = names.get(id);
    if (!name) return "_материал удалён_";
    const href = `/profiles/${topic.profileId}/sources/${id}`;
    return at ? `[${name}, ${at}](${href}#t=${at})` : `[${name}](${href})`;
  });
}

/** «Конспект Темы»: the latest version only. */
export function TopicDigest() {
  const { topicId = "" } = useParams();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [missing, setMissing] = useState(false);
  const { profile } = useProfile();
  const serbian = profile.language === "sr";
  const [script, setScript] = useSerbianScript();
  const plugins = serbian && script === "cyrillic" ? [rehypeCyrillic] : [];

  useEffect(() => {
    setTopic(null);
    setMissing(false);
    getTopic(topicId)
      .then((res) => (res.status === 200 ? setTopic(res.data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [topicId]);

  if (missing) return <main>Тема не найдена.</main>;
  if (!topic) return <main>Загрузка…</main>;
  if (!topic.digest) return <main>Конспект этой темы ещё пишется.</main>;

  return (
    <main style={{ flex: 1, maxWidth: "48rem" }}>
      {serbian && <ScriptToggle script={script} onChange={setScript} />}
      <Markdown
        rehypePlugins={plugins}
        components={{
          a: ({ href, children }) =>
            href?.startsWith("/") ? (
              <Link to={href}>{children}</Link>
            ) : (
              <a href={href}>{children}</a>
            ),
        }}
      >
        {withSourceLinks(topic)}
      </Markdown>
    </main>
  );
}
