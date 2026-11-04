import test from "node:test";
import assert from "node:assert/strict";
import { truncatePosterText } from "../client/src/admin/poster-text.js";

test("poster copy stays unchanged when it fits", () => {
  assert.equal(truncatePosterText("Friday at 8 PM", 48), "Friday at 8 PM");
});

test("long poster copy ends at a word boundary with an ellipsis", () => {
  assert.equal(
    truncatePosterText("Disposable local poster fixture for route acceptance.", 48),
    "Disposable local poster fixture for route…",
  );
});

test("long unbroken poster copy is bounded and marked as shortened", () => {
  const result = truncatePosterText("x".repeat(60), 20);
  assert.equal(result, `${"x".repeat(19)}…`);
  assert.equal([...result].length, 20);
});
