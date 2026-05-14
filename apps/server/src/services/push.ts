import type { Db } from "@/db/client.js";
import { pushSubscriptions } from "@/db/schema/index.js";
import { eq } from "drizzle-orm";
import webPush from "web-push";

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url?: string;
}

export function initWebPush(config: {
  vapidPublicKey: string;
  vapidPrivateKey: string;
}): void {
  webPush.setVapidDetails(
    "mailto:ops@papercrypto.tech",
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
}

export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<"ok" | "gone"> {
  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return "ok";
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode: number }).statusCode === 410
    ) {
      return "gone";
    }
    throw err;
  }
}

export async function sendToUser(db: Db, userId: string, payload: PushPayload): Promise<number> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  let sent = 0;
  for (const sub of subs) {
    const result = await sendPush(sub, payload);
    if (result === "gone") {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    } else {
      sent++;
    }
  }
  return sent;
}

export async function subscribeUser(
  db: Db,
  userId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    });
}

export async function unsubscribeUser(db: Db, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}
