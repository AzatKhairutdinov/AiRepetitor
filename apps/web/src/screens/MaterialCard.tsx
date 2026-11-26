import {
  materialsGetMaterial,
  materialsRetryMaterial,
  retrySource,
} from "@airepetitor/contract/client";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useProfile } from "./ProfileLayout.tsx";
import type { Material, MaterialStatus } from "../../../../libs/contract/src/client/api.schemas.ts";
import { MATERIAL_STATUS, SOURCE_STATUS, materialTitle } from "../labels.ts";

const POLL_MS = 5000;
const FINAL_STATUSES = new Set<MaterialStatus>(["topicsReady", "noTopics", "failed"]);

/** Material Card: the Chat in the middle (empty for now), Sources with statuses beside it. */
export function MaterialCard() {
  const { materialId = "" } = useParams();
  const [material, setMaterial] = useState<Material | null>(null);
  const [missing, setMissing] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Bumped after «Повторить» so polling starts again.
  const [round, setRound] = useState(0);
  const { reload } = useProfile();

  useEffect(() => {
    setMaterial(null);
    setMissing(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // Poll every 5 s until the Material reaches a final state.
    const load = () =>
      materialsGetMaterial(materialId)
        .then((res) => {
          if (stopped) return;
          if (res.status !== 200) return setMissing(true);
          setMaterial(res.data);
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
        <section aria-label="Чат">{/* The Tutor's Chat arrives with a later ticket. */}</section>
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
