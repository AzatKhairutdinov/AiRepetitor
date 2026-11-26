# Исследование: движок процессов и конечные автоматы для Обработки

Дата: 2026-11-26. Продолжает `docs/research/model-selection.md` (раздел 2.1 «Как ноутбук получает задания»); что там уже решено (свой API `claim`/`complete` с арендой в D1, `waitForEvent` в Workflow), здесь не повторяем. Пометка **(не проверено)** — первоисточник этого прямо не подтверждает. Пометка **(оценка)** — число посчитали мы.

Термины — из `GLOSSARY.md`: Материал, Исходник, Текст исходника, Тема, Конспект, Профиль, Репетитор, Методист, Проверка, Отчёт о проверке, Круг правки, Обработка.

Задача пользователя:

- сразу взять готовый компонент workflow или конечного автомата и построить на нём всю бизнес-логику Обработки;
- в интерфейсе — страница со схемами по каждому сценарию: какой шаг кто выполняет (Репетитор, Методист, обработчик, проверки кодом) и от чего зависит переход;
- схема строится из того же определения, которое исполняется (один источник правды);
- запасные ветки простые: нет тем — «без тем», не прочитался ни один Исходник — ошибка Материала, без лишней логики.

## Коротко

- **Рекомендация: XState v5 как модель, Cloudflare Workflows как исполнитель.** Автомат XState описывает состояния, переходы, условия и «кто делает шаг» (`meta`). Workflow хранит прогресс, повторяет упавшие шаги и ждёт обработчик через `waitForEvent`. Переход считает чистая функция `transition()` из XState ([pure transitions][xs-pure]), побочные эффекты исполняет `step.do()` ([rules of Workflows][wf-rules]).
- **Схемы в UI — из того же автомата.** `@statelyai/graph` превращает машину XState в граф и умеет выгружать его в Mermaid, React Flow (`xyflow`) и раскладку ELK ([@statelyai/graph][sg-npm]). Рисуем через `@xyflow/react` + `elkjs`. Подсветка текущего состояния конкретного Материала реальна: снимок автомата лежит в D1.
- **Сам по себе Cloudflare Workflows схему не даёт в наш UI.** В дашборде есть визуализатор Workflows (бета, с 2026-02), он строит схему из кода, но API для выгрузки схемы нет ([visualizer][wf-vis]).
- **Внешние движки не подходят к стеку.** Temporal, Hatchet, DBOS, Trigger.dev требуют свой долгоживущий процесс, Postgres или чужие машины. Restate и Inngest работают с Workers, но добавляют второго провайдера, а их серверы под лицензиями BSL и SSPL. Upstash Workflow на Free — 1 000 шагов в день.
- **XState v6 уже в бете** (6.0.0-beta.5 от 2026-11-23), в нём меняется API восстановления снимка (`restoreActor` вместо `createActor(..., { snapshot })`) ([release][xs-v6b0]). Берём v5 и прячем восстановление за одной функцией.
- **Тесты автомата** — `getShortestPaths` и `getSimplePaths` из `xstate/graph` в Vitest; это ложится в `mise run check` ([graph docs][xs-graph]).

## 1. Что нужно от движка

Сценарии из `docs/domain/model.md`:

1. Материал загружен → по каждому Исходнику извлечение текста (обработчик на Rust; итог `ok` или `error`). Ни одного `ok` — ошибка Материала.
2. Деление на Темы (Репетитор). Тем нет — Материал «без тем», конец.
3. По каждой Теме: новая или уже есть в Профиле → черновик Конспекта или новая версия.
4. Проверки кодом. Провал — Репетитор правит сразу, Методист не вызывается.
5. Методист → Круги правки (N, по умолчанию 1) → показ Ученику, даже если ошибки остались.
6. Сбой Репетитора или Методиста без текста → ошибка Материала и кнопка «Повторить». Повтор не грузит файлы заново.
7. Материалы одного Профиля — строго по очереди, разных Профилей — параллельно.

Требования к компоненту:

