// Cloudflare Worker entry for the same handler (local `wrangler dev` check only; never deployed).
import { createA2AHandler } from "./echo-agent.ts";

export default {
  fetch: (request: Request): Promise<Response> =>
    createA2AHandler(`${new URL(request.url).origin}/`)(request),
};
