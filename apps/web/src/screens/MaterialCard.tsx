import { materialsGetMaterial } from "@airepetitor/contract/client";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { Material } from "../../../../libs/contract/src/client/api.schemas.ts";
import { MATERIAL_STATUS, SOURCE_STATUS, materialTitle } from "../labels.ts";

/** Material Card: the Chat in the middle (empty for now), Sources with statuses beside it. */
export function MaterialCard() {
  const { materialId = "" } = useParams();
  const [material, setMaterial] = useState<Material | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMaterial(null);
    setMissing(false);
    materialsGetMaterial(materialId)
      .then((res) => (res.status === 200 ? setMaterial(res.data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [materialId]);

  if (missing) return <main>Материал не найден.</main>;
  if (!material) return <main>Загрузка…</main>;

  return (
    <div style={{ display: "flex", gap: "2rem", flex: 1 }}>
      <main style={{ flex: 1 }}>
        <h2>{materialTitle(material)}</h2>
        <p>Статус: {MATERIAL_STATUS[material.status]}</p>
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
      </aside>
    </div>
  );
}
