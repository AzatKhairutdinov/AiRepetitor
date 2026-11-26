import {
  materialsDeleteMaterial,
  materialsGetMaterial,
  materialsListMessages,
  materialsRetryMaterial,
  retrySource,
} from "@airepetitor/contract/client";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useProfile } from "./ProfileLayout.tsx";
import type {
  Material,
  MaterialStatus,
  Message,
} from "../../../../libs/contract/src/client/api.schemas.ts";
import { MATERIAL_STATUS, SOURCE_STATUS, materialTitle } from "../labels.ts";

const POLL_MS = 5000;
const FINAL_STATUSES = new Set<MaterialStatus>(["topicsReady", "noTopics", "failed"]);
/** While the Material waits for or goes through Processing it cannot be deleted. */
const BUSY_STATUSES = new Set<MaterialStatus>(["uploaded", "queued", "processing"]);

const TIME = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });

/** Material Card: the Tutor's Chat in the middle, Sources with statuses beside it. */
export function MaterialCard() {
  const { materialId = "" } = useParams();
  const [material, setMaterial] = useState<Material | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [missing, setMissing] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Bumped after «Повторить» so polling starts again.
  const [round, setRound] = useState(0);
  const { reload } = useProfile();
  const navigate = useNavigate();

  useEffect(() => {
    setMaterial(null);
    setMessages([]);
    setMissing(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // Poll the Material and then its Chat every 5 s until the Material reaches a final state.
    // The Chat is read second: its last line is written before the final status.
    const load = () =>
      materialsGetMaterial(materialId)
        .then(async (res) => [res, await materialsListMessages(materialId)] as const)
        .then(([res, chat]) => {
          if (stopped) return;
          if (res.status !== 200) return setMissing(true);
          setMaterial(res.data);
          if (chat.status === 200) setMessages(chat.data.items);
          if (!FINAL_STATUSES.has(res.data.status)) timer = setTimeout(load, POLL_MS);
          // New Topics appear in the menu once Processing is over.
          else reload();
        })
        .catch(() => {
          if (!stopped) timer = setTimeout(load, POLL_MS);
        });
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [materialId, reload, round]);

  /** «Повторить»: the API answers with the Material back in the queue, or why it cannot. */
  const retry = async (request: () => ReturnType<typeof materialsRetryMaterial>) => {
    setRetryError(null);
    try {
      const res = await request();
      if (res.status === 200) {
        setMaterial(res.data);
        setRound((r) => r + 1);
      } else setRetryError(res.data.message);
    } catch {
      setRetryError("Не удалось связаться с сервером, попробуйте ещё раз");
    }
  };

  /** Deletes the whole Material after a confirmation; Digests of its Topics stay. */
  const remove = async (current: Material) => {
    if (!window.confirm("Удалить материал? Конспекты тем останутся")) return;
    setRetryError(null);
    try {
      const res = await materialsDeleteMaterial(current.id);
      if (res.status === 204) {
        reload();
        void navigate(`/profiles/${current.profileId}`);
      } else setRetryError(res.data.message);
    } catch {
      setRetryError("Не удалось связаться с сервером, попробуйте ещё раз");
    }
  };

  if (missing) return <main>Материал не найден.</main>;
  if (!material) return <main>Загрузка…</main>;

  return (
    <div style={{ display: "flex", gap: "2rem", flex: 1 }}>
      <main style={{ flex: 1 }}>
        <h2>{materialTitle(material)}</h2>
        <p>Статус: {MATERIAL_STATUS[material.status]}</p>
        {material.errorReason && <p role="alert">{material.errorReason}</p>}
        {material.status === "failed" && (
          <button
            type="button"
            onClick={() => void retry(() => materialsRetryMaterial(material.id))}
          >
            Повторить
          </button>
        )}
        {retryError && <p role="alert">{retryError}</p>}
        {!BUSY_STATUSES.has(material.status) && (
          <button type="button" onClick={() => void remove(material)}>
            Удалить материал
          </button>
        )}
        <section aria-label="Чат">
          {messages.length === 0 ? (
            <p>Репетитор ещё ничего не написал.</p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0 }}>
              {messages.map((m) => (
                <li key={m.id} style={{ marginBottom: "0.75rem" }}>
                  <strong>{m.author === "tutor" ? "Репетитор" : "Вы"}</strong>{" "}
                  <time dateTime={m.createdAt}>{TIME.format(new Date(m.createdAt))}</time>
                  <p style={{ margin: "0.25rem 0 0" }}>{m.text}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
      <aside>
        <h3>Исходники</h3>
        <ul>
          {material.sources.map((s) => (
            <li key={s.id}>
              {s.fileName} — {SOURCE_STATUS[s.status]}
              {s.errorReason && <div role="alert">{s.errorReason}</div>}
              {s.status === "failed" && material.status === "failed" && (
                <button type="button" onClick={() => void retry(() => retrySource(s.id))}>
                  Повторить
                </button>
              )}
            </li>
          ))}
        </ul>
        <h3>Темы</h3>
        {material.topics.length === 0 ? (
          <p>Пока нет</p>
        ) : (
          <ul>
            {material.topics.map((t) => (
              <li key={t.id}>
                <Link to={`/profiles/${material.profileId}/topics/${t.id}`}>{t.title}</Link> —{" "}
                {t.mark === "new" ? "новая" : "дополнена"}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
