import test from "node:test";
import assert from "node:assert/strict";
import { createBallLoader } from "../client/src/lib/ball-loader.js";

test("each called ball receives a fresh Draco/GLTF loader and disposal is safe", () => {
  const first = createBallLoader();
  const second = createBallLoader();

  assert.notEqual(first, second);
  assert.notEqual(first.loader, second.loader, "GLTF parsing state is not reused across calls");
  assert.equal(typeof first.dispose, "function");
  assert.equal(typeof second.dispose, "function");

  assert.doesNotThrow(() => first.dispose());
  assert.doesNotThrow(() => first.dispose(), "disposing during cleanup is idempotent");
  assert.doesNotThrow(() => second.dispose());
});