| Требование                         | Почему                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| Работает на Workers Free           | 10 ms CPU на запрос и на шаг Workflow ([Workflows limits][wf-limits]) |
| Переживает часы и дни ожидания     | ноутбук-обработчик может быть выключен на выходные                    |
| Повторы и «Повторить» без потерь   | LLM-провайдер отвечает ошибкой, Ученик жмёт «Повторить»               |
| Схема из исполняемого определения  | страница схем в UI, без ручной синхронизации                          |
| Состояние читается из D1           | Карточка материала и подсветка текущего шага                          |
| Без второго провайдера и без денег | ADR 0001: бесплатные тарифы, минимум инфраструктуры                   |
| Тестируется в `mise run check`     | правило `.claude/rules/quality-gates.md`                              |

## 2. Кандидаты

### 2.1 Сводная таблица

| Кандидат                             | Подходит к Workers Free                                                                                                                                                     | Долговечность (durability)                                                                                                                          | Схема из определения                                                                       | Стоимость                                                                                                          | Лицензия                                                              | Зрелость, последний релиз                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **XState v5**                        | да, это библиотека; чистая `transition()` без актора ([pure transitions][xs-pure])                                                                                          | сама не хранит; снимок `getPersistedSnapshot()` сериализуется в JSON и кладётся куда угодно, в том числе в D1 ([persistence][xs-persist])           | да: `xstate/graph`, `@statelyai/graph` → Mermaid, xyflow, ELK ([@statelyai/graph][sg-npm]) | $0                                                                                                                 | MIT ([npm][xs-npm])                                                   | 5.33.4 от 2026-11-07; v6 в бете ([npm][xs-npm], [releases][xs-releases]); ~30 тыс. звёзд  |
| **Cloudflare Workflows**             | да, родной; Free: 10 ms CPU на шаг, 1 024 шага на экземпляр, 100 одновременных экземпляров, хранение 3 дня, 3 000 шагов в день ([limits][wf-limits], [billing][wf-billing]) | да: результат `step.do()` сохраняется, повторы, `waitForEvent` до 365 дней, `restart()` с нужного шага ([events][wf-events], [Workers API][wf-api]) | только в дашборде Cloudflare, бета, без выгрузки ([visualizer][wf-vis])                    | Free: 3 000 шагов в день; Paid: 500 тыс. в месяц, потом $0.80 за 100 тыс. ([billing][wf-billing])                  | проприетарный сервис                                                  | GA; в 2026 — rollbacks, `.subscribe()`, лимиты конкурентности ([changelog][wf-changelog]) |
| **XState + Workflows** (рекомендуем) | да                                                                                                                                                                          | от Workflows                                                                                                                                        | от XState                                                                                  | как у Workflows                                                                                                    | MIT + сервис                                                          | —                                                                                         |
| Restate                              | SDK есть для Workers (`@restatedev/restate-sdk-cloudflare-workers`, нужен `nodejs_compat`) ([Restate on Workers][restate-cf]); сервер — Restate Cloud или свой              | да, журнал на сервере Restate                                                                                                                       | нет в наш UI; у Restate свой UI                                                            | Cloud Free: 100 тыс. действий в месяц ([pricing][restate-pricing])                                                 | SDK MIT ([npm][restate-npm]); сервер BSL 1.1 ([LICENSE][restate-lic]) | SDK 1.18.4 от 2026-11-17                                                                  |
| Inngest                              | да, `inngest/cloudflare`, нужен `nodejs_compat` ([serve][inngest-serve])                                                                                                    | да, на стороне Inngest                                                                                                                              | нет в наш UI; трассы в их дашборде                                                         | Hobby: 50 тыс. исполнений в месяц, 5 одновременных шагов, история 24 часа; Pro от $99 ([pricing][inngest-pricing]) | SDK Apache-2.0; сервер SSPL ([LICENSE][inngest-lic])                  | SDK 4.27.0 от 2026-11-23                                                                  |
| Upstash Workflow                     | да, `@upstash/workflow/cloudflare`, QStash зовёт наш endpoint ([quickstart][upstash-cf])                                                                                    | да, на стороне QStash                                                                                                                               | нет                                                                                        | Free: 1 000 шагов в день, сон до 7 дней; $1 за 100 тыс. шагов ([pricing][upstash-pricing])                         | SDK MIT                                                               | 1.5.1 от 2026-11-12                                                                       |
| Temporal                             | нет: Worker TS SDK зависит от Node-API ([sdk README][temporal-readme])                                                                                                      | да                                                                                                                                                  | нет                                                                                        | свой сервер или Temporal Cloud                                                                                     | MIT                                                                   | 1.27.0 от 2026-11-25                                                                      |
| Trigger.dev                          | нет: задачи идут на их машинах ([pricing][trigger-pricing])                                                                                                                 | да                                                                                                                                                  | нет                                                                                        | Free: $5 кредитов в месяц                                                                                          | Apache-2.0                                                            | 4.8.10 от 2026-11-23                                                                      |
| Hatchet                              | нет: worker — долгоживущий процесс ([workers][hatchet-workers])                                                                                                             | да, Postgres                                                                                                                                        | нет                                                                                        | облако или свой сервер                                                                                             | MIT                                                                   | 1.49.0 от 2026-11-24                                                                      |
| DBOS                                 | нет подтверждения; нужен Postgres (на Workers — через Hyperdrive) ([Hyperdrive][hyperdrive]) **(не проверено)**                                                             | да, Postgres                                                                                                                                        | нет                                                                                        | свой Postgres                                                                                                      | MIT                                                                   | 5.7.0 от 2026-11-24                                                                       |
| Mastra workflows                     | да, `CloudflareDeployer`, хранилище D1 ([deployer][mastra-cf], [D1 storage][mastra-d1])                                                                                     | частично: снимки в хранилище; наблюдаемость на D1 не работает ([deployer][mastra-cf])                                                               | граф в Mastra Studio; на Workers **(не проверено)**                                        | $0                                                                                                                 | Apache-2.0 и Enterprise-часть (NOASSERTION на GitHub)                 | 1.86.0 от 2026-11-25; тянет весь агентный фреймворк                                       |
| Vercel Workflow SDK (`workflow`)     | нет готового «мира» для Cloudflare; есть Local, Postgres, Vercel ([worlds][vwf-worlds]) **(не проверено для 5.8)**                                                          | да                                                                                                                                                  | нет                                                                                        | —                                                                                                                  | Apache-2.0                                                            | 5.8.0 от 2026-11-24                                                                       |

