import { operations } from "./features/interfaces/bound-operations";
import { createApp } from "./features/interfaces/create-app";
import type { Bindings } from "./shared/bindings";

const app = createApp(operations);

export default {
  fetch: (request: Request, env: Bindings) => app.fetch(request, env),
};
