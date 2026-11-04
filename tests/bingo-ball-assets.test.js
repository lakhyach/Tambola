import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(project, "client/public/assets/bingo-balls/v1");
const appMapPath = resolve(project, "client/src/assets/bingoBallAssets.json");

test("all numbered bingo ball assets map to the matching Draco GLB root", async () => {
  const mapping = JSON.parse(await readFile(appMapPath, "utf8"));
  assert.equal(mapping.length, 90);
  assert.deepEqual(mapping.map((entry) => entry.number), Array.from({ length: 90 }, (_, i) => i + 1));

  for (const { number, url } of mapping) {
    const filename = `ball-${String(number).padStart(2, "0")}.glb`;
    assert.equal(url, `/assets/bingo-balls/v1/${filename}`);
    const bytes = await readFile(resolve(publicRoot, filename));
    assert.equal(bytes.toString("ascii", 0, 4), "glTF", `${filename} GLB magic`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filename} glTF version`);
    assert.equal(bytes.readUInt32LE(8), bytes.length, `${filename} declared file length`);
    const jsonLength = bytes.readUInt32LE(12);
    const jsonType = bytes.readUInt32LE(16);
    assert.equal(jsonType, 0x4e4f534a, `${filename} JSON chunk`);
    const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
    assert.ok(gltf.extensionsRequired?.includes("KHR_draco_mesh_compression"), `${filename} Draco extension`);
    const root = gltf.nodes.find((node) => node.name === `Ball_${String(number).padStart(2, "0")}`);
    assert.ok(root, `${filename} root name`);
    assert.equal(root.extras?.bingo_number, number, `${filename} bingo_number extra`);
  }
});
