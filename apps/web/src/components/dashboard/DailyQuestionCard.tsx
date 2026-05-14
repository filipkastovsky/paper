import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useDailyQuestionStore } from "@/stores/daily-question-store";
import { useGetV1DailyQuestion, usePostV1Predictions } from "@paper/api-client";
import { ASSETS } from "@paper/shared";
import { useQueryClient } from "@tanstack/react-query";

export function DailyQuestionCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetV1DailyQuestion({ query: { staleTime: 30_000 } });
  const mutation = usePostV1Predictions();

  const {
    optimisticDirection,
    defaultStake,
    idempotencyKey,
    setOptimisticDirection,
    mintIdempotencyKey,
    clearOptimistic,
  } = useDailyQuestionStore();

  if (isLoading) {
    return (
      <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">Today's Question</Eyebrow>
        <p className="mt-1 font-display font-semibold text-ink text-sm animate-pulse">Loading…</p>
      </Card>
    );
  }

  if (!data?.question) return null;

  const question = data.question;
  const myPrediction = data.my_prediction;
  const pointsBalance = data.points_balance;

  const asset = ASSETS.find((a) => a.id === question.asset_id);
  const assetName = asset?.name ?? question.asset_id;

  const votedDirection = myPrediction?.direction ?? optimisticDirection;
  const hasVoted = votedDirection !== null;
  const isResolved = question.direction_resolved !== null;

  function handleVote(direction: "up" | "down") {
    if (hasVoted || mutation.isPending) return;

    // Generate idempotency key synchronously so it's available immediately
    const resolvedKey =
      idempotencyKey ??
      `dq-${
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      }`;

    if (!idempotencyKey) mintIdempotencyKey();

    setOptimisticDirection(direction);

    mutation.mutate(
      {
        data: {
          daily_question_id: question.id,
          direction,
          stake: defaultStake,
          idempotency_key: resolvedKey,
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["getV1DailyQuestion"] });
        },
        onError: () => {
          clearOptimistic();
        },
      },
    );
  }

  if (isResolved && myPrediction) {
    const statusLabel =
      myPrediction.status === "correct"
        ? "Correct!"
        : myPrediction.status === "wrong"
          ? "Wrong"
          : "Tie";
    const payoutText =
      myPrediction.payout != null && myPrediction.payout > 0
        ? `+${myPrediction.payout} pts`
        : myPrediction.status === "wrong"
          ? `−${String(myPrediction.stake)} pts`
          : "refunded";

    return (
      <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">Yesterday's Question</Eyebrow>
        <p className="mt-0.5 font-display font-semibold text-ink text-sm">
          {assetName} closed <span className="capitalize">{question.direction_resolved}</span>
        </p>
        <p className="mt-1 text-xs text-ink/70">
          You predicted <span className="font-semibold capitalize">{myPrediction.direction}</span>{" "}
          &middot; {statusLabel} &middot; <span className="font-semibold">{payoutText}</span>
        </p>
        <p className="mt-1 text-xs text-ink/50">Balance: {pointsBalance} pts</p>
      </Card>
    );
  }

  if (hasVoted) {
    return (
      <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">Today's Question</Eyebrow>
        <p className="mt-0.5 font-display font-semibold text-ink text-sm">
          Will {assetName} close up or down vs. yesterday?
        </p>
        <p className="mt-2 text-xs text-ink/70">
          Vote locked in &middot; <span className="font-semibold capitalize">{votedDirection}</span>{" "}
          &middot; {defaultStake} pts staked
        </p>
        <p className="mt-0.5 text-xs text-ink/50">Balance: {pointsBalance} pts</p>
      </Card>
    );
  }

  return (
    <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
      <div>
        <Eyebrow className="text-ink/60">Today's Question</Eyebrow>
        <p className="mt-0.5 font-display font-semibold text-ink text-sm">
          Will {assetName} close up or down vs. yesterday?
        </p>
        <p className="mt-0.5 text-xs text-ink/50">
          Stake {defaultStake} pts &middot; Balance: {pointsBalance} pts
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="mint"
          size="sm"
          fullWidth
          onClick={() => handleVote("up")}
          disabled={mutation.isPending}
        >
          Up
        </Button>
        <Button
          variant="peach"
          size="sm"
          fullWidth
          onClick={() => handleVote("down")}
          disabled={mutation.isPending}
        >
          Down
        </Button>
      </div>
    </Card>
  );
}
