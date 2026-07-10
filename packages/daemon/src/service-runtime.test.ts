import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOG_LINES,
  MAX_LOG_LINES,
  normalizeLogLines,
  parsePaneRuntime,
} from "./service-runtime.js";

describe("parsePaneRuntime", () => {
  it("reports a managed live pane as running even when its command is a shell", () => {
    expect(parsePaneRuntime("0\t\t\tzsh\t1")).toEqual({ status: "running" });
  });

  it("treats legacy idle shell panes as stopped", () => {
    expect(parsePaneRuntime("0\t\t\tzsh\t")).toEqual({ status: "stopped" });
  });

  it("preserves successful exits", () => {
    expect(parsePaneRuntime("1\t0\t\tnode\t1")).toEqual({
      status: "exited",
      message: "Exited successfully.",
      exitCode: 0,
    });
  });

  it("preserves failed exit details", () => {
    expect(parsePaneRuntime("1\t137\tSIGKILL\tnode\t1")).toEqual({
      status: "error",
      message: "Exited with signal SIGKILL.",
      exitCode: 137,
      exitSignal: "SIGKILL",
    });
  });
});

describe("normalizeLogLines", () => {
  it("uses the default for invalid requests", () => {
    expect(normalizeLogLines(undefined)).toBe(DEFAULT_LOG_LINES);
    expect(normalizeLogLines("0")).toBe(DEFAULT_LOG_LINES);
    expect(normalizeLogLines("not-a-number")).toBe(DEFAULT_LOG_LINES);
  });

  it("caps large requests", () => {
    expect(normalizeLogLines("999999")).toBe(MAX_LOG_LINES);
  });

  it("truncates fractional requests", () => {
    expect(normalizeLogLines("42.9")).toBe(42);
  });
});
