import { useProfile } from "./ProfileLayout.tsx";

/** Empty Profile: a single «Загрузить материал» button. Otherwise a hint to pick a Material. */
export function ProfileHome() {
  const { materials, openUpload } = useProfile();

  if (materials.length > 0) return <main>Выберите материал слева.</main>;

  return (
    <main>
      <button type="button" onClick={openUpload}>
        Загрузить материал
      </button>
    </main>
  );
}
