import {
  listLanguages,
  profilesCreateProfile,
  profilesListProfiles,
} from "@airepetitor/contract/client";
import type { Language, LanguageCode } from "../../../../libs/contract/src/client/api.schemas.ts";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

/** Creates a Profile for a language the Learner does not study yet. */
export function ChooseLanguage() {
  const navigate = useNavigate();
  const [languages, setLanguages] = useState<Language[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listLanguages(), profilesListProfiles()])
      .then(([langs, profiles]) => {
        const taken = new Set(
          profiles.status === 200 ? profiles.data.items.map((p) => p.language) : [],
        );
        setLanguages(langs.data.items.filter((l) => !taken.has(l.code)));
      })
      .catch(() => setError("Не удалось загрузить список языков. Обновите страницу."));
  }, []);

  async function choose(code: LanguageCode) {
    setError(null);
    const res = await profilesCreateProfile({ language: code });
    if (res.status === 201) void navigate(`/profiles/${res.data.id}`);
    else setError(res.data.message);
  }

  if (!languages) return <main>{error ?? "Загрузка…"}</main>;

  return (
    <main>
      <h1>Какой язык вы изучаете?</h1>
      <ul>
        {languages.map((l) => (
          <li key={l.code}>
            <button type="button" onClick={() => void choose(l.code)}>
              {l.name}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
