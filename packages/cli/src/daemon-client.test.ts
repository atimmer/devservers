import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDaemonServices,
  fetchServiceLogs,
  mutateService,
  runServiceAction,
} from "./daemon-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("daemon client", () => {
  it("encodes service names and preserves action impact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          action: "stop",
          target: "web app",
          affected: ["worker", "web app"],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runServiceAction("http://localhost:4141", "web app", "stop"),
    ).resolves.toMatchObject({
      affected: ["worker", "web app"],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4141/services/web%20app/stop", {
      method: "POST",
    });
  });

  it("sends service mutations through the daemon", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await mutateService("http://localhost:4141", "api", "DELETE");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4141/services/api",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("requests bounded log snapshots with encoded service names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"service":"web app","status":"running","logs":"ready"}'),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchServiceLogs("http://localhost:4141", "web app", { lines: 50, ansi: true }),
    ).resolves.toMatchObject({ logs: "ready" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4141/services/web%20app/logs/snapshot?lines=50&ansi=1",
      undefined,
    );
  });

  it("surfaces structured daemon errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response('{"error":"service is compose-managed"}', { status: 400 })),
    );
    await expect(mutateService("http://localhost:4141", "api", "DELETE")).rejects.toThrow(
      "service is compose-managed",
    );
  });

  it("keeps status output free of service configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            services: [
              {
                name: "api",
                status: "error",
                command: "pnpm dev",
                env: { SECRET: "hidden" },
                exitCode: 1,
                message: "Exited with code 1.",
              },
            ],
          }),
        ),
      ),
    );

    await expect(fetchDaemonServices("http://localhost:4141")).resolves.toEqual([
      {
        name: "api",
        status: "error",
        exitCode: 1,
        message: "Exited with code 1.",
      },
    ]);
  });
});
