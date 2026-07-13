import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusDot } from "../src/components/Status";

describe("StatusDot", () => {
  it("renders a high-contrast running indicator", () => {
    const markup = renderToStaticMarkup(createElement(StatusDot, { status: "running" }));

    expect(markup).toContain("bg-emerald-300");
    expect(markup).toContain("shadow-");
    expect(markup).not.toContain("bg-emerald-400/10");
  });

  it("distinguishes starting services with motion", () => {
    const markup = renderToStaticMarkup(createElement(StatusDot, { status: "starting" }));

    expect(markup).toContain("animate-pulse");
  });
});
