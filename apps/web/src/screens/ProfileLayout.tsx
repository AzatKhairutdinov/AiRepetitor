import { profileMaterialsListMaterials, profilesGetProfile } from "@airepetitor/contract/client";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router";
import type { MaterialSummary, Profile } from "../../../../libs/contract/src/client/api.schemas.ts";
import { materialTitle } from "../labels.ts";
import { UploadDialog } from "./UploadDialog.tsx";

interface ProfileContext {
  profile: Profile;
  materials: MaterialSummary[];
  openUpload: () => void;
}

export const useProfile = () => useOutletContext<ProfileContext>();

/** Profile menu on the left (Материалы), the screen in the middle. */
export function ProfileLayout() {
  const { profileId = "" } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [materials, setMaterials] = useState<MaterialSummary[]>([]);
  const [missing, setMissing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const reloadMaterials = useCallback(async () => {
    const res = await profileMaterialsListMaterials(profileId);
    if (res.status === 200) setMaterials(res.data.items);
  }, [profileId]);

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

  const context: ProfileContext = { profile, materials, openUpload: () => setUploading(true) };

  return (
    <div style={{ display: "flex", gap: "2rem" }}>
      <nav style={{ minWidth: "14rem" }}>
        <h1>{profile.name}</h1>
        <Link to="/">Сменить язык</Link>
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
