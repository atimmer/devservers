import { beforeEach, describe, expect, it, vi } from "vitest";

const execaMock = vi.hoisted(() => vi.fn());

vi.mock("execa", () => ({ execa: execaMock }));

import { capturePane, startWindow } from "./tmux.js";

describe("startWindow", () => {
  beforeEach(() => {
    execaMock.mockReset();
    execaMock.mockResolvedValue({ stdout: "" });
  });

  it("runs the service as a managed pane process with exit retention", async () => {
    await startWindow({
      name: "api",
      cwd: "/tmp/api",
      command: "pnpm dev"
    });

    const target = "devservers:api";
    expect(execaMock).toHaveBeenCalledWith("tmux", [
      "set-option",
      "-p",
      "-t",
      target,
      "remain-on-exit",
      "on"
    ]);
    expect(execaMock).toHaveBeenCalledWith("tmux", [
      "set-option",
      "-p",
      "-t",
      target,
      "@devservers-managed",
      "1"
    ]);
    expect(execaMock).toHaveBeenCalledWith("tmux", [
      "respawn-pane",
      "-k",
      "-t",
      target,
      "-c",
      "/tmp/api",
      "pnpm dev"
    ]);
  });

  it("captures a bounded number of pane lines", async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: "api" })
      .mockResolvedValueOnce({ stdout: "line one\nline two" });

    await expect(capturePane("api", 2)).resolves.toBe("line one\nline two");
    expect(execaMock).toHaveBeenLastCalledWith("tmux", [
      "capture-pane",
      "-t",
      "devservers:api",
      "-p",
      "-S",
      "-2",
      "-E",
      "-1"
    ]);
  });
});
