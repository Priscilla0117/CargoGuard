import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkbenchSearch,
  workbenchHref,
} from "../lib/workspace-navigation";

test("work queue is canonical and invalid views recover to it", () => {
  assert.equal(workbenchHref("inbox"), "/");
  for (const query of [
    "",
    "view=inbox",
    "view=unknown",
    "view=",
    "view=__proto__",
  ])
    assert.deepEqual(parseWorkbenchSearch(new URLSearchParams(query)), {
      view: "inbox",
      caseId: null,
    });
});

test("each report and settings view survives a URL round trip", () => {
  for (const view of ["performance", "activity", "policies"] as const) {
    const href = workbenchHref(view);
    assert.equal(href, `/?view=${view}`);
    assert.deepEqual(
      parseWorkbenchSearch(new URL(href, "https://example.test").searchParams),
      { view, caseId: null },
    );
  }
});

test("case links keep their view and encode IDs without injecting query parameters", () => {
  const caseId = "shipment & view=policies/#?";
  const href = workbenchHref("activity", caseId);
  const url = new URL(href, "https://example.test");
  assert.equal(url.pathname, "/");
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.getAll("view").length, 1);
  assert.deepEqual(parseWorkbenchSearch(url.searchParams), {
    view: "activity",
    caseId,
  });
  assert.equal(workbenchHref("inbox", "email_013"), "/?case=email_013");
});

test("closing a case preserves the view and drops its citation", () => {
  for (const view of [
    "inbox",
    "performance",
    "activity",
    "policies",
  ] as const) {
    const open = parseWorkbenchSearch(
      new URL(workbenchHref(view, "email_013"), "https://example.test")
        .searchParams,
    );
    const closed = new URL(workbenchHref(open.view), "https://example.test");
    assert.deepEqual(parseWorkbenchSearch(closed.searchParams), {
      view,
      caseId: null,
    });
  }
});

test("empty, overlong and control-character case identifiers are not opened", () => {
  for (const value of ["", "x".repeat(81), "email_013\n", "email_013\u0000"])
    assert.equal(
      parseWorkbenchSearch(new URLSearchParams({ case: value })).caseId,
      null,
    );
  assert.equal(
    parseWorkbenchSearch(new URLSearchParams({ case: "x".repeat(80) })).caseId,
    "x".repeat(80),
  );
});
