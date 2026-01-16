import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@webserver-manager/shared": path.resolve(
        __dirname,
        "packages/shared/src/index.ts"
      )
    }
  },
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node"
  }
});