Версии и даты релизов — из реестра npm на 2026-11-26 ([xstate][xs-npm], [@xstate/graph][xg-npm], [@statelyai/graph][sg-npm], [restate][restate-npm], [inngest][inngest-npm], [temporal][temporal-npm], [trigger][trigger-npm], [hatchet][hatchet-npm], [dbos][dbos-npm], [mastra][mastra-npm], [upstash][upstash-npm], [workflow][vwf-npm]).

### 2.2 XState v5

- **Что это.** Библиотека автоматов и statecharts: вложенные и параллельные состояния, условия (`guard`), `always`-переходы, финальные состояния, `meta` и `description` у состояний. MIT, 5.33.4 вышла 2026-11-07 ([npm][xs-npm]).
- **Хранение в D1 и восстановление на каждый запрос.** Снимок берётся `actor.getPersistedSnapshot()`, это JSON; восстановление — `createActor(machine, { snapshot }).start()`. Действия при восстановлении не повторяются, а вызванные акторы (`invoke`) перезапускаются ([persistence][xs-persist]). Для сервера удобнее чистые функции: `initialTransition(machine)` и `transition(machine, snapshot, event)` возвращают `[следующий снимок, действия]` и ничего не исполняют ([pure transitions][xs-pure]). Значит, в автомат не кладём `invoke` с промисами: автомат только решает, а делает исполнитель.
- **Выгрузка схемы.** `xstate/graph` теперь входит в пакет `xstate` (в `exports` есть `./graph`; отдельный `@xstate/graph` последний раз выходил 2025-05-31) ([npm][xs-npm], [@xstate/graph][xg-npm]). `@statelyai/graph` 2.6.0 (2026-10-12, MIT) даёт `createGraphFromMachine()` в подпути `@statelyai/graph/xstate`, выгрузку `toMermaidState`, `toMermaidFlowchart`, `toXYFlow` и раскладку `getElkLayout` ([npm][sg-npm]). Узел этого графа — снимок (значение состояния плюс контекст); чтобы получить схему по состояниям, а не по всем контекстам, передаём `serializeState: (s) => JSON.stringify(s.value)` (опция есть в типах пакета).
- **Stately Studio и инспектор.** Studio Free — редактор и экспорт в JS/TS, проекты публичные; Pro $39 в месяц ([pricing][stately-pricing]). Нам Studio не нужен: схему рисуем сами. `@statelyai/inspect` 0.7.2 (MIT) — для отладки в разработке ([npm][inspect-npm]).
- **Риск v6.** Идёт бета v6: `restoreActor` из `xstate/persist` вместо `createActor(..., { snapshot })`, переименованы служебные поля снимка (`_nextActorIds` → `nextActorIds`), переход между параллельными регионами теперь выходит из общего родителя ([6.0.0-beta.0][xs-v6b0], [releases][xs-releases]). Снимки, сохранённые под v5, при переходе на v6 надо будет мигрировать.

