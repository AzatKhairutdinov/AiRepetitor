import { profilesListProfiles } from "@airepetitor/contract/client";
import type { Profile } from "../../../../libs/contract/src/client/api.schemas.ts";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";

/** No Profiles → choose a language; one → straight into it; several → pick one. */
export function ChooseProfile() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    profilesListProfiles()
      .then((res) => (res.status === 200 ? setProfiles(res.data.items) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <main role="alert">Не удалось загрузить профили. Обновите страницу.</main>;
  if (!profiles) return <main>Загрузка…</main>;
  if (profiles.length === 0) return <Navigate to="/languages" replace />;
  if (profiles.length === 1) return <Navigate to={`/profiles/${profiles[0]!.id}`} replace />;

  return (
    <main>
      <h1>Выберите язык</h1>
      <ul>
        {profiles.map((p) => (
          <li key={p.id}>
            <Link to={`/profiles/${p.id}`}>{p.name}</Link>
          </li>
        ))}
      </ul>
      <Link to="/languages">Добавить язык</Link>
    </main>
  );
}
