import { matchResult } from "@input-secretary/domain-kit";
import type { Context, Hono } from "hono";
import type { Bindings } from "../../../shared/bindings";
import type {
  BoundOperation,
  InvokeError,
  JsonObject,
} from "../../../shared/registry/bind-operation";
import { readInput } from "./read-input";

const statusOf = { invalid_input: 400, invalid_output: 500 } as const;

const respond = (context: Context) =>
  matchResult<JsonObject, InvokeError, Response>({
    ok: (value) => context.json(value),
    err: (error) => context.json({ error }, statusOf[error]),
  });

export const mountRest =
  (app: Hono<{ Bindings: Bindings }>) =>
  ({ contract, invoke }: BoundOperation) => {
    app.on(contract.rest.method, contract.rest.path, async (context) =>
      respond(context)(await invoke(await readInput(context.req.raw))),
    );
  };