### 2.3 Cloudflare Workflows

- **Долговечность.** Результат каждого `step.do()` сохраняется; код вне шагов при перезапуске выполняется снова, поэтому он должен быть детерминированным, а имена шагов — постоянными ([rules][wf-rules]). У шагов настраиваются повторы, с 2026-07 задержку можно считать функцией ([changelog][wf-changelog]).
- **Ожидание обработчика.** `step.waitForEvent(type, { timeout })`: по умолчанию 24 часа, максимум 365 дней. Событие, присланное раньше, буферизуется. В `type` только буквы, цифры, `-` и `_`, точка даёт ошибку ([events][wf-events]).
- **«Повторить».** `instance.restart({ from: { name } })` перезапускает экземпляр с указанного шага; результаты шагов до него берутся из кэша ([Workers API][wf-api]). Это ровно «повтор без новой загрузки файлов».
- **Идентификатор экземпляра.** Можно задать свой `id` (до 100 символов), он уникален, пока старый экземпляр не вышел за срок хранения ([Workers API][wf-api]). Берём `id = material-<id>`.
- **Статус.** `instance.status()` → `queued`, `running`, `waiting`, `errored`, `complete` и др. С 2026-09-15 есть `.subscribe()` — поток событий экземпляра (попытки шагов, ожидания, откаты) ([changelog][wf-changelog], [Workers API][wf-api]).
- **Лимиты Free** ([limits][wf-limits], [billing][wf-billing]): 10 ms CPU на шаг, 1 024 шага на экземпляр, 100 одновременных экземпляров на аккаунт, хранение завершённых экземпляров 3 дня, результат шага до 1 MiB, 50 подзапросов, 3 000 шагов в день на аккаунт.
- **Конкурентность.** С 2026-11-10 можно ограничить число одновременных экземпляров одного Workflow, лишние ставятся в очередь ([concurrency][wf-concurrency]). Ограничение на весь Workflow, а не на Профиль, поэтому очередь Профиля всё равно делаем сами (раздел 3.4).
- **Визуализатор.** С 2026-02 дашборд рисует схему Workflow, разбирая код (AST): шаги, циклы, ветки, `Promise.all`. Бета, только дашборд, про выгрузку и про статус конкретного экземпляра страница молчит ([visualizer][wf-vis], [blog][wf-vis-blog]). Для страницы в нашем UI не подходит.

### 2.4 Почему не внешний движок

- **Restate** работает на Workers как набор HTTP-обработчиков, но журнал хранит сервер Restate: Restate Cloud (Free — 100 тыс. действий в месяц) или свой сервер под BSL 1.1 ([Restate on Workers][restate-cf], [pricing][restate-pricing], [LICENSE][restate-lic]). Это второй провайдер, а схемы в наш UI он не даёт.
- **Inngest** подключается к Workers через `inngest/cloudflare` ([serve][inngest-serve]). Free — 50 тыс. исполнений в месяц, каждый шаг считается отдельно, 5 одновременных шагов, история 24 часа ([pricing][inngest-pricing]). Сервер под SSPL ([LICENSE][inngest-lic]).
- **Upstash Workflow** работает на Workers, но Free — 1 000 шагов в день и сон до 7 дней ([pricing][upstash-pricing]); ноутбук, выключенный дольше недели, не дождёмся.
- **Temporal, Hatchet, Trigger.dev, DBOS** требуют своего долгоживущего процесса, Postgres или чужих машин ([Temporal SDK][temporal-readme], [Hatchet][hatchet-workers], [Trigger.dev][trigger-pricing]). Это противоречит ADR 0001.
- **Mastra** даёт граф workflow в своей Studio, но это агентный фреймворк целиком, а на D1 у него не работает наблюдаемость ([deployer][mastra-cf]).
- **Автоматы на стороне Rust** (например, крейт `statig`) не нужны: обработчик — исполнитель без состояния, он берёт задание и отчитывается. Всё состояние Обработки живёт в API.

