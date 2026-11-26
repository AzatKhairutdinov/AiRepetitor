// Seam 1: the HTTP API of «Загрузить материал» end to end. The test plays the Learner and the
// worker at once; models are a fake OpenAI-compatible provider; Workflows run the real
// Processing loop (runProcessing) on an in-memory step executor, since `cloudflare:workers`
// does not load in Node.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatedMaterial, WorkerJob } from "../../../libs/contract/src/server/api.schemas.ts";
import type { Env } from "./env.ts";
import app from "./index.ts";
import { type ProcessingStep, runProcessing } from "./processing/run.ts";
import { purgeOriginals } from "./processing/retention.ts";

const randomValue = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;
const ORIGIN = "http://localhost";
const MODELS = "https://models.test/v1";
const WORKER_PROTOCOL = "4";
/** What every test file and Source text contains. */
const BODY = "Lección 1. Hablé.";
const BODY_BYTES = new TextEncoder().encode(BODY).byteLength;
/** A PUT to a signed storage link; the storage route wants the length. */
const putInit = (headers: Record<string, string>): RequestInit => ({
  method: "PUT",
  headers: { ...headers, "content-length": String(BODY_BYTES) },
  body: BODY,
});

// --- Fake model provider -----------------------------------------------------------------------

type Role =
  | "split"
  | "reviewSplit"
  | "digest"
  | "revise"
  | "update"
  | "reviewDigest"
  | "reviewUpdate"
  | "chat";

/** The first line of each Playbook instruction tells the roles apart. */
const ROLE_BY_HEADING: Record<string, Role> = {
  "# Репетитор: деление на Темы": "split",
  "# Методист: проверка деления на Темы": "reviewSplit",
  "# Репетитор: Конспект": "digest",
  "# Репетитор: правка Конспекта": "revise",
  "# Репетитор: новая версия Конспекта": "update",
  "# Методист: проверка Конспекта": "reviewDigest",
  "# Методист: проверка новой версии Конспекта": "reviewUpdate",
  "# Репетитор: Реплика в Чате": "chat",
};

/** A Digest that passes every Code Check; `extra` lands in «Главное». */
const digest = (labels: string, extra = "") => `# Pretérito indefinido

## Коротко

Прошедшее время для законченных действий ${labels}.

## Главное

- Окончания: -é и -í ${labels}.${extra ? `\n- ${extra}` : ""}

## Примеры

- Hablé con Ana. — Я поговорил с Аней ${labels}.

## Частые ошибки

- Путают с другим прошедшим временем.

## Связанные темы

- Pretérito imperfecto.

## Источники

- ${labels}
`;

const PASSED = JSON.stringify({ passed: true, errors: [] });
const topicsAnswer = (...topics: { title: string; existingTopicId?: string | null }[]) =>
  JSON.stringify({
    topics: topics.map((t) => ({
      title: t.title,
      description: "Одна тема испанского.",
      existingTopicId: t.existingTopicId ?? null,
    })),
  });

/** `DOWN` answers 400, which the model client does not retry. */
type Reply = string | "DOWN";

const DEFAULTS: Record<Role, (user: string) => Reply> = {
  split: () => topicsAnswer({ title: "Pretérito indefinido" }),
  reviewSplit: () => PASSED,
  digest: () => digest("[S1]"),
  revise: () => digest("[S1]"),
  update: () => digest("[P1] [S1]", "Неправильные глаголы: fui, tuve [S1]."),
  reviewDigest: () => PASSED,
  reviewUpdate: () => PASSED,
  // Echo the event, so a test sees which Message it was.
  chat: (user) => `Реплика: ${/^Событие: (.+)\.$/m.exec(user)?.[1] ?? "?"}`,
};

const models = {
  /** Replies used before the defaults, per role, in order. */
  queued: {} as Partial<Record<Role, Reply[]>>,
  /** Every role answers DOWN while set. */
  down: false,
  calls: [] as Role[],
  reset() {
    this.queued = {};
    this.down = false;
    this.calls = [];
  },
};

