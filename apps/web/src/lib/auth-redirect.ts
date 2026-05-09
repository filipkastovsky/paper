import { getStoredUser } from "./auth";

/**
 * Decides where the root path "/" should redirect after auth bootstraps.
 * - No user yet (auth still in flight): null → callers should NOT redirect.
 * - User has handle: "/dashboard"
 * - User has no handle: "/onboarding/welcome"
 */
export function pickInitialRoute(): "/dashboard" | "/onboarding/welcome" | null {
  const user = getStoredUser();
  if (!user) return null;
  return user.handle ? "/dashboard" : "/onboarding/welcome";
}
