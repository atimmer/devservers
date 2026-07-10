import { describe, expect, it } from "vitest";
import type { ServiceInfo } from "../src/api";
import { getStopImpact, groupServices, parseEnv, summarizeAction } from "../src/dashboard";

const service = (name: string, cwd: string, dependsOn?: string[]): ServiceInfo => ({
  name,
  cwd,
  command: `run ${name}`,
  dependsOn,
  status: "stopped",
});

describe("dashboard helpers", () => {
  it("groups services by authoritative working-copy root", () => {
    const groups = groupServices([
      {
        ...service("web", "/repo/apps/web"),
        repo: { name: "repo", root: "/repo", workspace: "apps/web" },
      },
      {
        ...service("api", "/repo/apps/api"),
        repo: { name: "repo", root: "/repo", workspace: "apps/api" },
      },
      service("docs", "/docs"),
    ]);
    expect(groups.map((group) => [group.title, group.services.map((item) => item.name)])).toEqual([
      ["docs", ["docs"]],
      ["repo", ["api", "web"]],
    ]);
  });

  it("finds transitive dependents before a cascading stop", () => {
    const services = [
      service("db", "/repo"),
      service("api", "/repo", ["db"]),
      service("web", "/repo", ["api"]),
      service("other", "/repo"),
    ];
    expect(getStopImpact(services, "db")).toEqual(["db", "api", "web"]);
  });

  it("summarizes only services the daemon actually affected", () => {
    expect(
      summarizeAction({ ok: true, action: "restart", target: "web", affected: ["api", "web"] }),
    ).toBe("Restarted api, web.");
    expect(
      summarizeAction({ ok: true, action: "delete", target: "worker", affected: ["worker"] }),
    ).toBe("Deleted worker.");
  });

  it("parses values containing equals signs", () => {
    expect(parseEnv("TOKEN=a=b\nEMPTY=\ninvalid")).toEqual({ TOKEN: "a=b", EMPTY: "" });
  });
});
