import { Route, Routes } from "react-router";
import { authClient } from "./auth.ts";
import { ChooseLanguage } from "./screens/ChooseLanguage.tsx";
import { ChooseProfile } from "./screens/ChooseProfile.tsx";
import { ProfileHome } from "./screens/ProfileHome.tsx";
import { SignIn } from "./screens/SignIn.tsx";

export function App() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <main>Загрузка…</main>;
  if (!session) return <SignIn />;

  return (
    <Routes>
      <Route path="/" element={<ChooseProfile />} />
      <Route path="/languages" element={<ChooseLanguage />} />
      <Route path="/profiles/:profileId" element={<ProfileHome />} />
    </Routes>
  );
}
