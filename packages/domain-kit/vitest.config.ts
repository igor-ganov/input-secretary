import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "domain-kit", include: ["src/**/*.test.ts"], pool: "threads" },
});
