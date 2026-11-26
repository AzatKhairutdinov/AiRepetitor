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

model Material {
  ...MaterialSummary;
  sources: Source[];
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

/** Where the browser PUTs one file. */
model SourceUpload {
  sourceId: string;
  url: string;

  /** Headers the PUT must carry. */
  headers: Record<string>;
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
}
