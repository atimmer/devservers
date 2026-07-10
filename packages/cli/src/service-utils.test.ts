import { describe, expect, it } from "vitest";
import { formatServiceUrl, parseEnvVars } from "./service-utils.js";

describe("parseEnvVars", () => {
  it("preserves equals signs in values", () => {
    expect(parseEnvVars(["TOKEN=a=b", "MODE=dev"])).toEqual({ TOKEN: "a=b", MODE: "dev" });
  });

  it("rejects entries without a value", () => {
    expect(() => parseEnvVars(["TOKEN"])).toThrow("Invalid env entry");
  });
});

describe("formatServiceUrl", () => {
  it("normalizes paths", () => {
    expect(formatServiceUrl("http", "localhost", 4141, "health")).toBe(
      "http://localhost:4141/health",
    );
  });

  it("rejects invalid ports", () => {
    expect(() => formatServiceUrl("http", "localhost", 70000)).toThrow("invalid port");
  });
});