## 3. Рекомендуемая архитектура

### 3.1 Кто чем владеет

| Часть                               | Что делает                                                                                                    | Где хранит                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `libs/flows` (новая библиотека, TS) | автоматы XState по сценариям; только состояния, переходы, условия, `meta`; без промисов и без I/O             | код в репозитории                                     |
| Workflow `MaterialProcessing`       | цикл «снимок + событие → `transition()` → исполнить действия в `step.do()` → следующее событие»               | журнал шагов Workflows                                |
| D1                                  | снимок автомата, версия автомата, журнал переходов (кто, когда, из какого состояния в какое), очередь Профиля | таблицы `material_flow`, `material_flow_event`, `job` |
| Rust-обработчик                     | `claim` → работа → `complete`/`fail`, как в `model-selection.md`                                              | Текст исходника в R2                                  |
| API (Hono)                          | на `complete` пишет D1 и шлёт `instance.sendEvent()`; отдаёт статус для UI                                    | —                                                     |
| Web (React)                         | страница «Схемы»: граф из `libs/flows`; Карточка материала: подсветка текущего состояния                      | —                                                     |

Один источник правды — автомат в `libs/flows`. Workflow не содержит бизнес-веток: он только исполняет действия, которые вернул автомат.

### 3.2 Автоматы по сценариям

Предлагаемый набор (каждый — отдельная схема на странице):

1. `materialProcessing` — верхний уровень: `queued → extracting → splittingTopics → digests → done`, плюс `failed` и `noTopics`.
2. `sourceExtraction` — один Исходник: `pending → claimed → extracted | failed`.
3. `topicDigest` — одна Тема: `classify (новая или есть) → draft | newVersion → codeChecks → methodologist → revision × N → shown`.

У каждого состояния `meta`: кто выполняет (`tutor`, `methodologist`, `worker`, `code`, `system`), русская подпись, от чего зависит переход. Запасные ветки — простые состояния с условием, без своей логики:

```ts
// libs/flows/src/material.ts (набросок)
import { assign, setup } from "xstate";

export const materialProcessing = setup({
  types: {} as {
    context: { okSources: number; failedSources: number; pendingSources: number; topics: number };
    events:
      | { type: "SOURCE_DONE"; ok: boolean }
      | { type: "TOPICS_SPLIT"; count: number }
      | { type: "DIGESTS_DONE" }
      | { type: "FAILED"; reason: string }
      | { type: "RETRY" };
  },
  // Действия — только имена; исполняет их Workflow (раздел 3.3).
  actions: {
    enqueueSourceJobs: () => {},
    callTutorSplit: () => {},
    startTopicDigests: () => {},
    countSource: assign(({ context, event }) =>
      event.type === "SOURCE_DONE"
        ? {
            pendingSources: context.pendingSources - 1,
            okSources: context.okSources + (event.ok ? 1 : 0),
            failedSources: context.failedSources + (event.ok ? 0 : 1),
          }
        : {},
    ),
  },
  guards: {
    allSourcesFailed: ({ context }) => context.pendingSources === 0 && context.okSources === 0,
    sourcesFinished: ({ context }) => context.pendingSources === 0,
    noTopics: ({ event }) => event.type === "TOPICS_SPLIT" && event.count === 0,
  },
}).createMachine({
  id: "materialProcessing",
  initial: "extracting",
  states: {
    extracting: {
      meta: { owner: "worker", title: "Извлечение текста из Исходников" },
      entry: "enqueueSourceJobs",
      on: { SOURCE_DONE: { actions: "countSource" } },
      always: [
        { guard: "allSourcesFailed", target: "failed" },
        { guard: "sourcesFinished", target: "splittingTopics" },
      ],
    },
    splittingTopics: {
      meta: { owner: "tutor", title: "Деление на Темы" },
      entry: "callTutorSplit",
      on: {
        TOPICS_SPLIT: [{ guard: "noTopics", target: "noTopics" }, { target: "digests" }],
        FAILED: "failed",
      },
    },
    digests: {
      meta: { owner: "system", title: "Конспекты по Темам" },
      entry: "startTopicDigests",
      on: { DIGESTS_DONE: "done", FAILED: "failed" },
    },
    noTopics: { type: "final", meta: { owner: "system", title: "Без тем" } },
    failed: {
      meta: { owner: "system", title: "Ошибка, кнопка «Повторить»" },
      on: { RETRY: "extracting" },
    },
    done: { type: "final", meta: { owner: "system", title: "Показано Ученику" } },
  },
});
```

