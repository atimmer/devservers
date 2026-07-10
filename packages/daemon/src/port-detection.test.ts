import { describe, expect, it } from "vitest";
import { extractPortFromLogs } from "./port-detection.js";

describe("extractPortFromLogs", () => {
  it("returns the latest valid local port", () => {
    expect(
      extractPortFromLogs("API: http://localhost:3000\nUI: http://127.0.0.1:4173")
    ).toBe(4173);
  });

  it("ignores address-in-use errors", () => {
    expect(extractPortFromLogs("EADDRINUSE: localhost:3000\nReady on localhost:3100")).toBe(3100);
  });

  it("rejects out-of-range ports", () => {
    expect(extractPortFromLogs("Ready on localhost:70000")).toBeUndefined();
  });
});
