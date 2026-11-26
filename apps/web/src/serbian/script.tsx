import { useState } from "react";
import { latinToCyrillic } from "./transliterate.ts";

type Script = "latin" | "cyrillic";
const KEY = "airepetitor.serbianScript";

/** The Learner's choice of Serbian script, kept in this browser. */
export function useSerbianScript(): [Script, (s: Script) => void] {
  const [script, setScript] = useState<Script>(() => {
    try {
      return localStorage.getItem(KEY) === "cyrillic" ? "cyrillic" : "latin";
    } catch {
      return "latin"; // Storage blocked by the browser.
    }
  });
  return [
    script,
    (next) => {
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Not remembered, but still switched for this visit.
      }
      setScript(next);
    },
  ];
}

export function ScriptToggle({
  script,
  onChange,
}: {
  script: Script;
  onChange: (s: Script) => void;
}) {
  return (
    <p role="group" aria-label="Азбука сербского">
      <button type="button" aria-pressed={script === "latin"} onClick={() => onChange("latin")}>
        Latinica
      </button>{" "}
      <button
        type="button"
        aria-pressed={script === "cyrillic"}
        onClick={() => onChange("cyrillic")}
      >
        Ћирилица
      </button>
    </p>
  );
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

/** rehype plugin: transliterates text nodes only; code and link text (file names) stay as they are. */
export function rehypeCyrillic() {
  const walk = (node: HastNode) => {
    if (node.type === "element" && ["code", "pre", "a"].includes(node.tagName ?? "")) return;
    if (node.type === "text" && node.value) node.value = latinToCyrillic(node.value);
    node.children?.forEach(walk);
  };
  return (tree: HastNode) => walk(tree);
}
