import { getTopic } from "@airepetitor/contract/client";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { Link, useParams } from "react-router";
import type { Topic } from "../../../../libs/contract/src/client/api.schemas.ts";

/** `[[source:<id>]]` → a link to that Source text, named after its file. */
function withSourceLinks(topic: Topic): string {
  const names = new Map(topic.sources.map((s) => [s.sourceId, s.fileName]));
  return (topic.digest?.markdown ?? "").replace(/\[\[source:([\w-]+)\]\]/g, (_, id: string) => {
    const name = names.get(id);
    return name ? `[${name}](/profiles/${topic.profileId}/sources/${id})` : "";
  });
}

/** «Конспект Темы»: the latest version only. */
export function TopicDigest() {
  const { topicId = "" } = useParams();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [missing, setMissing] = useState(false);

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
      <Markdown
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
