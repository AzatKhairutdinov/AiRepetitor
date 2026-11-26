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
