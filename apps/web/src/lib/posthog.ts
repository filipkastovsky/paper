import posthog from "posthog-js";

export function initPostHog(): void {
  const key = import.meta.env.VITE_POSTHOG_API_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://eu.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
  });
}

export { posthog };
