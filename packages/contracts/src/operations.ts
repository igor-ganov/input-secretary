import { healthEcho } from "./health/echo";

/** Every operation of the product; REST and MCP are projections of this list. */
export const operations = [healthEcho] as const;
