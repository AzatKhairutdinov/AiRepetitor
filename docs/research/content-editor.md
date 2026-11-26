# Исследование: редактор содержимого для Шаблонов, Простого русского, инструкций и Проверок

Дата: 2026-11-26. Пометка **(не проверено)** — первоисточник этого прямо не подтверждает. Пометка **(оценка)** — число посчитали мы.

Термины — из `GLOSSARY.md`: Команда, Репетитор, Методист, Артефакт, Конспект, Шаблон, Простой русский, Проверка, Отчёт о проверке. Экран «Мастерская шаблонов» описан в `docs/domain/model.md`.

Что нужно пользователю:

- **Файлы содержимого** управляют частями на LLM. Это Шаблоны (Markdown со структурой разделов Конспекта), правила Простого русского (Markdown), инструкции для чата Репетитора, для написания Конспектов и для Методиста (Markdown), а также Проверки кодом (YAML: обязательные разделы, длина предложения, запрещённые слова).
- Каждый Артефакт помнит точную версию каждого файла, по которой его сделали. Версии сравниваем на эталонных материалах.
- Сейчас план — файлы в репозитории (`content/`). Пользователь хочет, если это легко сделать сейчас, получить готовый редактор с UI. Содержимое при этом лежит вне репозитория, а править его может только роль Team из Better Auth.
- Стек: Hono API на Cloudflare Workers Free (10 ms CPU на запрос), D1 через Drizzle, R2, React + Vite, контракты TypeSpec-first, Better Auth (ADR 0001 и 0002).

## Коротко

