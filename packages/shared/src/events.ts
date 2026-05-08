// Per spec §9. Add new event names here as they're implemented.
export const EVENTS = {
  APP_OPENED: "app_opened",
  ONBOARDING_STEP_COMPLETED: "onboarding_step_completed",
  ONBOARDING_FINISHED: "onboarding_finished",
  SESSION_STARTED: "session_started",
  SESSION_ENDED: "session_ended",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
