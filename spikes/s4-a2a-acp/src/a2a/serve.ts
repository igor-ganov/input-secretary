import { createA2AHandler } from "./echo-agent.ts";

type Handler = (request: Request) => Promise<Response>;

// One handler per origin: the agent card must advertise the URL it is served from.
const handlerByOrigin = () => {
  const handlers = new Map<string, Handler>();
  return (origin: string): Handler => {
    const known = handlers.get(origin);
    const handler = known ?? createA2AHandler(`${origin}/`);
    handlers.set(origin, handler);
    return handler;
  };
};

export const serveA2A = (port = 0): Bun.Server<undefined> => {
  const handlerFor = handlerByOrigin();
  return Bun.serve({
    port,
    fetch: (request: Request): Promise<Response> => handlerFor(new URL(request.url).origin)(request),
  });
};

if (import.meta.main) {
  const server = serveA2A(Number(process.env.PORT ?? 8787));
  process.stdout.write(`A2A echo agent on ${server.url}\n`);
}
