import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { TextField } from "./TextField.tsx";

afterEach(cleanup);

test("passes keyboard hints to the input for logins and branch names", () => {
  render(
    <TextField
      label="Branch"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      inputMode="url"
    />,
  );
  const input = screen.getByRole("textbox", { name: "Branch" });
  expect(input.getAttribute("autocapitalize")).toBe("none");
  expect(input.getAttribute("autocorrect")).toBe("off");
  expect(input.getAttribute("spellcheck")).toBe("false");
  expect(input.getAttribute("inputmode")).toBe("url");
});
