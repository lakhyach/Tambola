import assert from "node:assert/strict";
import test from "node:test";
import { manualVendorChunk } from "../client/vite.config.js";

test("separates Three.js core into a shared lazy vendor chunk on Windows and POSIX paths", () => {
  assert.equal(
    manualVendorChunk("E:\\Projects\\tambolagame\\client\\node_modules\\three\\build\\three.core.js"),
    "three-core",
  );
  assert.equal(
    manualVendorChunk("/workspace/client/node_modules/three/build/three.core.js"),
    "three-core",
  );
  assert.equal(manualVendorChunk("/workspace/client/src/components/ThreeBallRenderer.jsx"), undefined);
});
