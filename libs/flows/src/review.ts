/** One Methodologist finding. */
export interface ReviewError {
  kind: "факт" | "пропуск" | "шаблон" | "простой русский" | "тема";
  quote: string;
  fix: string;
}

/** A Topic as the Tutor proposed it. */
export interface ProposedTopic {
  title: string;
  description: string;
  existingTopicId: string | null;
}