const realFetch = globalThis.fetch;
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(MODELS)) return realFetch(input, init);
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[];
  };
  const system = body.messages.find((m) => m.role === "system")?.content ?? "";
  const user = body.messages.find((m) => m.role === "user")?.content ?? "";
  const role = ROLE_BY_HEADING[system.split("\n")[0]!.trim()];
  if (!role) throw new Error(`Unknown model role: ${system.slice(0, 80)}`);
  models.calls.push(role);
  const reply = models.down ? "DOWN" : (models.queued[role]?.shift() ?? DEFAULTS[role](user));
  if (reply === "DOWN") return new Response("unavailable", { status: 400 });
  return Response.json({
    choices: [{ message: { content: reply } }],
    usage: { prompt_tokens: 1000, completion_tokens: 500 },
  });
}

// --- Fake Workflows: the real Processing loop on an in-memory step executor --------------------

type InstanceState = "running" | "waiting" | "done" | "errored" | "terminated";

class FakeInstance {
  state: InstanceState = "running";
  error: unknown = null;
  private buffered = new Map<string, unknown[]>();
  private waiter: {
    type: string;
    resolve: (e: { payload: unknown }) => void;
    reject: (e: unknown) => void;
  } | null = null;

  /** Durable steps run once here; a throwing step fails the test instead of being retried. */
  readonly step = {
    do: async (_name: string, a: unknown, b?: unknown) => {
      const fn = (typeof a === "function" ? a : b) as () => Promise<unknown>;
      return fn();
    },
    waitForEvent: (_name: string, options: { type: string }) => {
      const queued = this.buffered.get(options.type);
      if (queued?.length) return Promise.resolve({ payload: queued.shift() });
      this.state = "waiting";
      return new Promise((resolve, reject) => {
        this.waiter = { type: options.type, resolve, reject };
      });
    },
  } as unknown as ProcessingStep;

  async sendEvent(event: { type: string; payload: unknown }) {
    if (this.waiter?.type === event.type) {
      const { resolve } = this.waiter;
      this.waiter = null;
      this.state = "running";
      resolve({ payload: event.payload });
      return;
    }
    // Workflows buffer events that nobody waits for yet.
    this.buffered.set(event.type, [...(this.buffered.get(event.type) ?? []), event.payload]);
  }

  async terminate() {
    this.state = "terminated";
    this.waiter?.reject(new Error("terminated"));
  }
}

class FakeWorkflows {
  readonly instances = new Map<string, FakeInstance>();

  async create({ id, params }: { id: string; params: { materialId: string } }) {
    const instance = new FakeInstance();
    this.instances.set(id, instance);
    runProcessing(env, params.materialId, instance.step).then(
      () => {
        if (instance.state !== "terminated") instance.state = "done";
      },
      (error) => {
        if (instance.state === "terminated") return;
        instance.state = "errored";
        instance.error = error;
      },
    );
    return instance;
  }

  async get(id: string) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`No Workflow instance ${id}`);
    return instance;
  }

  /** Waits until every instance waits for an event or has ended. */
  async settle() {
    const deadline = Date.now() + 20_000;
    let calm = 0;
    while (calm < 5) {
      const all = [...this.instances.values()];
      const broken = all.find((i) => i.state === "errored");
      if (broken) throw broken.error;
      calm = all.every((i) => i.state !== "running") ? calm + 1 : 0;
      if (Date.now() > deadline) throw new Error("Processing did not settle");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

// --- Environment --------------------------------------------------------------------------------

let env: Env;
let workflows: FakeWorkflows;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const proxy = await getPlatformProxy<Pick<Env, "DB" | "FILES">>({
    configPath: join(import.meta.dirname, "../wrangler.toml"),
    persist: false,
  });
  dispose = proxy.dispose;
  const dir = join(import.meta.dirname, "../migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(dir, file), "utf-8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await proxy.env.DB.prepare(statement).run();
    }
  }
  workflows = new FakeWorkflows();
  env = {
    DB: proxy.env.DB,
    FILES: proxy.env.FILES,
    PROCESSING: workflows as unknown as Env["PROCESSING"],
    DEEPINFRA_API_KEY: "test-key",
    TUTOR_BASE_URL: MODELS,
    METHODOLOGIST_BASE_URL: MODELS,
    REVISION_ROUNDS: "1",
    WORKER_TOKEN: randomValue(),
    BETTER_AUTH_SECRET: randomValue(),
    BETTER_AUTH_URL: ORIGIN,
  };
  globalThis.fetch = fakeFetch as typeof fetch;
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await dispose();
});

beforeEach(() => models.reset());
afterEach(() => vi.useRealTimers());

// --- The Learner --------------------------------------------------------------------------------

