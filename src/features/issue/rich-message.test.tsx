import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { createTranslator, loadMessages } from "@/i18n/index.tsx";
import { richMessage } from "./rich-message.tsx";

test("keeps each language's word order around node slots", async () => {
  const slots = { actor: <b>mona</b>, label: <i>bug</i> };
  const en = createTranslator("en", await loadMessages("en"));
  const ja = createTranslator("ja", await loadMessages("ja"));
  const english = render(<p>{richMessage(en, "issue.timeline.labeled", slots)}</p>).container;
  const japanese = render(<p>{richMessage(ja, "issue.timeline.labeled", slots)}</p>).container;
  expect(english.innerHTML).toBe("<p><b>mona</b> added <i>bug</i></p>");
  expect(japanese.innerHTML).toBe("<p><b>mona</b> が <i>bug</i> を追加しました</p>");
});
