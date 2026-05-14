import type { Db } from "@/db/client.js";
import { type UserPrediction, predictionPoints, userPredictions } from "@/db/schema/index.js";
import { and, eq, sql } from "drizzle-orm";

export type SubmitPredictionInput = {
  userId: string;
  dailyQuestionId: string;
  direction: "up" | "down";
  /** 100–500 inclusive */
  stake: number;
  idempotencyKey: string;
};

export type SubmitPredictionResult =
  | {
      kind: "ok";
      prediction: UserPrediction;
      wasNew: boolean;
      /** Updated balance after deducting stake (only meaningful when wasNew=true). */
      newBalance: number;
    }
  | { kind: "error"; code: "insufficient_points" };

/**
 * Submit a prediction for today's daily question.
 *
 * Idempotency contract: a duplicate (userId, dailyQuestionId) pair trips SQLSTATE
 * 23505 from the uniqueIndex. The handler catches it and returns the existing row
 * with wasNew=false, letting the client know this is a replay.
 *
 * Points flow:
 *   1. Lazy-init prediction_points row with balance=1000 if absent.
 *   2. SELECT FOR UPDATE to read balance and prevent double-spend.
 *   3. Deduct stake.
 *   4. INSERT user_prediction.
 */
export async function submitPrediction(
  db: Db,
  input: SubmitPredictionInput,
): Promise<SubmitPredictionResult> {
  // Lazy-init the points row for this user with 1000 starting balance.
  // ON CONFLICT DO NOTHING: the row already exists for returning users.
  await db
    .insert(predictionPoints)
    .values({ userId: input.userId, balance: 1000 })
    .onConflictDoNothing();

  // Check for an existing prediction first (idempotency check outside the transaction).
  // This avoids the need to catch 23505 inside a transaction (which aborts the tx in postgres).
  const existingPrediction = await getUserPredictionForQuestion(
    db,
    input.userId,
    input.dailyQuestionId,
  );
  if (existingPrediction) {
    // Idempotent replay: return the existing row with the current balance.
    const balance = await getPointsBalance(db, input.userId);
    return { kind: "ok", prediction: existingPrediction, wasNew: false, newBalance: balance };
  }

  // Wrap the balance check + deduct + insert in a transaction so that the
  // SELECT FOR UPDATE lock is held across the UPDATE and INSERT.
  return await db.transaction(async (tx) => {
    // SELECT FOR UPDATE: lock the user's points row to prevent concurrent double-spend.
    // We use raw SQL because Drizzle ORM does not expose FOR UPDATE on SELECT.
    // In Drizzle postgres-js, execute() returns the result array directly (not { rows: [] }).
    const lockResult = await tx.execute<{ balance: number }>(
      sql`SELECT balance FROM prediction_points WHERE user_id = ${input.userId} FOR UPDATE`,
    );
    // postgres.js returns an array-like result directly; cast to access index 0.
    const pointsRow = (lockResult as unknown as Array<{ balance: number }>)[0];
    if (!pointsRow) throw new Error("prediction_points row missing after lazy-init — unexpected");

    const currentBalance = pointsRow.balance;
    if (currentBalance < input.stake) {
      return { kind: "error", code: "insufficient_points" };
    }

    // Deduct the stake.
    await tx
      .update(predictionPoints)
      .set({ balance: sql`balance - ${input.stake}` })
      .where(eq(predictionPoints.userId, input.userId));

    const newBalance = currentBalance - input.stake;

    const [inserted] = await tx
      .insert(userPredictions)
      .values({
        userId: input.userId,
        dailyQuestionId: input.dailyQuestionId,
        direction: input.direction,
        stake: input.stake,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    if (!inserted) throw new Error("submitPrediction: insert returned no row — unexpected");
    return { kind: "ok", prediction: inserted, wasNew: true, newBalance };
  });
}

/**
 * Get the current points balance for a user.
 * Returns 0 if no row exists yet (before first prediction).
 */
export async function getPointsBalance(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: predictionPoints.balance })
    .from(predictionPoints)
    .where(eq(predictionPoints.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Get the user's prediction for a specific daily question.
 * Returns null if the user has not voted yet.
 */
export async function getUserPredictionForQuestion(
  db: Db,
  userId: string,
  dailyQuestionId: string,
): Promise<UserPrediction | null> {
  const [row] = await db
    .select()
    .from(userPredictions)
    .where(
      and(eq(userPredictions.userId, userId), eq(userPredictions.dailyQuestionId, dailyQuestionId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Award payouts for all pending predictions on a resolved question.
 * Called by the cron job after resolveYesterdayQuestion succeeds.
 *
 * Payout rules:
 *   - correct: stake * 2 (double the stake)
 *   - wrong: 0 (lose the stake)
 *   - tie: stake (refund, no gain no loss)
 *
 * Updates user_predictions.status + payout, then credits prediction_points.
 * Safe to call multiple times (status='pending' guard prevents double-award).
 */
export async function awardPayouts(
  db: Db,
  dailyQuestionId: string,
  directionResolved: "up" | "down" | "tie",
): Promise<{ awarded: number }> {
  // Fetch all pending predictions for this question.
  const pending = await db
    .select()
    .from(userPredictions)
    .where(
      and(
        eq(userPredictions.dailyQuestionId, dailyQuestionId),
        eq(userPredictions.status, "pending"),
      ),
    );

  if (pending.length === 0) return { awarded: 0 };

  // Compute status + payout per prediction.
  const updates = pending.map((p) => {
    let status: "correct" | "wrong" | "tie";
    let payout: number;
    if (directionResolved === "tie") {
      status = "tie";
      payout = p.stake;
    } else if (p.direction === directionResolved) {
      status = "correct";
      payout = p.stake * 2;
    } else {
      status = "wrong";
      payout = 0;
    }
    return { id: p.id, userId: p.userId, status, payout };
  });

  for (const u of updates) {
    await db
      .update(userPredictions)
      .set({ status: u.status, payout: u.payout })
      .where(eq(userPredictions.id, u.id));

    if (u.payout > 0) {
      await db
        .update(predictionPoints)
        .set({ balance: sql`balance + ${u.payout}` })
        .where(eq(predictionPoints.userId, u.userId));
    }
  }

  return { awarded: updates.length };
}
