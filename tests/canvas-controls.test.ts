import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IconControl, WorkspaceSetup } from "../app/canvas-controls";

const setup = { repositoryReady: false, repositoryName: "example/frontend", githubConnected: false, githubConfigured: false, aiConnected: false, loading: false, onImport() {}, onKey() {} };

test("onboarding presents two named connections with details collapsed", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceSetup, setup));
  assert.equal((html.match(/<article/g) ?? []).length, 2);
  assert.match(html, /Connect your workspace/);
  assert.match(html, /Connect GitHub/);
  assert.match(html, /Add key/);
  assert.match(html, /AI edits need your approval/);
  assert.match(html, /<details class="setup-privacy">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.doesNotMatch(html, /Finish setup|Make a precise design change|setup-gate-kicker/);
});

test("connected AI does not repeat a request to add a key", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceSetup, { ...setup, aiConnected: true }));
  assert.match(html, /Manage connected AI key/);
  assert.doesNotMatch(html, />Add key</);
  assert.match(html, /Connect GitHub/);
});

test("GitHub connection advances to repository import rather than reinstalling", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceSetup, { ...setup, githubConnected: true }));
  assert.match(html, /Choose repo/);
  assert.doesNotMatch(html, /href="\/api\/github/);
});

test("an icon control retains an accessible label and selected or unavailable state", () => {
  const selected = renderToStaticMarkup(createElement(IconControl, { label: "Prototype", explanation: "Follow a link to its destination frame.", active: true }, "icon"));
  assert.match(selected, /aria-label="Prototype"/);
  assert.match(selected, /aria-pressed="true"/);
  const unavailable = renderToStaticMarkup(createElement(IconControl, { label: "Undo", explanation: "Not available yet.", disabled: true }, "icon"));
  assert.match(unavailable, /aria-disabled="true"/);
});
