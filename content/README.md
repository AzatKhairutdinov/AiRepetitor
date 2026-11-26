# Методичка

Методичка — файлы, по которым работают Репетитор и Методист (ADR 0005). Меняются через pull request.

- `templates/digest.md` — Шаблон Конспекта.
- `plain-russian.md` — правила Простого русского.
- `tutor/topics.md` — инструкция Репетитора «деление на Темы».
- `tutor/digest.md` — инструкция Репетитора «Конспект».
- `tutor/revise.md` — инструкция Репетитора «правка Конспекта».
- `methodologist/digest.md`, `methodologist/topics.md` — инструкции Методиста.
- `checks.yaml` — Проверки кодом; схема — модель `CodeChecks` в `specs/main.tsp`.
- Глоссарий — `GLOSSARY.md` в корне репозитория, входит в Методичку как есть.

Редакция методички — sha256 от отсортированных путей и содержимого всех этих файлов. `mise run generate` встраивает Методичку и Редакцию в API (`apps/api/src/playbook.generated.ts`), `mise run check` проверяет, что встроенная копия свежая.
