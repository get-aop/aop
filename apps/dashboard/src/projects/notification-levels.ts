import type { NotificationLevel } from "@aop/common";

/** The levels a person can pick, in the order menus list them, with the sentence that says what each raises. */
export const NOTIFICATION_LEVELS: { level: NotificationLevel; label: string }[] = [
  { level: "coordinator", label: "Coordinator posts and blocked threads" },
  { level: "every-turn", label: "Every finished thread turn" },
  { level: "off", label: "Off" },
];
