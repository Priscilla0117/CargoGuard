import test from "node:test";
import assert from "node:assert/strict";
import { recoveryRequestAvailability } from "../lib/recovery-storage";
import { RECOVERY_LIMITS } from "../lib/recovery-schema";

const budget = {
  workspaceRemaining: 10,
  dailyRemaining: 50,
  lifetimeRemaining: 93,
  dailyTokensRemaining: 412384,
  lifetimeTokensRemaining: 912384,
  busy: false,
  resetsAt: "2026-09-22T00:00:00.000Z",
};
test("daily increase preserves existing lifetime and concurrency ceilings", () => {
  assert.equal(RECOVERY_LIMITS.workspaceDailyCalls, 10);
  assert.equal(RECOVERY_LIMITS.globalDailyCalls, 50);
  assert.equal(RECOVERY_LIMITS.globalDailyReservedTokens, 500000);
  assert.equal(RECOVERY_LIMITS.globalLifetimeCalls, 100);
  assert.equal(RECOVERY_LIMITS.globalLifetimeReservedTokens, 1000000);
  assert.equal(RECOVERY_LIMITS.concurrentCalls, 2);
});
test("preview includes exact reservation and does not confuse request slots with token capacity", () => {
  assert.deepEqual(recoveryRequestAvailability(budget, 14000), {
    allowed: true,
    cached: false,
    reservedTokens: 14000,
    reason: null,
  });
  const blocked = recoveryRequestAvailability(
    { ...budget, dailyTokensRemaining: 12384 },
    14000,
  );
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason!, /shared daily/);
  assert.match(blocked.reason!, /2026-09-22/);
});
for (const [name, change, reason] of [
  ["workspace", { workspaceRemaining: 0 }, /workspace/],
  ["daily calls", { dailyRemaining: 0 }, /shared daily/],
  ["lifetime calls", { lifetimeRemaining: 0 }, /lifetime/],
  ["lifetime tokens", { lifetimeTokensRemaining: 100 }, /lifetime/],
  ["concurrency", { busy: true }, /already running/],
] as const) {
  test(`preview blocks ${name} while keeping valid workspace cache usable`, () => {
    const blocked = recoveryRequestAvailability(
      { ...budget, ...change },
      14000,
    );
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason!, reason);
    assert.deepEqual(
      recoveryRequestAvailability({ ...budget, ...change }, 14000, true),
      {
        allowed: true,
        cached: true,
        reservedTokens: 0,
        reason: null,
      },
    );
  });
}
test("reservation boundary is inclusive and invalid estimates fail closed", () => {
  assert.equal(
    recoveryRequestAvailability(
      { ...budget, dailyTokensRemaining: 14000 },
      14000,
    ).allowed,
    true,
  );
  assert.equal(
    recoveryRequestAvailability(
      { ...budget, dailyTokensRemaining: 13999 },
      14000,
    ).allowed,
    false,
  );
  for (const invalid of [0, -1, NaN, Infinity, 1.5])
    assert.throws(
      () => recoveryRequestAvailability(budget, invalid),
      /Invalid/,
    );
});
