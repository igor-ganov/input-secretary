import type { Operation } from "@input-secretary/contracts";
import type { Result } from "@input-secretary/domain-kit";
import { err, ok } from "@input-secretary/domain-kit";
import type { z } from "zod";

export type InvokeError = "invalid_input" | "invalid_output";
export type JsonObject = Readonly<Record<string, unknown>>;
type Invocation = Result<JsonObject, InvokeError>;

export type BoundOperation = {
  readonly contract: Operation;
  readonly invoke: (raw: unknown) => Promise<Invocation>;
};

/** Pairs a contract with its use case; both directions are validated at this port. */
export const bindOperation = <I extends z.ZodObject, O extends z.ZodObject>(
  contract: Operation<I, O>,
  handler: (input: z.output<I>) => Promise<z.input<O>>,
): BoundOperation => {
  const output: z.ZodObject = contract.output;
  const validated = async (input: z.output<I>): Promise<Invocation> => {
    const parsed = output.safeParse(await handler(input));
    switch (parsed.success) {
      case true:
        return ok(parsed.data);
      case false:
        return err("invalid_output");
    }
  };
  const invoke = async (raw: unknown): Promise<Invocation> => {
    const parsed = contract.input.safeParse(raw);
    switch (parsed.success) {
      case true:
        return validated(parsed.data);
      case false:
        return err("invalid_input");
    }
  };
  return { contract, invoke };
};
