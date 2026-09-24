import assert from "node:assert/strict";
import test from "node:test";
import {
  loadOfficeRuntime,
  preserveOfficeHistory,
} from "../lib/office-runtime";

function fixture() {
  const calls: { method: string; receiver: unknown; args: unknown[] }[] = [];
  const history = {
    pushState(this: unknown, ...args: unknown[]) {
      calls.push({ method: "push", receiver: this, args });
    },
    replaceState(this: unknown, ...args: unknown[]) {
      calls.push({ method: "replace", receiver: this, args });
    },
  } as History;
  class Script extends EventTarget {
    src = "";
    async = false;
    removed = false;
    remove() {
      this.removed = true;
    }
  }
  const scripts: Script[] = [];
  let appendError: Error | null = null;
  const owner = {
    createElement(tag: string) {
      assert.equal(tag, "script");
      return new Script();
    },
    head: {
      appendChild(script: Script) {
        if (appendError) throw appendError;
        scripts.push(script);
        return script;
      },
    },
  } as unknown as Document;
  return {
    history,
    browser: { history },
    calls,
    owner,
    scripts,
    failAppend(error: Error | null) {
      appendError = error;
    },
  };
}

function simulateOfficeHistoryMutation(history: History) {
  Object.assign(history, { pushState: null, replaceState: null });
}

test("Office history restoration preserves router wrappers, receiver and navigation arguments", () => {
  const { history, calls } = fixture();
  const push = history.pushState;
  const replace = history.replaceState;
  const restore = preserveOfficeHistory(history);
  simulateOfficeHistoryMutation(history);
  restore();
  assert.equal(history.pushState, push);
  assert.equal(history.replaceState, replace);
  const state = { __NA: true, tree: ["shipments"] };
  history.pushState(state, "", "/shipments");
  history.replaceState(state, "", "/?case=example");
  assert.deepEqual(calls, [
    { method: "push", receiver: history, args: [state, "", "/shipments"] },
    {
      method: "replace",
      receiver: history,
      args: [state, "", "/?case=example"],
    },
  ]);
});

test("Office restoration leaves newer working router wrappers in place", () => {
  const { history } = fixture();
  const restore = preserveOfficeHistory(history);
  const newerPush = () => {};
  const newerReplace = () => {};
  history.pushState = newerPush;
  history.replaceState = newerReplace;
  restore();
  restore();
  assert.equal(history.pushState, newerPush);
  assert.equal(history.replaceState, newerReplace);
});

test("Office script restores navigation synchronously on load and is reused on remount", async () => {
  const { browser, owner, history, scripts } = fixture();
  const push = history.pushState;
  const replace = history.replaceState;
  const first = loadOfficeRuntime(browser, owner);
  assert.equal(loadOfficeRuntime(browser, owner), first);
  assert.equal(scripts.length, 1);
  assert.equal(
    scripts[0].src,
    "https://appsforoffice.microsoft.com/lib/1/hosted/office.js",
  );
  assert.equal(scripts[0].async, true);
  simulateOfficeHistoryMutation(history);
  scripts[0].dispatchEvent(new Event("load"));
  // Must happen inside the script event, before promise callbacks/Office.onReady.
  assert.equal(history.pushState, push);
  assert.equal(history.replaceState, replace);
  await first;
  assert.equal(loadOfficeRuntime(browser, owner), first);
  assert.equal(scripts.length, 1);
});

test("Office script completion restores history even after its consumer leaves the route", async () => {
  const { browser, owner, history, scripts } = fixture();
  const push = history.pushState;
  const loading = loadOfficeRuntime(browser, owner);
  let mounted = true;
  let consumerCalls = 0;
  const consumer = loading.then(() => {
    if (mounted) consumerCalls++;
  });
  mounted = false;
  simulateOfficeHistoryMutation(history);
  scripts[0].dispatchEvent(new Event("load"));
  assert.equal(history.pushState, push);
  assert.equal(typeof history.replaceState, "function");
  await consumer;
  assert.equal(consumerCalls, 0);
});

test("Office load failure restores history, removes the failed script and permits retry", async () => {
  const { browser, owner, history, scripts } = fixture();
  const push = history.pushState;
  const first = loadOfficeRuntime(browser, owner);
  const rejection = assert.rejects(first, /Office runtime is unavailable/);
  simulateOfficeHistoryMutation(history);
  scripts[0].dispatchEvent(new Event("error"));
  assert.equal(history.pushState, push);
  assert.equal(typeof history.replaceState, "function");
  assert.equal(scripts[0].removed, true);
  await rejection;
  const retry = loadOfficeRuntime(browser, owner);
  assert.notEqual(retry, first);
  assert.equal(scripts.length, 2);
  // A late event on the failed script cannot settle or clear the new attempt.
  scripts[0].dispatchEvent(new Event("load"));
  assert.equal(loadOfficeRuntime(browser, owner), retry);
  simulateOfficeHistoryMutation(history);
  scripts[1].dispatchEvent(new Event("load"));
  await retry;
  assert.equal(history.pushState, push);
});

test("Office insertion errors do not poison the cached loader", async () => {
  const { browser, owner, scripts, failAppend } = fixture();
  failAppend(new Error("Script insertion failed"));
  await assert.rejects(
    loadOfficeRuntime(browser, owner),
    /Script insertion failed/,
  );
  failAppend(null);
  const retry = loadOfficeRuntime(browser, owner);
  assert.equal(scripts.length, 1);
  scripts[0].dispatchEvent(new Event("load"));
  await retry;
});

test("Office loader refuses to cache already broken history methods", async () => {
  const { browser, owner, history, scripts } = fixture();
  simulateOfficeHistoryMutation(history);
  await assert.rejects(
    loadOfficeRuntime(browser, owner),
    /Reload this workspace/,
  );
  assert.equal(scripts.length, 0);
});
