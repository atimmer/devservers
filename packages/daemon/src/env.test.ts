import { describe, expect, it } from "vitest";
import { applyPortTemplate, resolveEnv } from "./env.js";

describe("env templates", () => {
  it("replaces $PORT tokens when port is provided", () => {
    expect(applyPortTemplate("http://localhost:$PORT", 3001)).toBe(
      "http://localhost:3001"
    );
    expect(applyPortTemplate("PORT=${PORT}", 4000)).toBe("PORT=4000");
  });

  it("returns the original value when port is missing", () => {
    expect(applyPortTemplate("http://localhost:$PORT")).toBe("http://localhost:$PORT");
  });

  it("replaces named service port tokens when available", () => {
    expect(
      applyPortTemplate("http://localhost:${PORT:api}", undefined, { api: 4100 })
    ).toBe("http://localhost:4100");
  });

  it("leaves named service tokens unchanged when the target port is missing", () => {
    expect(
      applyPortTemplate("http://localhost:${PORT:api}", undefined, { web: 4100 })
    ).toBe("http://localhost:${PORT:api}");
  });

  it("resolves env maps with port templates", () => {
    const env = resolveEnv(
      {
        PORT: "$PORT",
        NEXT_PUBLIC_URL: "http://localhost:${PORT}",
        NEXT_PUBLIC_API_URL: "http://localhost:${PORT:api}"
      },
      5173,
      { api: 3000 }
    );
    expect(env).toEqual({
      PORT: "5173",
      NEXT_PUBLIC_URL: "http://localhost:5173",
      NEXT_PUBLIC_API_URL: "http://localhost:3000"
    });
  });
});
