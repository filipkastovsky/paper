import { pickInitialRoute } from "@/lib/auth-redirect";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const target = pickInitialRoute();
    // If auth hasn't bootstrapped yet, fall through to /onboarding/welcome —
    // it'll re-redirect once `pickInitialRoute()` returns a non-null value on
    // a later visit. (bootstrapAuth completes in <1s for a returning user.)
    throw redirect({ to: target ?? "/onboarding/welcome" });
  },
});
