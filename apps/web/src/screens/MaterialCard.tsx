import { materialsGetMaterial } from "@airepetitor/contract/client";
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
  }, [materialId, reload]);

  if (missing) return <main>Материал не найден.</main>;
  if (!material) return <main>Загрузка…</main>;

  return (
    <div style={{ display: "flex", gap: "2rem", flex: 1 }}>
      <main style={{ flex: 1 }}>
        <h2>{materialTitle(material)}</h2>
        <p>Статус: {MATERIAL_STATUS[material.status]}</p>
        {material.errorReason && <p role="alert">{material.errorReason}</p>}
        <section aria-label="Чат">{/* The Tutor's Chat arrives with a later ticket. */}</section>
      </main>
      <aside>
        <h3>Исходники</h3>
        <ul>
          {material.sources.map((s) => (
            <li key={s.id}>
              {s.fileName} — {SOURCE_STATUS[s.status]}
              {s.errorReason && <div role="alert">{s.errorReason}</div>}
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
