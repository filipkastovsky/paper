import { HandleInput, type Status } from "@/components/onboarding/HandleInput";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useGetV1HandlesCheck, usePatchV1Me } from "@paper/api-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/onboarding/handle")({
  component: HandlePick,
});

function HandlePick() {
  const navigate = useNavigate();
  const setClaimedHandle = useOnboardingStore((s) => s.setClaimedHandle);

  const [draft, setDraft] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(draft.toLowerCase().trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  const enabled = debounced.length >= 3;
  const check = useGetV1HandlesCheck(
    { handle: debounced },
    { query: { enabled, retry: 0, staleTime: 30_000 } },
  );

  const status: Status = useMemo(() => {
    if (draft.length === 0) return { kind: "idle" };
    if (!enabled) return { kind: "idle" };
    if (debounced !== draft.toLowerCase().trim()) return { kind: "checking" };
    if (check.isFetching) return { kind: "checking" };
    if (check.data) {
      if (check.data.available) return { kind: "available" };
      const r = check.data.reason;
      if (r === "invalid_format") return { kind: "invalid_format" };
      if (r === "reserved") return { kind: "reserved" };
      if (r === "taken") return { kind: "taken" };
    }
    return { kind: "checking" };
  }, [draft, debounced, enabled, check.isFetching, check.data]);

  const claim = usePatchV1Me();
  const canSubmit = status.kind === "available" && !claim.isPending;

  async function onSubmit() {
    if (!canSubmit) return;
    // NOTE(v0): PATCH /v1/me may return 409 if a TOCTOU race occurs between
    // the availability check and the claim. We just SAW the handle as available
    // ~300ms ago, so this is extremely unlikely; we let the rejection propagate
    // for now. T-future: catch and refetch the check, surfacing "taken".
    const result = await claim.mutateAsync({ data: { handle: debounced } });
    setClaimedHandle(result.user.handle ?? null);
    await navigate({ to: "/onboarding/balance" });
  }

  return (
    <div className="space-y-6">
      <StepIndicator current="handle" />
      <Card tone="paper" elevation="float" padding="lush">
        <Eyebrow>step 2 of 4</Eyebrow>
        <Heading level="h2" className="mt-3">
          Pick your handle
        </Heading>
        <p className="mt-2 text-ink-soft text-sm">
          Shows up on leaderboards and share cards. Pick something you'll be proud to screenshot.
        </p>
        <div className="mt-6">
          <HandleInput value={draft} status={status} onChange={setDraft} />
        </div>
        <Button
          trailing="→"
          fullWidth
          className="mt-8"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          onClick={onSubmit}
        >
          {claim.isPending ? "Claiming…" : "Claim handle"}
        </Button>
      </Card>
    </div>
  );
}
