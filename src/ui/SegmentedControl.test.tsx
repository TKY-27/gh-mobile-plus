import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SegmentedControl } from "./SegmentedControl.tsx";

afterEach(cleanup);

const SEGMENTS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
] as const;

test("columns lay segments out in equal rows", () => {
  render(
    <SegmentedControl
      label="Filter"
      segments={SEGMENTS}
      selected="a"
      onChange={() => undefined}
      columns={2}
    />,
  );
  const group = screen.getByRole("radiogroup", { name: "Filter" });
  expect(group.style.gridTemplateColumns).toMatch(/^repeat\(2, /);
  expect(screen.getByRole("radio", { name: "Alpha" }).getAttribute("aria-checked")).toBe("true");
});

test("without columns the control scrolls in one row", () => {
  render(
    <SegmentedControl label="Filter" segments={SEGMENTS} selected="b" onChange={() => undefined} />,
  );
  expect(screen.getByRole("radiogroup", { name: "Filter" }).hasAttribute("data-columns")).toBe(
    false,
  );
});
