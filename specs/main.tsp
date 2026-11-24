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
