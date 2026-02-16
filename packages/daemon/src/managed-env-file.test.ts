import { describe, expect, it } from "vitest";
import {
  MANAGED_ENV_END_MARKER,
  MANAGED_ENV_START_MARKER,
  upsertManagedEnvBlock
} from "./managed-env-file.js";

describe("managed env block", () => {
  it("adds a managed block when no block exists", () => {
    const result = upsertManagedEnvBlock("FOO=bar\n", {
      PORT: "3100",
      API_URL: "http://localhost:3200"
    });

    expect(result).toBe(
      [
        "FOO=bar",
        "",
        MANAGED_ENV_START_MARKER,
        "PORT=3100",
        "API_URL=http://localhost:3200",
        MANAGED_ENV_END_MARKER,
        ""
      ].join("\n")
    );
  });

  it("replaces an existing managed block", () => {
    const existing = [
      "FOO=bar",
      MANAGED_ENV_START_MARKER,
      "PORT=3000",
      MANAGED_ENV_END_MARKER,
      "LOCAL_ONLY=true",
      ""
    ].join("\n");

    const result = upsertManagedEnvBlock(existing, {
      PORT: "3200"
    });

    expect(result).toBe(
      [
        "FOO=bar",
        "",
        MANAGED_ENV_START_MARKER,
        "PORT=3200",
        MANAGED_ENV_END_MARKER,
        "LOCAL_ONLY=true",
        ""
      ].join("\n")
    );
  });

  it("throws when block markers are malformed", () => {
    expect(() =>
      upsertManagedEnvBlock(`${MANAGED_ENV_START_MARKER}\nPORT=3000`, {
        PORT: "3200"
      })
    ).toThrow("Managed env block markers are malformed");
  });
});
