import { describe, expect, it } from "vitest";

import { trimTrailingBlankLogLines } from "../src/logs";

describe("trimTrailingBlankLogLines", () => {
  it("removes trailing blank tmux pane rows from short log output", () => {
    expect(trimTrailingBlankLogLines("dummy log line 1\ndummy log line 2\n\n\n   \n\t")).toBe(
      "dummy log line 1\ndummy log line 2",
    );
  });

  it("keeps intentional blank lines inside the log output", () => {
    expect(trimTrailingBlankLogLines("before\n\n\nafter\n")).toBe("before\n\n\nafter");
  });
});
