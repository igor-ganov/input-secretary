/** A body that is not JSON becomes undefined, which the contract then rejects. */
export const readInput = (request: Request): Promise<unknown> =>
  request.json().catch(() => undefined);
