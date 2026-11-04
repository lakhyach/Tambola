import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../client/src/components/CurrentNumberReveal.jsx", import.meta.url);
const stylesUrl = new URL("../client/src/components.css", import.meta.url);

test("a failed WebGL ball exposes the authoritative DOM number", async () => {
  const [component, styles] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(component, /data-ball-state=\{ballReady \? "ready" : ballFailed \? "error"/);
  assert.match(component, /className="oh-reveal__num"[\s\S]*?\{formatBookingNumber\(number, language\)\}/);
  assert.match(styles, /\.oh-reveal\[data-ball-state="error"\]\s+\.oh-reveal__canvas\s*\{\s*display:\s*none;\s*\}/);
  assert.match(styles, /\.oh-reveal__num\s*\{[\s\S]*?z-index:\s*1/);
});
