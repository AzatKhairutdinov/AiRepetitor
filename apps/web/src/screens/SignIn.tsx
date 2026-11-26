import { type FormEvent, useState } from "react";
import { authClient } from "../auth.ts";

export function SignIn() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const result =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email });
    if (result.error) setError(result.error.message ?? "Не получилось войти");
  }

  return (
    <main>
      <h1>{mode === "signIn" ? "Вход" : "Регистрация"}</h1>
      <form onSubmit={submit}>
        <label>
          Почта{" "}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Пароль{" "}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <button type="submit">{mode === "signIn" ? "Войти" : "Зарегистрироваться"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
        {mode === "signIn" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
      </button>
    </main>
  );
}
