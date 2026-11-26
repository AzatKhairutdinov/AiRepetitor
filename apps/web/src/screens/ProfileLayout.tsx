import {
  listTopics,
  profileMaterialsListMaterials,
  profilesGetProfile,
  teamListFlows,
} from "@airepetitor/contract/client";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router";
import type {
  MaterialSummary,
  Profile,
  TopicSummary,
} from "../../../../libs/contract/src/client/api.schemas.ts";
import { materialTitle } from "../labels.ts";
import { UploadDialog } from "./UploadDialog.tsx";

interface ProfileContext {
  profile: Profile;
  materials: MaterialSummary[];
  openUpload: () => void;
  /** Re-reads the menu lists, e.g. when a Material finished Processing. */
  reload: () => void;
}

export const useProfile = () => useOutletContext<ProfileContext>();

/** Profile menu on the left (Материалы), the screen in the middle. */
export function ProfileLayout() {
  const { profileId = "" } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [materials, setMaterials] = useState<MaterialSummary[]>([]);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [missing, setMissing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [team, setTeam] = useState(false);

  // The Team menu item shows only when the Team endpoint lets this account in.
  useEffect(() => {
    teamListFlows()
      .then((res) => setTeam(res.status === 200))
      .catch(() => setTeam(false));
  }, []);

  const reloadMaterials = useCallback(async () => {
    const [m, t] = await Promise.all([
      profileMaterialsListMaterials(profileId),
      listTopics(profileId),
    ]);
    if (m.status === 200) setMaterials(m.data.items);
    if (t.status === 200) setTopics(t.data.items);
  }, [profileId]);

  const reload = useCallback(() => void reloadMaterials(), [reloadMaterials]);

  useEffect(() => {
    setProfile(null);
    setMissing(false);
    profilesGetProfile(profileId)
      .then((res) => (res.status === 200 ? setProfile(res.data) : setMissing(true)))
      .catch(() => setMissing(true));
    reloadMaterials().catch(() => setMissing(true));
  }, [profileId, reloadMaterials]);

  if (missing)
    return (
      <main>
        Профиль не найден. <Link to="/">К профилям</Link>
      </main>
    );
  if (!profile) return <main>Загрузка…</main>;

  const context: ProfileContext = {
    profile,
    materials,
    openUpload: () => setUploading(true),
    reload,
  };

  return (
    <div style={{ display: "flex", gap: "2rem" }}>
      <nav style={{ minWidth: "14rem" }}>
        <h1>{profile.name}</h1>
        <Link to="/">Сменить язык</Link>
        {team && (
          <p>
            <Link to="/team/flows">Схемы процессов</Link>
          </p>
        )}
        <p>
          <button type="button" onClick={context.openUpload}>
            Загрузить материал
          </button>
        </p>
        <h2>Материалы</h2>
        {materials.length === 0 ? (
          <p>Пока нет</p>
        ) : (
          <ul>
            {materials.map((m) => (
              <li key={m.id}>
                <NavLink to={`materials/${m.id}`}>{materialTitle(m)}</NavLink>
              </li>
            ))}
          </ul>
        )}
        <h2>Темы</h2>
        {topics.length === 0 ? (
          <p>Пока нет</p>
        ) : (
          <ul>
            {topics.map((t) => (
              <li key={t.id}>
                <NavLink to={`topics/${t.id}`}>{t.title}</NavLink>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <Outlet context={context} />
      {uploading && (
        <UploadDialog
          profileId={profile.id}
          onClose={() => setUploading(false)}
          onUploaded={(materialId) => {
            setUploading(false);
            void reloadMaterials();
            void navigate(`/profiles/${profile.id}/materials/${materialId}`);
          }}
        />
      )}
    </div>
  );
}
