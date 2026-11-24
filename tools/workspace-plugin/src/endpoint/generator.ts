import { formatFiles, type Tree } from "@nx/devkit";
import { execSync } from "node:child_process";

interface Options {
  name: string;
  route: string;
  method?: "get" | "post" | "put" | "delete";
}

export default async function (tree: Tree, options: Options) {
  const spec = "specs/main.tsp";
  const method = options.method ?? "get";
  const model = `${options.name[0]!.toUpperCase()}${options.name.slice(1)}Response`;
  const current = tree.read(spec, "utf-8") ?? "";
  if (current.includes(`op ${options.name}(`)) {
    throw new Error(`Operation ${options.name} already exists in ${spec}`);
  }
  tree.write(
    spec,
    `${current.trimEnd()}

model ${model} {
  // TODO: describe the response
  ok: boolean;
}

@route("${options.route}")
@${method}
op ${options.name}(): ${model};
`,
  );
  await formatFiles(tree);
  // Regenerate contract; Orval creates the handler stub in apps/api/src/handlers.
  return () => {
    execSync("pnpm nx run contract:generate", { stdio: "inherit" });
  };
}
