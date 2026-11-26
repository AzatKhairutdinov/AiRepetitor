import { profilesGetProfile } from "@airepetitor/contract/client";
import type { Profile } from "../../../../libs/contract/src/client/api.schemas.ts";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

/** Empty Profile home: a single «Загрузить материал» button. */
export function ProfileHome() {
  const { profileId = "" } = useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setProfile(null);
    setMissing(false);
    profilesGetProfile(profileId)
      .then((res) => (res.status === 200 ? setProfile(res.data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [profileId]);

  if (missing)
    return (
      <main>
        Профиль не найден. <Link to="/">К профилям</Link>
      </main>
    );
  if (!profile) return <main>Загрузка…</main>;

  return (
    <main>
      <header>
        <h1>{profile.name}</h1>
        <Link to="/">Сменить язык</Link>
      </header>
      {/* The upload window arrives with the next ticket. */}
      <button type="button" disabled>
        Загрузить материал
      </button>
    </main>
  );
}