Код выше — набросок для обсуждения, мы его не запускали **(не проверено)**.

### 3.3 Как исполняет Workflow

Цикл внутри `run(event, step)`:

1. `step.do("init")` — `initialTransition(machine, input)`; снимок и событие пишутся в D1.
2. Для каждого действия из ответа `transition()` — свой `step.do("<номер>-<действие>")`: поставить задания в `job`, вызвать Репетитора или Методиста, прогнать проверки кодом. Шаг возвращает событие для автомата, например `{ type: "TOPICS_SPLIT", count: 3 }`. Большие тексты — в R2, из шага возвращается только ключ (лимит 1 MiB).
3. Для действий обработчика — `step.waitForEvent("source-<id>", { timeout: "7 days" })`. API на `complete` зовёт `instance.sendEvent({ type: "source-<id>", payload })` ([events][wf-events]).
4. `transition(machine, snapshot, event)` — вне шага: функция чистая и детерминированная, при повторе даёт тот же результат ([rules][wf-rules]).
5. `step.do("<номер>-persist")` — новый снимок и запись в `material_flow_event` (кто сделал шаг — из `meta.owner`).
6. Финальное состояние — выход из цикла; последний шаг запускает следующий Материал Профиля (3.4).

«Повторить»: API шлёт событие `RETRY` в экземпляр, если он ждёт в `failed`, или вызывает `restart({ from: { name } })`, если экземпляр упал ([Workers API][wf-api]). Файлы заново не грузятся: задания `job` по Исходникам уже есть.

Темы обрабатываются по очереди внутри одного экземпляра, чтобы не плодить экземпляры (на Free их 100 одновременно на аккаунт). Если понадобится параллельность, `topicDigest` выносится в дочерний Workflow.

Бюджет шагов на Материал (оценка): 5 Исходников × 2 шага, деление 2, 4 Темы × ~10 шагов (классификация, черновик, проверки кодом, Методист, 1 Круг правки, сохранение) — около 55 шагов. Free даёт 3 000 шагов в день, то есть ~50 Материалов в день на аккаунт. Лимит 1 024 шага на экземпляр хватает с запасом.

### 3.4 Очередь Профиля

Workflows ограничивает конкурентность только на весь Workflow ([concurrency][wf-concurrency]). Строгую очередь внутри Профиля держим в D1:

- при загрузке Материал получает статус `queued`;
- API условным `UPDATE profile SET active_material_id = ? WHERE id = ? AND active_material_id IS NULL` захватывает Профиль; удалось — создаёт экземпляр Workflow;
- последний шаг Workflow освобождает Профиль и тем же приёмом запускает следующий `queued` Материал.

Запасной вариант — Durable Object на Профиль: на Free доступны SQLite-backed DO, 100 тыс. запросов в день ([DO pricing][do-pricing]). Пока не нужен.

### 3.5 Схемы в UI и подсветка статуса

- **Статическая схема.** `libs/flows` импортируется и API, и web. На сборке (или прямо в браузере) `createGraphFromMachine(machine, { serializeState: (s) => JSON.stringify(s.value) })` → `toXYFlow()` → `getElkLayout()` из `@statelyai/graph` ([npm][sg-npm]). Рисует `@xyflow/react` 13.0.3 (MIT) ([npm][xyflow-npm]). Цвет узла — по `meta.owner`, подпись — `meta.title`, на ребре — событие и условие (адаптер кладёт текст `guard` в данные ребра).
- **Запасной путь без раскладки.** `toMermaidState()` → `mermaid` 12.3.0 (MIT) ([npm][mermaid-npm]). Тот же Mermaid можно генерировать в `docs/domain/`, а в `mise run check` сверять, что файл свежий.
- **Своя обходка вместо адаптера.** Если адаптер `@statelyai/graph` поведёт себя плохо на параллельных состояниях или `always`, статическую схему можно строить прямым обходом `machine.root.states` и их переходов: это десятки строк **(оценка)**.
- **Живой статус.** Новый эндпоинт в TypeSpec, например `GET /materials/{id}/flow` → `{ machine, version, activeStates, events: [{ from, to, owner, at }] }`. Данные — из D1, не из API Workflows. UI подсвечивает активные узлы и пройденные рёбра. Обновление — опрос раз в несколько секунд; `.subscribe()` Workflows можно подключить позже ([changelog][wf-changelog]).
- **Лицензия `elkjs`.** EPL-2.0 или GPL-3.0 ([npm][elk-npm]). EPL-2.0 — слабый копилефт на файлы самой библиотеки; для бандла без изменений `elkjs` обычно достаточно сохранить уведомление **(не проверено юридически)**.

