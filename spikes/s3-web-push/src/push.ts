import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";

export type PushEnv = {
  readonly VAPID_SUBJECT: string;
  readonly VAPID_PUBLIC_KEY: string;
  readonly VAPID_PRIVATE_KEY: string;
};

export const vapidFrom = (env: PushEnv): VapidKeys => ({
  subject: env.VAPID_SUBJECT,
  publicKey: env.VAPID_PUBLIC_KEY,
  privateKey: env.VAPID_PRIVATE_KEY,
});

export type PushResult = { readonly endpoint: string; readonly status: number; readonly body: string };

export const sendPush =
  (vapid: VapidKeys, send: typeof fetch = fetch) =>
  async (subscription: PushSubscription, data: string): Promise<PushResult> => {
    const message: PushMessage = { data, options: { ttl: 60, urgency: "normal" } };
    const payload = await buildPushPayload(message, subscription, vapid);
    const res = await send(subscription.endpoint, payload);
    return { endpoint: subscription.endpoint, status: res.status, body: await res.text() };
  };
