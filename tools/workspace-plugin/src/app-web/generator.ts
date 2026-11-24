import { formatFiles, generateFiles, joinPathFragments, type Tree } from "@nx/devkit";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default async function (tree: Tree, options: { name: string }) {
  const here = dirname(fileURLToPath(import.meta.url));
  generateFiles(tree, joinPathFragments(here, "files"), `apps/${options.name}`, {
    ...options,
    tmpl: "",
  });
  await formatFiles(tree);
}