### 3.6 Тесты в `mise run check`

Vitest в `libs/flows` ([graph docs][xs-graph]):

- `getShortestPaths(machine)`: каждое состояние достижимо; финальные `done`, `noTopics`, `failed` достижимы.
- Явные пути-сценарии: «все Исходники упали» → `failed`; «0 Тем» → `noTopics`; «N = 1 Круг правки, ошибки остались» → `shown`.
- `getSimplePaths(machine)` на `topicDigest` с N = 2: из любого состояния есть путь к финалу (нет тупиков).
- Проверка-«линт»: у каждого состояния есть `meta.owner` и `meta.title`.
- Снапшот-тест сгенерированного Mermaid или JSON-графа: правка автомата видна в диффе PR.

`createTestModel` из `xstate/graph` даёт тесты по модели, где каждому событию сопоставлен вызов реального исполнителя ([graph docs][xs-graph]). Его стоит применить к циклу Workflow с поддельными Репетитором, Методистом и обработчиком.

## 4. Риски

| Риск                                              | Что делаем                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Два слоя (XState и Workflows) — сложнее, чем один | автомат без I/O, Workflow — универсальный цикл без бизнес-веток; один файл исполнителя                                                                        |
| Переход на XState v6                              | восстановление снимка спрятать в одну функцию; хранить `machineVersion` в D1                                                                                  |
| Новая версия автомата при уже идущих Материалах   | в снимке хранить версию; держать старую версию до завершения экземпляров или мигрировать снимок; что видит идущий экземпляр после деплоя — **(не проверено)** |
| 10 ms CPU на шаг на Free                          | `transition()` и разбор ответа LLM, вероятно, укладываются **(оценка)**; тяжёлые проверки кодом (индекс читаемости на длинном Конспекте) замерить             |
| 3 000 шагов в день на аккаунт                     | ~50 Материалов в день **(оценка)**; хватает для первого Ученика; потом Workers Paid                                                                           |
| Хранение экземпляров 3 дня на Free                | источник правды о статусе — D1, а не API Workflows                                                                                                            |
| `@statelyai/graph` молодой (264 звезды на GitHub) | MIT, от авторов XState; запасной путь — свой обход `machine.root`                                                                                             |
| Визуализатор дашборда в бете                      | не зависим от него                                                                                                                                            |
| Событие обработчика пришло до создания экземпляра | экземпляр создаётся до постановки заданий; ранние события буферизуются, если экземпляр уже есть ([events][wf-events])                                         |

## Рекомендации

1. **Принять XState v5 + Cloudflare Workflows** как основу Обработки и записать ADR. XState — модель и источник схем, Workflows — исполнитель, D1 — источник правды о статусе.
2. **Создать `libs/flows`** генератором Nx; три автомата: `materialProcessing`, `sourceExtraction`, `topicDigest`. У каждого состояния `meta.owner` и `meta.title`.
3. **Workflow `MaterialProcessing`** — один универсальный цикл «действие → `step.do` → событие → `transition()`». Обработчик — через `waitForEvent`, как в `model-selection.md`.
4. **Очередь Профиля** — условный `UPDATE` в D1; запуск следующего Материала последним шагом Workflow.
5. **Страница «Схемы»** — `@statelyai/graph` → `@xyflow/react` + `elkjs`; живой статус — эндпоинт `GET /materials/{id}/flow` в TypeSpec.
6. **Тесты** — Vitest с `xstate/graph`: достижимость, отсутствие тупиков, сценарии запасных веток, наличие `meta`.
7. **До кода — спайк на полдня:** один автомат, один Workflow с `waitForEvent`, локально через `wrangler dev`; замерить CPU шага и проверить адаптер `@statelyai/graph` на нашем автомате.

## Что не проверено

