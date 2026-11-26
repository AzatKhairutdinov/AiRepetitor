/** Who carries out a step: shown on the Team diagrams by node colour. */
export type Owner = "tutor" | "methodologist" | "worker" | "code" | "system";

/** Every state of every machine carries this in `meta`. */
export interface StateMeta {
  owner: Owner;
  /** Russian label for the diagram. */
  title: string;
}
