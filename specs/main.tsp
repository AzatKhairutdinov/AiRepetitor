import "@typespec/http";

using TypeSpec.Http;

@service(#{ title: "AiRepetitor API" })
namespace AiRepetitor;

model Health {
  status: "ok";
}

@route("/health")
@get
op health(): Health;

// --- Errors ------------------------------------------------------------------

@error
model NotFoundError {
  @statusCode _: 404;
  message: string;
}

@error
model ConflictError {
  @statusCode _: 409;
  message: string;
}

@error
model BadRequestError {
  @statusCode _: 400;
  message: string;
}

@error
model ForbiddenError {
  @statusCode _: 403;
  message: string;
}

@error
model UpgradeRequiredError {
  @statusCode _: 426;
  message: string;
}

@error
model UnauthorizedError {
  @statusCode _: 401;
  message: string;
}

// --- Profiles ----------------------------------------------------------------

/** ISO 639-1 code of a language a Learner can study. */
union LanguageCode {
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "zh",
  "ja",
  "ko",
  "tr",
  "sr",
}

model Language {
  code: LanguageCode;

  /** Russian name, also the name of a Profile for this language. */
  name: string;
}

model LanguageList {
  items: Language[];
}

/** One Learner studying one language. */
model Profile {
  id: string;
  language: LanguageCode;

  /** Named after the language, in Russian. */
  name: string;

  createdAt: utcDateTime;
}

model ProfileList {
  items: Profile[];
}

model CreateProfileRequest {
  language: LanguageCode;
}

@route("/languages")
@get
op listLanguages(): LanguageList;

@route("/profiles")
interface Profiles {
  @get
  listProfiles(): ProfileList | UnauthorizedError;

  @post
  createProfile(@body body: CreateProfileRequest): {
    @statusCode _: 201;
    @body body: Profile;
  } | UnauthorizedError | ConflictError;

  @route("/{profileId}")
  @get
  getProfile(@path profileId: string): Profile | UnauthorizedError | NotFoundError;
}

// --- Materials ---------------------------------------------------------------

union SourceKind {
  "pdf",
  "image",
  "document",
  "audio",
  "video",
}

/** uploading → uploaded → queued → extracting → extracted | failed */
union SourceStatus {
  "uploading",
  "uploaded",
  "queued",
  "extracting",
  "extracted",
  "failed",
}

/** uploading → uploaded → queued → processing → topicsReady | noTopics | failed */
union MaterialStatus {
  "uploading",
  "uploaded",
  "queued",
  "processing",
  "topicsReady",
  "noTopics",
  "failed",
}

/** One file the Learner sent within a Material. */
model Source {
  id: string;
  fileName: string;
  kind: SourceKind;
  mimeType: string;
  size: int64;
  durationSeconds?: float64;
  status: SourceStatus;

  /** Russian reason for the Learner, set when status is failed. */
  errorReason?: string;
}

/** Everything the Learner sent the Tutor in one upload. */
model MaterialSummary {
  id: string;
  profileId: string;
  title?: string;
  status: MaterialStatus;
  createdAt: utcDateTime;
}

union TopicMark {
  "new",
  "extended",
}

/** A Topic this Material touched. */
model MaterialTopic {
  id: string;
  title: string;
  mark: TopicMark;
}

model Material {
  ...MaterialSummary;

  /** Russian reason for the Learner, set when status is failed. */
  errorReason?: string;

  sources: Source[];
  topics: MaterialTopic[];
}

model MaterialList {
  items: MaterialSummary[];
}

model NewSource {
  fileName: string;
  mimeType: string;
  size: int64;

  /** Seconds, when the browser could read it from the media metadata. */
  durationSeconds?: float64;
}

model CreateMaterialRequest {
  title?: string;
  sources: NewSource[];
}

/** A signed link to PUT one object. */
model WriteLink {
  url: string;

  /** Headers the PUT must carry. */
  headers: Record<string>;
}

/** Where the browser PUTs one file. */
model SourceUpload {
  sourceId: string;
  ...WriteLink;
}

model CreatedMaterial {
  material: Material;
  uploads: SourceUpload[];
}

@route("/profiles/{profileId}/materials")
interface ProfileMaterials {
  @get
  listMaterials(@path profileId: string): MaterialList | UnauthorizedError | NotFoundError;

  /** Registers a Material and its Sources and returns a write link per file. */
  @post
  createMaterial(@path profileId: string, @body body: CreateMaterialRequest): {
    @statusCode _: 201;
    @body body: CreatedMaterial;
  } | BadRequestError | UnauthorizedError | NotFoundError;
}

@route("/materials/{materialId}")
interface Materials {
  @get
  getMaterial(@path materialId: string): Material | UnauthorizedError | NotFoundError;

  /** Called after every PUT finished: checks the files are in storage. */
  @route("/uploaded")
  @post
  confirmUpload(@path materialId: string): Material | BadRequestError | UnauthorizedError | NotFoundError;

  /**
   * «Повторить» for a Material in «ошибка»: it goes back to the Profile queue and goes on from
   * the failed step. When no Source was read, the failed Sources are extracted again.
   * 409 when the Material is not in «ошибка».
   */
  @route("/retry")
  @post
  retryMaterial(@path materialId: string): Material | ConflictError | UnauthorizedError | NotFoundError;
}

/**
 * «Повторить» for a Source in «ошибка» while its Material is in «ошибка»: the Source is extracted
 * again and Processing goes on; Sources already read are not extracted again.
 * Returns the Material; 409 when the Source or its Material is not in «ошибка».
 */
@route("/sources/{sourceId}/retry")
@post
op retrySource(@path sourceId: string): Material | ConflictError | UnauthorizedError | NotFoundError;

// --- Topics and Digests ------------------------------------------------------

model TopicSummary {
  id: string;
  title: string;
  description: string;
}

model TopicList {
  items: TopicSummary[];
}

/** The latest Digest version; the Learner never sees older ones. */
model Digest {
  version: int32;

  /** Markdown; `[[source:<sourceId>]]` marks a reference to a Source text. */
  markdown: string;

  createdAt: utcDateTime;
}

/** A Source a Digest may cite. */
model DigestSource {
  sourceId: string;
  fileName: string;
  materialId: string;
}

model Topic {
  ...TopicSummary;
  profileId: string;
  digest?: Digest;
  sources: DigestSource[];
}

model SourceText {
  sourceId: string;
  fileName: string;
  materialId: string;
  profileId: string;
  markdown: string;
}

@route("/profiles/{profileId}/topics")
@get
op listTopics(@path profileId: string): TopicList | UnauthorizedError | NotFoundError;

@route("/topics/{topicId}")
@get
op getTopic(@path topicId: string): Topic | UnauthorizedError | NotFoundError;

@route("/sources/{sourceId}/text")
@get
op getSourceText(@path sourceId: string): SourceText | UnauthorizedError | NotFoundError;

// --- Worker protocol (ADR 0003) ----------------------------------------------
// The worker sends `authorization: Bearer <WORKER_TOKEN>` and `x-worker-protocol: <version>`.

/** One Source to extract, leased to the worker until `leaseExpiresAt`. */
model WorkerJob {
  jobId: string;
  sourceId: string;
  kind: SourceKind;
  mimeType: string;
  fileName: string;
  size: int64;
  durationSeconds?: float64;

  /** Attempt number; send it back in `complete`. */
  attempt: int32;

  leaseExpiresAt: utcDateTime;

  /** Signed GET of the original file. */
  readUrl: string;

  /** Where to PUT the Source text (Markdown). */
  writeText: WriteLink;

  /** Audio and video only: where to PUT the extracted audio track (Opus in Ogg). */
  writeAudio?: WriteLink;
}

model ClaimJobRequest {
  /** Source kinds this worker can extract; a worker without a model key leaves out images and media. */
  kinds: SourceKind[];
}

union JobOutcome {
  "success",
  "failure",
}

model CompleteJobRequest {
  attempt: int32;
  outcome: JobOutcome;

  /** Success: how the text was extracted, e.g. xberg, pandoc, whisper, vision. */
  method?: string;

  /** Success, audio and video: the audio track was saved through `writeAudio`. */
  audioSaved?: boolean;

  /** Failure: a machine-readable code. */
  code?: string;

  /** Failure: the reason in Russian, shown to the Learner. */
  reason?: string;
}

@route("/worker")
interface Worker {
  /** Leases the next job; 204 when there is none. */
  @route("/claim")
  @post
  claimJob(@header("x-worker-protocol") protocol: string, @body body: ClaimJobRequest):
    | WorkerJob
    | NoContentResponse
    | UnauthorizedError
    | UpgradeRequiredError;

  /** Reports the result; 409 when the lease was lost to a newer attempt. */
  @route("/jobs/{jobId}/complete")
  @post
  completeJob(
    @header("x-worker-protocol") protocol: string,
    @path jobId: string,
    @body body: CompleteJobRequest,
  ):
    | NoContentResponse
    | BadRequestError
    | UnauthorizedError
    | NotFoundError
    | ConflictError
    | UpgradeRequiredError;
}

// --- Team ---------------------------------------------------------------------
// Only the "team" role; others get 403.

/** One Processing scenario; the diagram itself is drawn from libs/flows. */
model FlowSummary {
  /** Machine id in libs/flows. */
  id: string;

  title: string;
  version: int32;
}

model FlowList {
  items: FlowSummary[];
}

@route("/team/flows")
@get
op teamListFlows(): FlowList | UnauthorizedError | ForbiddenError;

/** Code Checks of the Playbook (content/checks.yaml), validated by this model at generation. */
model CodeChecks {
  /** Template sections (level-2 headings), in order. */
  sections: string[];

  /** A Russian sentence may have at most this many words; examples in the studied language do not count. */
  maxSentenceWords: int32;

  /** Bureaucratese and every glossary _Avoid_ word (the generator adds the latter). */
  forbiddenWords: string[];

  /** Every source label must point at a Source of this Processing. */
  checkSourceLabels: boolean;
}

/** The Code Checks of the Playbook edition this API was built with. */
@route("/team/checks")
@get
op teamGetChecks(): CodeChecks | UnauthorizedError | ForbiddenError;