- Что происходит с идущим экземпляром Workflow после деплоя новой версии кода.
- Время CPU на `transition()` и разбор ответа LLM внутри шага на Free (10 ms).
- Как адаптер `@statelyai/graph/xstate` рисует параллельные состояния, `always` и вложенные автоматы; `getElkLayout` для составных узлов.
- Доступен ли визуализатор Workflows на плане Free.
- Дата выхода XState v6 и стоимость миграции снимков v5.
- Полностью ли `xstate/graph` в пакете `xstate` заменяет `@xstate/graph` (документация импортирует из `xstate/graph`).
- Срок хранения истории в Restate Cloud Free.
- Отображается ли граф workflow в Mastra Studio при развёртывании на Workers.
- Есть ли «мир» Cloudflare для Vercel Workflow SDK; работает ли DBOS на Workers через Hyperdrive.
- Набросок автомата в разделе 3.2 не запускался.

[xs-npm]: https://registry.npmjs.org/xstate
[xg-npm]: https://registry.npmjs.org/@xstate/graph
[xs-releases]: https://github.com/statelyai/xstate/releases
[xs-v6b0]: https://github.com/statelyai/xstate/releases/tag/xstate%406.0.0-beta.0
[xs-persist]: https://stately.ai/docs/persistence
[xs-pure]: https://stately.ai/docs/pure-transitions
[xs-graph]: https://stately.ai/docs/graph
[sg-npm]: https://registry.npmjs.org/@statelyai/graph
[inspect-npm]: https://registry.npmjs.org/@statelyai/inspect
[stately-pricing]: https://stately.ai/pricing
[xyflow-npm]: https://registry.npmjs.org/@xyflow/react
[elk-npm]: https://registry.npmjs.org/elkjs
[mermaid-npm]: https://registry.npmjs.org/mermaid
[wf-limits]: https://developers.cloudflare.com/workflows/reference/limits/
[wf-rules]: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
[wf-events]: https://developers.cloudflare.com/workflows/build/events-and-parameters/
[wf-api]: https://developers.cloudflare.com/workflows/build/workers-api/
[wf-vis]: https://developers.cloudflare.com/workflows/build/visualizer/
[wf-vis-blog]: https://blog.cloudflare.com/workflow-diagrams
[wf-changelog]: https://developers.cloudflare.com/changelog/product/workflows/
[wf-billing]: https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/
[wf-concurrency]: https://developers.cloudflare.com/changelog/post/2026-11-10-per-workflow-concurrency-limits/
[do-pricing]: https://developers.cloudflare.com/durable-objects/platform/pricing/
[restate-cf]: https://docs.restate.dev/services/deploy/cloudflare-workers
[restate-pricing]: https://restate.dev/pricing
[restate-lic]: https://github.com/restatedev/restate/blob/main/LICENSE
[restate-npm]: https://registry.npmjs.org/@restatedev/restate-sdk-cloudflare-workers
[inngest-serve]: https://www.inngest.com/docs/learn/serving-inngest-functions
[inngest-pricing]: https://www.inngest.com/pricing
[inngest-lic]: https://github.com/inngest/inngest/blob/main/LICENSE.md
[inngest-npm]: https://registry.npmjs.org/inngest
[upstash-cf]: https://upstash.com/docs/workflow/quickstarts/cloudflare-workers
[upstash-pricing]: https://upstash.com/pricing/workflow
[upstash-npm]: https://registry.npmjs.org/@upstash/workflow
[temporal-readme]: https://github.com/temporalio/sdk-typescript/blob/main/README.md
[temporal-npm]: https://registry.npmjs.org/@temporalio/client
[trigger-pricing]: https://trigger.dev/pricing
[trigger-npm]: https://registry.npmjs.org/@trigger.dev/sdk
[hatchet-workers]: https://docs.hatchet.run/home/workers
[hatchet-npm]: https://registry.npmjs.org/@hatchet-dev/typescript-sdk
[dbos-npm]: https://registry.npmjs.org/@dbos-inc/dbos-sdk
[hyperdrive]: https://developers.cloudflare.com/hyperdrive/learning/connect-to-postgres/
[mastra-cf]: https://mastra.ai/guides/deployment/cloudflare-deployer
[mastra-d1]: https://mastra.ai/reference/storage/cloudflare-d1
[mastra-npm]: https://registry.npmjs.org/@mastra/core
[vwf-worlds]: https://app.unpkg.com/workflow@5.2.0/files/docs/configuration/worlds.mdx
[vwf-npm]: https://registry.npmjs.org/workflow
