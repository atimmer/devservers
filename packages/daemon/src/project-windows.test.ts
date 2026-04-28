import { describe, expect, it } from "vitest";
import { matchProjectWindowNames } from "./project-windows.js";

describe("matchProjectWindowNames", () => {
  it("matches compose-managed windows for removed projects", () => {
    expect(
      matchProjectWindowNames(
        ["academy_api", "academy_web", "other_api", "academy", "notes_api"],
        ["academy", "notes"]
      )
    ).toEqual(["academy_api", "academy_web", "notes_api"]);
  });
});
