import { Button } from "@/components/ui/button";
import { requestPushPermission } from "@/lib/push";
import { getAccessToken, useGetV1PushVapidKey } from "@paper/api-client";
import { useState } from "react";

export function PushOptIn() {
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "granted" | "denied" | "error">("idle");

  const { data: vapidData } = useGetV1PushVapidKey({
    query: { staleTime: Number.POSITIVE_INFINITY },
  });

  if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window)) {
    return null;
  }

  if (Notification.permission === "granted" || dismissed || state === "granted") {
    return null;
  }

  if (Notification.permission === "denied" || state === "denied") {
    return (
      <p className="text-center text-xs text-ink/50">
        Notifications are blocked. Enable them in your browser settings to get daily reminders.
      </p>
    );
  }

  async function handleEnable() {
    if (!vapidData?.vapid_public_key) return;

    setState("loading");
    try {
      const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
      const token = getAccessToken();
      if (!token) {
        setState("error");
        return;
      }

      await requestPushPermission(vapidData.vapid_public_key, apiBase, token);
      setState("granted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("denied")) {
        setState("denied");
      } else {
        setState("error");
        setDismissed(true);
      }
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
      <p className="text-sm text-ink/70">Get daily reminders and streak alerts</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDismissed(true)}
          className="text-ink/40"
        >
          Not now
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void handleEnable();
          }}
          disabled={state === "loading" || !vapidData}
        >
          {state === "loading" ? "…" : "Enable"}
        </Button>
      </div>
    </div>
  );
}