- **Рекомендация: делаем сами, минимально.** Нужны таблица документов и неизменяемых версий в D1 с хешем содержимого и страница для Команды в нашем React-приложении. Редактор — CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-markdown` / `lang-yaml`), сравнение — `@codemirror/merge` ([merge][cm-merge]). Роль Team — admin-плагин Better Auth ([admin plugin][better-auth-admin]). Это около 3–5 дней (оценка), $0 и ни одного нового сервиса.
- **Готовые CMS решают не ту задачу.** Они дают UI и историю правок. Но связь «Артефакт → версия файла» и прогон на эталонных материалах всё равно пишем сами. Взамен получаем второй вход для пользователей, второе приложение и чужую модель данных.
- **Payload 3.x на Cloudflare реален, но тяжёл.** Это отдельный Worker на Next.js через OpenNext. В README шаблона прямо сказано, что 10 ms CPU на Free хватает не всегда ([шаблон][payload-cf]). Своих пользователей Payload держит в своей коллекции. Better Auth можно подключить только как отдельный экземпляр внутри Payload ([payload-auth][payload-auth]), а не наш. Версии по умолчанию хранятся не больше 100 на документ ([versions][payload-versions]).
- **EmDash (Cloudflare, 1.0 с сентября 2026) — CMS для сайтов на Astro** ([репозиторий][emdash]), а не встраиваемый редактор для React SPA. У него свои пользователи и вход по passkey ([auth][emdash-auth]).
- **SonicJS 3.0 ближе всех по стеку** (Hono, D1, R2, Better Auth, Drizzle; история версий бесплатно) ([репозиторий][sonic]). Но это целое приложение со своим admin на HTMX и TinyMCE и своим экземпляром Better Auth. Стабильный релиз вышел месяц назад ([v3.0.0][sonic-rel]).
- **Git-CMS (Sveltia, Decap, Keystatic, TinaCMS) дают версии бесплатно — это git.** Но содержимое остаётся в репозитории, а доступ даёт право записи в репозиторий, а не роль Team ([Sveltia backends][sveltia-backends], [Keystatic][keystatic-gh]).
- **Облачные headless CMS на Free почти не хранят историю.** Sanity — 3 дня ([pricing][sanity-pricing]), Storyblok — 1 день ([pricing][storyblok-pricing]), у Hygraph Hobby хранения версий нет ([pricing][hygraph-pricing]). Нам нужна вечная неизменяемая история, так что этот вариант отпадает.
- **Легко ли включить в первую фичу? Да.** Хранилище версий и ссылки Артефакта на версии надо заложить сразу, потом переделывать дорого. Редактор с диффом — ещё 1,5–2 дня (оценка). Если сроки жмут, первая фича может грузить `content/` в D1 при деплое, а страница редактора появится следующим шагом. Схема при этом не меняется.

## 1. Что требуется от решения

| Требование                        | Откуда                                                                      |
| --------------------------------- | --------------------------------------------------------------------------- |
| Неизменяемые версии               | Артефакт ссылается на версию; правка старой версии ломает воспроизводимость |
| Артефакт помнит версию            | `docs/domain/model.md`: у Конспекта «версия шаблона, версия стиля»          |
| Дифф двух версий                  | «Мастерская шаблонов»: сравнение двух версий Шаблона                        |
| Откат                             | Неудачная правка инструкции Методиста не должна жить до следующего деплоя   |
| Доступ только для Team            | `GLOSSARY.md`: Команда правит Шаблоны, Простой русский и Проверки           |
| Валидация YAML Проверок           | Сломанный YAML не должен попасть в рабочую версию                           |
| $0 и Workers Free                 | ADR 0001                                                                    |
| Типы из TypeSpec                  | `.claude/rules/typespec-first.md`                                           |
| Вход только через наш Better Auth | ADR 0002; второй вход для Команды — лишняя система                          |

Ни одна CMS не закрывает два пункта: «Артефакт помнит версию» и прогон на эталонных материалах. Это наша бизнес-логика в API и Workflow. CMS может дать только UI правки и историю.

## 2. Кандидаты

### 2.1. Payload CMS 3.x на Cloudflare

Текущая версия — `payload` 3.94.2 от 2026-11-24 ([npm][payload-npm]). Админка — пакет `@payloadcms/next`, он требует `next` 15.x или 16.4.5+ ([npm][payload-next-npm]). Без Next.js админки нет.

- **Деплой.** Официальный шаблон `with-cloudflare-d1` даёт D1, R2 для файлов и деплой через OpenNext ([шаблон][payload-cf], [блог Cloudflare][cf-payload-blog]). Адаптер D1 — `@payloadcms/db-d1-sqlite` ([npm][payload-d1-npm]).
- **Размер бандла больше не мешает Free.** С 2026-09-04 Cloudflare проверяет только несжатый размер, 64 MiB на всех планах. Прежний лимит в 3 MB на Free отменён ([changelog][cf-size]). Payload уже поправил устаревшую фразу о 3 MB в README ([issue 19882][payload-issue-size]).
- **CPU — главный риск.** README шаблона: «The Workers Free plan has a CPU time limit of 10 ms per HTTP request, which authentication and server-side rendering workloads can exceed» ([шаблон][payload-cf]). Админка Payload — это SSR на Next.js. На Free она, скорее всего, будет падать с ошибкой превышения CPU (не проверено на нашем объёме). Ещё есть лимит запуска Worker в 1 s ([Workers limits][cf-limits]). Сколько Payload тратит на холодный старт, мы не замеряли (не проверено).
- **Версии.** `versions` создаёт коллекцию `{slug}_versions` с полной копией документа. В админке есть просмотр версий и их сравнение. Откат — `POST /api/{slug}/versions/:id` или `payload.restoreVersion()`, версию по id читает `findVersionByID` ([versions][payload-versions]). Но `maxPerDoc` по умолчанию 100, старые версии удаляются. Для нас нужно `0`. Откат в Payload переписывает текущий документ, а не делает новую неизменяемую версию с хешем (не проверено).
- **Вход.** У Payload своя auth-коллекция пользователей. Есть custom strategies: функция получает заголовки и возвращает пользователя Payload или `null` ([strategies][payload-strategies]). Через неё можно проверять cookie нашего Better Auth, но пользователь всё равно должен быть документом в коллекции Payload. Плагин `payload-auth` встраивает Better Auth внутрь Payload, и тот хранит данные через Payload ([payload-auth][payload-auth]). У нас Better Auth уже живёт в Hono API на D1, так что это был бы второй экземпляр. Общая сессия двух Workers на разных путях возможна, но её придётся собирать руками (не проверено).
- **TypeSpec-first.** Payload сам генерирует REST, GraphQL и свои типы. Чтобы Hono API читал содержимое, нужен либо HTTP-вызов в Payload Worker, либо чтение его таблиц в D1 напрямую. Оба пути обходят TypeSpec. GraphQL на Workers поддерживается не полностью, ждут исправления в workerd ([шаблон][payload-cf]).

Итог: Payload даёт самую богатую админку с версиями и диффом. Цена — второй Worker на Next.js, CPU-риск на Free, второй вход для Команды и чужая схема в D1.

### 2.2. EmDash

CMS от Cloudflare, анонс — апрель 2026, версия 1.0 — сентябрь 2026 ([анонс][emdash-blog], [1.0][emdash-1]). Текущая `emdash` — 1.6.0 от 2026-11-22, лицензия MIT ([npm][emdash-npm]).

- Это интеграция для Astro: `peerDependencies` требуют `astro` ≥ 6 ([npm][emdash-npm]). Запросы к содержимому идут через Astro Live Collections ([README][emdash]). Наше веб-приложение — React + Vite, не Astro.
- Есть ревизии, черновики, админка и REST API. Тексты хранятся в Portable Text, редактор — TipTap ([README][emdash]). Для Markdown и YAML это неудобно: ни сырого Markdown, ни YAML-редактора из коробки (не проверено).
- Вход — passkey, OAuth (GitHub, Google, Microsoft) или Cloudflare Access. Есть свои роли: Administrator, Editor, Author, Contributor. Интерфейс провайдеров открыт сторонним пакетам ([auth][emdash-auth]). Готового моста к чужому Better Auth нет (не проверено).
- Free возможен: песочница плагинов требует Workers Paid, но шаблоны по умолчанию выключают её ([plugin sandbox][emdash-sandbox]).

Итог: хороший продукт для сайта или блога. Для служебных промптов внутри нашего React-приложения — не тот жанр.

### 2.3. SonicJS

`@sonicjs-cms/core` 3.0.1 от 2026-11-19, первый стабильный релиз 3.0.0 вышел 2026-10-26, лицензия MIT ([релизы][sonic-rel]).

- Стек почти наш: Hono, D1, R2, Drizzle, Better Auth в зависимостях ([npm][sonic-npm]). Версии с откатом бесплатны, есть `GET /admin/content/:id/versions` ([README][sonic]).
- Но это отдельное приложение со своей админкой на HTMX и редактором TinyMCE. Better Auth в нём — свой экземпляр со своими таблицами (не проверено, можно ли подключить наш). Несжатый пакет весит около 20 MB ([npm][sonic-npm]). Как он укладывается в 10 ms CPU, мы не проверяли (не проверено).
- Проекту месяц на стабильной ветке, держит его в основном один автор (не проверено).

Итог: самый близкий по стеку вариант. Но встраивание и общий вход не подтверждены, а поддержку ведёт один человек.

### 2.4. Git-CMS: Sveltia, Decap, Keystatic, TinaCMS

Все хранят содержимое как файлы в git. История, дифф и откат достаются даром: коммит и есть неизменяемая версия, SHA блоба — готовый хеш.

| CMS       | Версия и дата                             | Что нужно для работы                                                                                                                   | Кто может править                                                      |
| --------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Sveltia   | 0.273.1, 2026-11-25 ([npm][sveltia-npm])  | SPA с CDN, без сервера ([репозиторий][sveltia]); для OAuth GitHub нужен посредник, по умолчанию Netlify ([backends][sveltia-backends]) | у кого есть право записи в репозиторий ([backends][sveltia-backends])  |
| Decap     | 3.18.0, 2026-11-18 ([npm][decap-npm])     | SPA, OAuth-посредник для GitHub (не проверено)                                                                                         | право записи в репозиторий (не проверено)                              |
| Keystatic | 0.6.10, 2026-11-17 ([npm][keystatic-npm]) | GitHub App и API-маршруты на Node-совместимом хосте; интеграции для Next.js, Astro, Remix ([GitHub mode][keystatic-gh])                | «Collaborators will need `write` access» ([GitHub mode][keystatic-gh]) |
| TinaCMS   | 3.15.2, 2026-11-09 ([npm][tina-npm])      | Tina Cloud или свой бэкенд                                                                                                             | Free: 2 пользователя, 3 роли ([pricing][tina-pricing])                 |

Почему не подходит:

- Пользователь хочет держать содержимое вне репозитория. Здесь оно в репозитории по определению.
- Доступ равен праву записи в репозиторий. Члену Команды без GitHub-аккаунта и без доступа к коду путь закрыт. Роль Team из Better Auth тут ни при чём.
- Правка через CMS — это коммит. Он запускает CI и деплой, а по нашим правилам ещё и требует ветку и pull request. Для правки промпта это тяжело.
- Рабочему Worker нужно получать текущую версию. Значит, либо деплой после каждой правки, либо чтение из GitHub API в рантайме.

Плюс, который стоит записать: если однажды откажемся от редактора, `content/` в git с версией через SHA коммита — честный и бесплатный запасной вариант.

### 2.5. Облачные и самостоятельно размещаемые headless CMS

| CMS        | Бесплатно                                                                                                                 | История версий на бесплатном плане                                                | Вход через наш Better Auth |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------- |
| Sanity     | Free: 20 мест, 2 роли ([pricing][sanity-pricing])                                                                         | просмотр изменений черновиков — 3 дня ([pricing][sanity-pricing])                 | нет, свои аккаунты         |
| Contentful | Free: 10 пользователей, 2 роли ([pricing][contentful-pricing])                                                            | не указано на странице цен                                                        | нет, свои аккаунты         |
| Hygraph    | Hobby: 3 места ([pricing][hygraph-pricing])                                                                               | хранения версий нет ([pricing][hygraph-pricing])                                  | нет, свои аккаунты         |
| Storyblok  | Starter: 1 место, максимум 2 ([pricing][storyblok-pricing])                                                               | 1 день ([pricing][storyblok-pricing])                                             | нет, свои аккаунты         |
| Strapi     | Community — свой Node-сервер и БД; в Cloud бесплатного плана нет, от $35 ([pricing][strapi-pricing])                      | Content History — только Growth и Enterprise, 14–90 дней ([docs][strapi-history]) | нет (не проверено)         |
| Directus   | свой сервер; бесплатная лицензия при выручке до $5M и меньше 50 сотрудников; Cloud — от $89 ([pricing][directus-pricing]) | ревизии есть (не проверено по плану)                                              | нет (не проверено)         |
| PocketBase | бинарник на Go с SQLite, нужен свой сервер ([репозиторий][pocketbase])                                                    | истории версий из коробки нет (не проверено)                                      | нет                        |

Общая проблема: у всех свои аккаунты, а история на бесплатных планах — дни, а не годы. Strapi, Directus и PocketBase не работают в Workers, им нужна отдельная машина. Это противоречит ADR 0001 (минимум инфраструктуры).

### 2.6. Делаем сами

#### Данные в D1 (Drizzle)

- `content_document`: `id`, `kind` (`template` | `plain_russian` | `instruction` | `checks`), `slug`, `active_version_id`.
- `content_version`: `id`, `document_id`, `body`, `sha256`, `parent_version_id`, `author_user_id`, `note`, `created_at`. Строки только вставляются. Изменение запрещено в коде, а ещё можно добавить триггер SQLite `BEFORE UPDATE ... RAISE(ABORT)`. D1 поддерживает триггеры (не проверено). Пара `(document_id, sha256)` уникальна: повторное сохранение того же текста не создаёт новую версию.
- Артефакт помнит версии. Таблица связей `artifact_content_version (artifact_id, version_id)` или один `content_snapshot_id`. Снимок — неизменяемый набор id версий всех документов на момент запуска. Снимок удобнее: Workflow фиксирует его в начале Обработки, а прогон на эталонных материалах сравнивает два снимка. Термин «снимок» стоит обсудить для `GLOSSARY.md`.
- Откат — перенос `active_version_id` на старую версию с записью в журнал. Новая версия при этом не нужна, история остаётся линейной.
- Резерв: Time Travel в D1 хранит 7 дней на Free ([time travel][d1-tt]). Для долгого хранения есть еженедельная выгрузка в R2 или в `content/` через pull request. Это по желанию.
- `content/` в репозитории остаётся начальными данными и фикстурами для тестов. Скрипт `mise run content:seed` заливает их в локальную D1.

#### API (TypeSpec-first)

- Модели `ContentDocument`, `ContentVersion`, `ContentSnapshot` описываем в `specs/`. Маршруты, zod-валидаторы и клиент генерирует Orval, как для любого эндпоинта (скилл `new-endpoint`).
- Эндпоинты под `/api/team/content`: список документов, версии документа, одна версия, создать версию, сделать версию активной.
- YAML Проверок: схему файла Проверок тоже описываем моделью TypeSpec. Тогда сгенерированный zod проверяет разобранный YAML (пакет `yaml`, [npm][yaml-npm]) при сохранении. Невалидный файл не сохраняется. Это укладывается в правило TypeSpec-first: схема одна, рукописной нет.
- CPU: SHA-256 через `crypto.subtle.digest` на файле в десятки килобайт и одна-две вставки в D1 — доли миллисекунды CPU. Ожидание D1 в CPU не считается (оценка).

#### Роль Team (Better Auth)

- Admin-плагин Better Auth: `createAccessControl` с ресурсом `content: ["read", "write"]` и роли `user` и `team` через `ac.newRole`. Проверка на сервере — `auth.api.userHasPermission` ([admin plugin][better-auth-admin]). В Hono это одна middleware на `/api/team/*`.
- Первого члена Команды назначаем командой (`setRole` admin-плагина или SQL в D1). Дальше роль раздаёт сам Team.
- В React страница `/team/content` скрыта, если в сессии нет роли `team`. Защищает её всё равно API.
- Плагин добавляет поля в таблицу `user`, поэтому придётся пересобрать `auth-schema.ts` (`mise run db:auth-schema`) и миграции (ADR 0002).

#### UI

| Компонент                                | Версия                                               | Зачем                                                                                            |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@uiw/react-codemirror`                  | 4.25.13 ([npm][uiw-npm])                             | React-обёртка CodeMirror 6                                                                       |
| `@codemirror/lang-markdown`, `lang-yaml` | 6.5.2 и 6.1.3 ([npm][cm-md-npm], [npm][cm-yaml-npm]) | подсветка Markdown и YAML                                                                        |
| `@codemirror/merge`                      | 6.13.0 ([npm][cm-merge-npm])                         | дифф: бок о бок (`MergeView`) или единый (`unifiedMergeView`) ([merge][cm-merge], [ref][cm-ref]) |
| `react-codemirror-merge`                 | 4.25.13 ([npm][uiw-merge-npm])                       | React-обёртка для `MergeView`                                                                    |

Почему не WYSIWYG. MDXEditor 4.5.0 ([npm][mdx-npm]) и Milkdown Crepe 7.23.0 ([npm][milkdown-npm]) хороши для статей. Но при сохранении они пересобирают Markdown из своего дерева и могут менять разметку: маркеры списков, переносы, экранирование (не проверено для конкретных версий). Тогда хеш и дифф «шумят» без смысловой правки. Наши файлы — промпты, их точный текст важен. В MDXEditor есть режим исходника и диффа ([diff-source][mdx-diff]), но это CodeMirror внутри него же. Monaco (`@monaco-editor/react` 4.7.0, последний релиз в феврале 2025, [npm][monaco-npm]) тяжелее и для двух языков избыточен.

Экран: слева список документов по видам. В центре — редактор активной версии и поле «Что поменял». Справа — история версий. Кнопки: «Сохранить как новую версию», «Сделать активной» и «Сравнить с…», которая открывает `MergeView`.

#### Трудоёмкость (оценка)

| Часть                                                | Дни     |
| ---------------------------------------------------- | ------- |
| Таблицы Drizzle, миграция, seed из `content/`        | 0,5     |
| TypeSpec-модели, 5 эндпоинтов, обработчики, тесты    | 1       |
| Роль Team: admin-плагин, middleware, назначение роли | 0,5     |
| Страница: список, редактор, история, дифф            | 1,5     |
| Схема YAML Проверок и валидация при сохранении       | 0,5     |
| Снимок версий и его фиксация в начале Обработки      | 0,5–1   |
| **Итого**                                            | **4–5** |

Прогон на эталонных материалах со сравнением отчётов Методиста в эту оценку не входит. Это отдельная фича «Мастерской шаблонов», и ни одна CMS её не даёт.

## 3. Сравнение

| Критерий                        | Сами (D1 + CodeMirror)              | Payload 3.x                                          | EmDash                     | SonicJS 3                  | Git-CMS (Sveltia и др.)       | Облачные (Sanity и др.)    |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------- | -------------------------- | -------------------------- | ----------------------------- | -------------------------- |
| Содержимое вне репозитория      | да, D1                              | да, D1                                               | да, D1                     | да, D1                     | нет                           | да, у вендора              |
| Неизменяемые версии             | да, по построению                   | да, но лимит 100 по умолчанию и откат перезаписывает | ревизии (не проверено)     | да, с откатом              | да, коммиты                   | Free: дни или нет          |
| Артефакт помнит версию          | наша схема                          | хранить id версии Payload                            | хранить id ревизии         | хранить id версии          | SHA коммита                   | id версии, если не удалена |
| Дифф                            | `@codemirror/merge`                 | есть в админке                                       | (не проверено)             | (не проверено)             | git, дифф в UI (не проверено) | ограничен на Free          |
| Откат                           | перенос указателя                   | `restoreVersion`                                     | есть (не проверено)        | есть                       | revert                        | ограничен                  |
| Роль Team из нашего Better Auth | да, напрямую                        | через custom strategy и зеркальных пользователей     | нет, свои роли             | свой Better Auth           | нет, права в GitHub           | нет                        |
| TypeSpec-first                  | да                                  | нет, свой REST и GraphQL                             | нет                        | нет                        | не касается API               | нет                        |
| Workers Free, 10 ms             | да (оценка)                         | риск, SSR Next.js                                    | да, без песочницы плагинов | (не проверено)             | Worker не нужен               | Worker не нужен            |
| Стоимость                       | $0                                  | $0 при успехе на Free                                | $0                         | $0                         | $0                            | $0 с лимитами              |
| Новые системы                   | нет                                 | второй Worker и Next.js                              | Astro-приложение           | второе приложение          | OAuth-посредник               | внешний вендор             |
| Поддержка                       | наш код, около 1 000 строк (оценка) | обновления Payload и Next.js                         | обновления Astro и EmDash  | молодой проект, один автор | мало                          | зависимость от тарифов     |
| Готовый UI                      | собираем из компонентов             | полный                                               | полный                     | полный                     | полный                        | полный                     |

## 4. Рекомендация

1. **Делаем сами**, как в разделе 2.6. Главное — это не редактор, а неизменяемые версии и снимок, на который ссылается Артефакт. Это наша доменная логика, и чужая CMS её не заменит. Редактор поверх неё — несколько готовых компонентов CodeMirror.
2. **В первую фичу включаем:** таблицы `content_document`, `content_version` и снимок, seed из `content/`, фиксацию снимка в начале Обработки и запись в Конспект. Без этого «версия шаблона, версия стиля» в Конспекте неоткуда брать. Это около 1,5–2 дней (оценка).
3. **Страницу редактора** — сразу, если первая фича не горит (ещё около 2,5–3 дней, оценка). Если горит — следующим pull request. Схема не меняется, а до тех пор Команда правит `content/` и запускает seed.
4. **Не берём сейчас** черновики с публикацией, предпросмотр Markdown, совместное редактирование и прогоны на эталонных материалах. Прогоны — отдельная фича «Мастерской шаблонов».
5. **Записываем решение в ADR**: содержимое в D1, версии неизменяемые, редактор свой. Ещё стоит обсудить для `GLOSSARY.md` термин для снимка версий и общее имя для пяти видов файлов (сейчас «содержимое» — рабочее слово).

Когда пересмотреть: если Команда вырастет и ей понадобятся процессы согласования, роли по видам документов и комментарии к правкам. Тогда Payload на Workers Paid (от $5 в месяц, [pricing][cf-pricing]) станет разумным. Тот же пересмотр нужен, если SonicJS докажет встраивание с внешним Better Auth.

## 5. Риски

| Риск                                                | Что делаем                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Потеря содержимого в D1 (ошибка миграции, удаление) | Time Travel 7 дней на Free ([time travel][d1-tt]) и еженедельная выгрузка в R2        |
| Правка активной версии ломает Обработку в процессе  | Обработка фиксирует снимок в начале и читает только его                               |
| Сломанный YAML Проверок                             | валидация zod из TypeSpec при сохранении; невалидную версию не создаём                |
| Плохая инструкция Методиста попала в работу         | откат одной кнопкой; позже — обязательный прогон на эталонах перед «Сделать активной» |
| Член Команды без роли видит страницу                | защиту держит API middleware, UI только прячет                                        |
| Свой код редактора разрастается в CMS               | держим границу: только пять видов файлов, без своих типов полей и рабочих процессов   |
| Payload и EmDash быстро развиваются                 | пересматриваем раз в полгода; пункт «Когда пересмотреть» выше                         |

## Что не проверено

- Хватит ли админке Payload 10 ms CPU на Workers Free. Сколько длится её холодный старт.
- Делает ли откат в Payload новую версию или переписывает документ. Можно ли собрать общую сессию нашего Better Auth и Payload без зеркальных пользователей.
- Как в EmDash выглядят ревизии и дифф. Есть ли редактор сырого Markdown или YAML. Можно ли написать провайдер входа поверх чужого Better Auth.
- Можно ли подключить SonicJS к нашему экземпляру Better Auth. Какой у него CPU на Free. Сколько людей его поддерживает.
- Как в Decap устроены OAuth и права. Есть ли дифф версий в интерфейсе Sveltia и Decap.
- Есть ли история версий на Free у Contentful. Ревизии Directus по планам. История в PocketBase.
- Работают ли триггеры SQLite в D1 для запрета `UPDATE`.
- Меняют ли MDXEditor 4.5 и Milkdown 7.23 Markdown при сохранении без правок.
- Все трудоёмкости и оценки CPU — наши оценки, не замеры.

[better-auth-admin]: https://www.better-auth.com/docs/plugins/admin
[payload-cf]: https://github.com/payloadcms/payload/tree/main/templates/with-cloudflare-d1
[payload-versions]: https://payloadcms.com/docs/versions/overview
[payload-strategies]: https://payloadcms.com/docs/authentication/custom-strategies
[payload-auth]: https://github.com/payload-auth/payload-auth
[payload-npm]: https://registry.npmjs.org/payload
[payload-next-npm]: https://registry.npmjs.org/@payloadcms/next
[payload-d1-npm]: https://registry.npmjs.org/@payloadcms/db-d1-sqlite
[payload-issue-size]: https://github.com/payloadcms/payload/issues/19882
[cf-payload-blog]: https://blog.cloudflare.com/payload-cms-workers/
[cf-size]: https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
[cf-limits]: https://developers.cloudflare.com/workers/platform/limits/
[d1-tt]: https://developers.cloudflare.com/d1/reference/time-travel/
[emdash]: https://github.com/emdash-cms/emdash
[emdash-npm]: https://registry.npmjs.org/emdash
[emdash-blog]: https://blog.cloudflare.com/emdash-wordpress/
[emdash-1]: https://blog.cloudflare.com/emdash-cms-plugin-registry/
[emdash-auth]: https://github.com/emdash-cms/emdash/blob/main/docs/src/content/docs/guides/authentication.mdx
[emdash-sandbox]: https://github.com/emdash-cms/emdash/blob/main/docs/src/content/docs/deployment/plugin-sandbox.mdx
[sonic]: https://github.com/lane711/sonicjs
[sonic-rel]: https://github.com/lane711/sonicjs/releases
[sonic-npm]: https://registry.npmjs.org/@sonicjs-cms/core
[sveltia]: https://github.com/sveltia/sveltia-cms
[sveltia-backends]: https://sveltiacms.app/en/docs/backends
[sveltia-npm]: https://registry.npmjs.org/@sveltia/cms
[decap-npm]: https://registry.npmjs.org/decap-cms-app
[keystatic-gh]: https://keystatic.com/docs/github-mode
[keystatic-npm]: https://registry.npmjs.org/@keystatic/core
[tina-npm]: https://registry.npmjs.org/tinacms
[tina-pricing]: https://tina.io/pricing
[sanity-pricing]: https://www.sanity.io/pricing
[contentful-pricing]: https://www.contentful.com/pricing/
[hygraph-pricing]: https://hygraph.com/pricing
[storyblok-pricing]: https://www.storyblok.com/pricing
[strapi-pricing]: https://strapi.io/pricing-cloud
[strapi-history]: https://docs.strapi.io/cms/features/content-history
[directus-pricing]: https://directus.com/pricing
[pocketbase]: https://github.com/pocketbase/pocketbase
[yaml-npm]: https://registry.npmjs.org/yaml
[uiw-npm]: https://registry.npmjs.org/@uiw/react-codemirror
[uiw-merge-npm]: https://registry.npmjs.org/react-codemirror-merge
[cm-md-npm]: https://registry.npmjs.org/@codemirror/lang-markdown
[cm-yaml-npm]: https://registry.npmjs.org/@codemirror/lang-yaml
[cm-merge-npm]: https://registry.npmjs.org/@codemirror/merge
[cm-merge]: https://github.com/codemirror/merge
[cm-ref]: https://codemirror.net/docs/ref/#merge
[mdx-npm]: https://registry.npmjs.org/@mdxeditor/editor
[mdx-diff]: https://mdxeditor.dev/editor/docs/diff-source
[milkdown-npm]: https://registry.npmjs.org/@milkdown/crepe
[monaco-npm]: https://registry.npmjs.org/@monaco-editor/react
[cf-pricing]: https://developers.cloudflare.com/workers/platform/pricing/
