import type { PushSubscription } from "@block65/webcrypto-web-push";
import { pageHtml, serviceWorkerJs } from "./page";
import { type PushEnv, sendPush, vapidFrom } from "./push";

// Spike only: subscriptions live in isolate memory (single isolate under `wrangler dev`).
const subscriptions = new Map<string, PushSubscription>();

const isSubscription = (value: unknown): value is PushSubscription =>
  typeof value === "object" &&
  value !== null &&
  "endpoint" in value &&
  typeof value.endpoint === "string" &&
  value.endpoint.startsWith("https://") &&
  "keys" in value &&
  typeof value.keys === "object" &&
  value.keys !== null &&
  "p256dh" in value.keys &&
  "auth" in value.keys;

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

type Route = (request: Request, env: PushEnv) => Promise<Response>;

const routes: Readonly<Record<string, Route>> = {
  "GET /": async (_req, env) =>
    new Response(pageHtml(env.VAPID_PUBLIC_KEY), { headers: { "content-type": "text/html; charset=utf-8" } }),
  "GET /sw.js": async () =>
    new Response(serviceWorkerJs, { headers: { "content-type": "text/javascript", "service-worker-allowed": "/" } }),
  "POST /subscribe": async (req) => {
    const body: unknown = await req.json();
    return isSubscription(body)
      ? (subscriptions.set(body.endpoint, body), json({ stored: subscriptions.size }, 201))
      : json({ error: "invalid subscription" }, 400);
  },
  "POST /send": async (req, env) => {
    const body: unknown = await req.json();
    const text = typeof body === "object" && body !== null && "text" in body && typeof body.text === "string" ? body.text : "hello";
    const push = sendPush(vapidFrom(env));
    const results = await Promise.all([...subscriptions.values()].map((s) => push(s, text)));
    return json({ sent: results.length, results });
  },
};

export default {
  fetch: (request: Request, env: PushEnv): Promise<Response> => {
    const route = routes[`${request.method} ${new URL(request.url).pathname}`];
    return route ? route(request, env) : Promise.resolve(json({ error: "not found" }, 404));
  },
} satisfies ExportedHandler<PushEnv>;