interface Learner {
  call(path: string, init?: RequestInit): Promise<Response>;
  json<T = any>(path: string, init?: RequestInit): Promise<T>;
}

async function signUp(): Promise<Learner> {
  const res = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        email: `${crypto.randomUUID()}@example.com`,
        password: randomValue(),
        name: "Ученик",
      }),
    },
    env,
  );
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const call = async (path: string, init: RequestInit = {}) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          cookie,
          origin: ORIGIN,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      },
      env,
    );
  return { call, json: async (path, init) => (await call(path, init)).json() };
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function profileOf(learner: Learner, language = "es") {
  const res = await learner.call("/profiles", post({ language }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Path and query of a signed storage link, which this API serves itself in local mode. */
const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

/** Creates a Material, PUTs every file and confirms the upload; Processing starts or queues. */
async function upload(learner: Learner, profileId: string, files: string[]) {
  const res = await learner.call(
    `/profiles/${profileId}/materials`,
    post({
      sources: files.map((fileName) => ({ fileName, mimeType: "text/plain", size: BODY_BYTES })),
    }),
  );
  expect(res.status).toBe(201);
  const created = (await res.json()) as CreatedMaterial;
  for (const u of created.uploads) {
    const put = await app.request(pathOf(u.url), putInit(u.headers), env);
    expect(put.status).toBeLessThan(300);
  }
  const confirmed = await learner.call(`/materials/${created.material.id}/uploaded`, post());
  expect(confirmed.status).toBe(200);
  await workflows.settle();
  return created.material.id;
}

// --- The worker ---------------------------------------------------------------------------------

type Job = WorkerJob;

const workerCall = (path: string, body: unknown, protocol = WORKER_PROTOCOL) =>
  app.request(
    path,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_TOKEN}`,
        "x-worker-protocol": protocol,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
  );

async function claim(): Promise<Job | null> {
  const res = await workerCall("/worker/claim", {
    kinds: ["pdf", "image", "document", "audio", "video"],
  });
  if (res.status === 204) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as Job;
}

/** Reports a job: `"success"` uploads the text first, any other string is the failure reason. */
async function complete(
  job: Job,
  outcome: "success" | string,
  usage?: { model: string; inputTokens: number; outputTokens: number }[],
) {
  const { attempt } = job;
  if (outcome === "success") {
    const put = await app.request(pathOf(job.writeText.url), putInit(job.writeText.headers), env);
    expect(put.status).toBeLessThan(300);
  }
  return workerCall(
    `/worker/jobs/${job.jobId}/complete`,
    outcome === "success"
      ? { attempt, outcome: "success", method: "vision", ...(usage ? { usage } : {}) }
      : { attempt, outcome: "failure", code: "unreadable_document", reason: outcome },
  );
}

/** Takes every queued job; files named in `failing` fail with that reason. */
async function work(failing: Record<string, string> = {}) {
  for (let job = await claim(); job; job = await claim()) {
    const res = await complete(job, failing[job.fileName] ?? "success");
    expect(res.status).toBe(204);
    await workflows.settle();
  }
}

const materialOf = (learner: Learner, id: string) => learner.json(`/materials/${id}`);

/** The Chat of a Material as its texts, oldest first. */
const chatOf = async (learner: Learner, id: string): Promise<string[]> =>
  (await learner.json(`/materials/${id}/messages`)).items.map((m: { text: string }) => m.text);

// --- Scenarios ----------------------------------------------------------------------------------

describe("Профили", () => {
  it("creates one Profile per language", async () => {
    const learner = await signUp();
    await profileOf(learner, "es");
    const again = await learner.call("/profiles", post({ language: "es" }));
    expect(again.status).toBe(409);
    expect((await learner.json("/profiles")).items).toHaveLength(1);
  });
});

describe("Загрузка", () => {
  it("refuses an unknown format and a file over 1 GB", async () => {
    const learner = await signUp();
    const profileId = await profileOf(learner);
    const wrongFormat = await learner.call(
      `/profiles/${profileId}/materials`,
      post({ sources: [{ fileName: "virus.exe", mimeType: "application/x-msdownload", size: 9 }] }),
    );
    expect(wrongFormat.status).toBe(400);
    const tooLarge = await learner.call(
      `/profiles/${profileId}/materials`,
      post({ sources: [{ fileName: "lesson.pdf", mimeType: "application/pdf", size: 2e9 }] }),
    );
    expect(tooLarge.status).toBe(400);
  });

  it("hides another Learner's Profile and Material", async () => {
    const owner = await signUp();
    const profileId = await profileOf(owner);
    const materialId = await upload(owner, profileId, ["lesson.txt"]);
    await work();

    const stranger = await signUp();
    expect((await stranger.call(`/materials/${materialId}`)).status).toBe(404);
    expect((await stranger.call(`/materials/${materialId}/messages`)).status).toBe(404);
    expect((await stranger.call(`/profiles/${profileId}/materials`)).status).toBe(404);
    const intoTheirs = await stranger.call(
      `/profiles/${profileId}/materials`,
      post({ sources: [{ fileName: "a.txt", mimeType: "text/plain", size: 1 }] }),
    );
    expect(intoTheirs.status).toBe(404);
    expect((await stranger.call(`/materials/${materialId}`, { method: "DELETE" })).status).toBe(
      404,
    );
  });
});

describe("Worker protocol", () => {
  it("serves parts of an original by Range, as ffmpeg reads recordings", async () => {
    const learner = await signUp();
    await upload(learner, await profileOf(learner), ["lesson.txt"]);
    const job = (await claim())!;
    const bytes = new TextEncoder().encode(BODY);
    const part = async (range: string) => {
      const res = await app.request(pathOf(job.readUrl), { headers: { range } }, env);
      return {
        status: res.status,
        range: res.headers.get("content-range"),
        body: new Uint8Array(await res.arrayBuffer()),
      };
    };
    expect(await part("bytes=0-3")).toEqual({
      status: 206,
      range: `bytes 0-3/${bytes.length}`,
      body: bytes.slice(0, 4),
    });
    expect(await part("bytes=5-")).toMatchObject({ status: 206, body: bytes.slice(5) });
    expect(await part("bytes=-4")).toMatchObject({
      status: 206,
      range: `bytes ${bytes.length - 4}-${bytes.length - 1}/${bytes.length}`,
      body: bytes.slice(-4),
    });
    expect((await complete(job, "success")).status).toBe(204);
    await workflows.settle();
  });

  it("answers 426 to another protocol version", async () => {
    const res = await workerCall("/worker/claim", { kinds: ["document"] }, "1");
    expect(res.status).toBe(426);
  });

  it("gives an expired lease to the next claim and refuses the old attempt", async () => {
    const learner = await signUp();
    await upload(learner, await profileOf(learner), ["lesson.txt"]);
    const first = (await claim())!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    const second = (await claim())!;
    expect(second.jobId).toBe(first.jobId);
    expect(second.attempt).toBe(first.attempt + 1);
    // The old attempt's links have expired too; its report alone is refused.
    expect((await complete(first, "не удалось прочитать документ")).status).toBe(409);
    expect((await complete(second, "success")).status).toBe(204);
    vi.useRealTimers();
    await workflows.settle();
  });

  it("fails the Source after its third lease ran out", async () => {
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["lesson.txt"]);
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 3; i++) {
      expect(await claim()).not.toBeNull();
      vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    }
    expect(await claim()).toBeNull();
    vi.useRealTimers();
    await workflows.settle();

    const material = await materialOf(learner, materialId);
    expect(material.sources[0]).toMatchObject({
      status: "failed",
      errorReason: "не удалось обработать файл",
    });
    expect(material.status).toBe("failed");
  });
});

describe("Обработка", () => {
  it("turns a read Material into Topics with Digest v1, tells about it in the Chat, and adds up cost", async () => {
    const learner = await signUp();
    const profileId = await profileOf(learner);
    const materialId = await upload(learner, profileId, ["lesson.txt"]);
    // The worker read a scan with the vision model: 1500 + 20 tokens = 237 millionths of a dollar.
    const job = (await claim())!;
    const usage = [
      { model: "Qwen/Qwen3-VL-30B-A3B-Instruct", inputTokens: 1500, outputTokens: 20 },
    ];
    expect((await complete(job, "success", usage)).status).toBe(204);
    await workflows.settle();

    const material = await materialOf(learner, materialId);
    expect(material.status).toBe("topicsReady");
    expect(material.topics).toEqual([expect.objectContaining({ mark: "new" })]);
    const topic = await learner.json(`/topics/${material.topics[0].id}`);
    expect(topic.digest.version).toBe(1);
    expect(topic.digest.markdown).toContain(`[[source:${material.sources[0].id}]]`);
    expect(topic.sources).toEqual([expect.objectContaining({ fileName: "lesson.txt" })]);

    const chat = await chatOf(learner, materialId);
    expect(chat).toEqual([
      "Реплика: Материал принят",
      "Реплика: Исходник прочитан",
      "Реплика: Темы найдены",
    ]);

    // Cost is not part of the API yet (the Team will see it later); read it where it is kept.
    const row = await env.DB.prepare("SELECT cost_micro_usd AS cost FROM material WHERE id = ?")
      .bind(materialId)
      .first<{ cost: number }>();
    // Adds up: the worker's call plus every model call of the API, 1000 + 500 tokens each, by
    // the price table (Tutor 0.2 / 0.6, Methodologist 0.45 / 3.0 dollars per million tokens).
    const methodologist = models.calls.filter((r) => r.startsWith("review")).length;
    const tutor = models.calls.length - methodologist;
    expect(methodologist).toBeGreaterThan(0);
    expect(row!.cost).toBe(237 + tutor * 500 + methodologist * 1950);
  });

  it("revises a draft that fails the Code Checks before the Methodologist sees it", async () => {
    models.queued.digest = [digest("[S1]").replace("## Примеры", "## Пример")];
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["lesson.txt"]);
    await work();

    expect((await materialOf(learner, materialId)).status).toBe("topicsReady");
    expect(models.calls.filter((r) => r === "revise")).toHaveLength(1);
    expect(models.calls.indexOf("revise")).toBeLessThan(models.calls.indexOf("reviewDigest"));
  });

  it("runs a revision round when the Methodologist finds an error", async () => {
    models.queued.reviewDigest = [
      JSON.stringify({ passed: false, errors: [{ kind: "факт", quote: "-é", fix: "Уберите." }] }),
    ];
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["lesson.txt"]);
    await work();

    expect((await materialOf(learner, materialId)).status).toBe("topicsReady");
    expect(models.calls.filter((r) => r === "revise")).toHaveLength(1);
    expect(models.calls.filter((r) => r === "reviewDigest")).toHaveLength(2);
  });

  it("splits again after a «тема» error from the Methodologist", async () => {
    models.queued.reviewSplit = [
      JSON.stringify({ passed: false, errors: [{ kind: "тема", quote: "…", fix: "Разделите." }] }),
    ];
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["lesson.txt"]);
    await work();

    expect((await materialOf(learner, materialId)).status).toBe("topicsReady");
    expect(models.calls.filter((r) => r === "split")).toHaveLength(2);
  });

  it("gives a known Topic Digest v2 marked «дополнена»", async () => {
    const learner = await signUp();
    const profileId = await profileOf(learner);
    const first = await materialOf(
      learner,
      await upload(learner, profileId, ["lesson1.txt"]).then(async (id) => {
        await work();
        return id;
      }),
    );
    const topicId = first.topics[0].id;

    models.queued.split = [
      topicsAnswer({ title: "Pretérito indefinido", existingTopicId: topicId }),
    ];
    const secondId = await upload(learner, profileId, ["lesson2.txt"]);
    await work();

    const second = await materialOf(learner, secondId);
    expect(second.topics).toEqual([expect.objectContaining({ id: topicId, mark: "extended" })]);
    const topic = await learner.json(`/topics/${topicId}`);
    expect(topic.digest.version).toBe(2);
    expect(topic.digest.markdown).toContain(`[[source:${first.sources[0].id}]]`);
    expect(topic.digest.markdown).toContain(`[[source:${second.sources[0].id}]]`);
    const chat = await chatOf(learner, secondId);
    expect(chat).toContain("Реплика: Тема дополнена");
  });

  it("goes on with the Sources that were read when some fail", async () => {
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["good.txt", "bad.txt"]);
    await work({ "bad.txt": "не удалось прочитать документ" });

    const material = await materialOf(learner, materialId);
    expect(material.status).toBe("topicsReady");
    expect(
      material.sources.find((s: { fileName: string }) => s.fileName === "bad.txt"),
    ).toMatchObject({ status: "failed", errorReason: "не удалось прочитать документ" });
    const chat = await chatOf(learner, materialId);
    expect(chat).toContain("Реплика: Исходник не прочитан");
  });

  it("fails the Material when no Source was read", async () => {
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["bad.txt"]);
    await work({ "bad.txt": "не удалось прочитать документ" });

    const material = await materialOf(learner, materialId);
    expect(material).toMatchObject({
      status: "failed",
      errorReason: "Не удалось прочитать ни один файл",
    });
  });

  it("ends «без тем» when there is no study content", async () => {
    models.queued.split = [topicsAnswer()];
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["receipt.txt"]);
    await work();

    expect((await materialOf(learner, materialId)).status).toBe("noTopics");
    const chat = await chatOf(learner, materialId);
    expect(chat.at(-1)).toBe("Реплика: Без тем");
  });

  it("goes on from the failed step after «Повторить»", async () => {
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["lesson.txt"]);
    models.down = true;
    await work();

    const failed = await materialOf(learner, materialId);
    expect(failed).toMatchObject({ status: "failed", errorReason: "Репетитор сейчас недоступен" });
    // The Chat still got its lines: the fallback lines of the Playbook.
    const chat = (await learner.json(`/materials/${materialId}/messages`)).items;
    expect(chat.at(-1).text).toContain("Репетитор сейчас недоступен");

    models.down = false;
    const retried = await learner.call(`/materials/${materialId}/retry`, post());
    expect(retried.status).toBe(200);
    await workflows.settle();
    expect((await materialOf(learner, materialId)).status).toBe("topicsReady");
  });

  it("processes the Materials of one Profile one at a time", async () => {
    const learner = await signUp();
    const profileId = await profileOf(learner);
    const first = await upload(learner, profileId, ["one.txt"]);
    const second = await upload(learner, profileId, ["two.txt"]);
    expect((await materialOf(learner, second)).status).toBe("queued");

    // Only the first Material's file is offered to the worker.
    const job = (await claim())!;
    expect(job.fileName).toBe("one.txt");
    expect(await claim()).toBeNull();
    expect((await complete(job, "success")).status).toBe(204);
    await workflows.settle();
    await work();

    expect((await materialOf(learner, first)).status).toBe("topicsReady");
    expect((await materialOf(learner, second)).status).toBe("topicsReady");
  });
});

describe("Удаление и хранение", () => {
  it("refuses to delete during Processing, then deletes and leaves the Digest with «материал удалён»", async () => {
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["lesson.txt"]);
    const busy = await learner.call(`/materials/${materialId}`, { method: "DELETE" });
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { message: string }).message).toBe(
      "Подождите, пока материал обработается",
    );

    await work();
    const material = await materialOf(learner, materialId);
    const topicId = material.topics[0].id;

    expect((await learner.call(`/materials/${materialId}`, { method: "DELETE" })).status).toBe(204);
    expect((await learner.call(`/materials/${materialId}`)).status).toBe(404);
    expect((await learner.call(`/sources/${material.sources[0].id}/text`)).status).toBe(404);

    // The Digest stays; its label no longer resolves to a Source, which the web shows as
    // «материал удалён».
    const topic = await learner.json(`/topics/${topicId}`);
    expect(topic.digest.markdown).toContain(`[[source:${material.sources[0].id}]]`);
    expect(topic.sources).toEqual([]);
  });

  it("deletes originals 7 days after a successful Processing and keeps the Source text", async () => {
    const learner = await signUp();
    const materialId = await upload(learner, await profileOf(learner), ["lesson.txt"]);
    const job = (await claim())!;
    expect((await complete(job, "success")).status).toBe(204);
    await workflows.settle();
    const material = await materialOf(learner, materialId);
    expect(material.status).toBe("topicsReady");

    expect(await purgeOriginals(env, new Date(Date.now() + 6 * 24 * 3600 * 1000))).toBe(0);
    expect((await app.request(pathOf(job.readUrl), {}, env)).status).toBe(200);
    expect(await purgeOriginals(env, new Date(Date.now() + 8 * 24 * 3600 * 1000))).toBeGreaterThan(
      0,
    );
    expect((await app.request(pathOf(job.readUrl), {}, env)).status).toBe(404);
    expect((await learner.call(`/sources/${material.sources[0].id}/text`)).status).toBe(200);
  });
});

describe("Команда", () => {
  it("closes the Team pages to a Learner without the role", async () => {
    const learner = await signUp();
    expect((await learner.call("/team/flows")).status).toBe(403);
    expect((await learner.call("/team/checks")).status).toBe(403);
  });
});
