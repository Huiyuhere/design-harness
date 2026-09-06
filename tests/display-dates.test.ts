import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useDisplayDates } from "../lib/display-dates";

test("server timestamps use a stable timezone and locale for hydration", () => {
  function Example() {
    const { dateLabel, timeLabel } = useDisplayDates();
    const stamp = "2026-08-29T01:00:00Z";
    return createElement("time", null, `${dateLabel(stamp)} ${timeLabel(stamp)}`);
  }
  assert.equal(renderToStaticMarkup(createElement(Example)), "<time>29 Aug 01:00</time>");
});
