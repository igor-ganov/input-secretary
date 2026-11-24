import type { z } from "zod";

export type RestBinding = { readonly method: "GET" | "POST"; readonly path: `/api/${string}` };

export type Operation<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> = {
  readonly name: string;
  readonly summary: string;
  readonly mcpTool: string;
  readonly rest: RestBinding;
  readonly input: I;
  readonly output: O;
};

export const defineOperation = <I extends z.ZodObject, O extends z.ZodObject>(
  operation: Operation<I, O>,
): Operation<I, O> => operation;
