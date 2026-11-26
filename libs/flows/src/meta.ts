/** Who carries out a step: shown on the Team diagrams by node colour. */
/** `learner` owns no state; it marks the Learner's «Повторить» in the transition log. */
export type Owner = "tutor" | "methodologist" | "worker" | "code" | "system" | "learner";

/** Every state of every machine carries this in `meta`. */
export interface StateMeta {
  owner: Owner;
  /** Russian label for the diagram. */
  title: string;
}

/** Tag of a non-final state where a Processing stops until the Learner acts (e.g. «Повторить»). */
export const WAITS_FOR_LEARNER = "waitsForLearner";
