import { describe, expect, it } from "vitest";
import {
  collectDependencies,
  collectDependents,
  createDependencyGraph,
  topoSort,
  type DevServerService
} from "./index.js";

const service = (overrides: Partial<DevServerService>): DevServerService => ({
  name: "svc",
  cwd: "/Users/anton/Code/svc",
  command: "pnpm dev",
  ...overrides
});

describe("dependency graph", () => {
  it("orders dependencies before dependents", () => {
    const services = [
      service({ name: "db" }),
      service({ name: "api", dependsOn: ["db"] }),
      service({ name: "web", dependsOn: ["api"] })
    ];
    const graph = createDependencyGraph(services);
    const deps = collectDependencies(graph, "web").sort();
    expect(deps).toEqual(["api", "db", "web"].sort());

    const order = topoSort(graph, collectDependencies(graph, "web"));
    expect(order).toEqual(["db", "api", "web"]);

    const dependents = collectDependents(graph, "db");
    const stopOrder = topoSort(graph, dependents).reverse();
    expect(stopOrder).toEqual(["web", "api", "db"]);
  });

  it("rejects missing dependencies", () => {
    expect(() =>
      createDependencyGraph([service({ name: "api", dependsOn: ["missing"] })])
    ).toThrow("depends on missing service");
  });

  it("rejects self dependency", () => {
    expect(() =>
      createDependencyGraph([service({ name: "api", dependsOn: ["api"] })])
    ).toThrow("cannot depend on itself");
  });

  it("rejects duplicate dependencies", () => {
    expect(() =>
      createDependencyGraph([service({ name: "api", dependsOn: ["db", "db"] })])
    ).toThrow("duplicate dependencies");
  });

  it("rejects dependency cycles", () => {
    expect(() =>
      createDependencyGraph([
        service({ name: "api", dependsOn: ["web"] }),
        service({ name: "web", dependsOn: ["api"] })
      ])
    ).toThrow("Dependency cycle detected");
  });
});
