import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(root, "client/src/main.jsx"), "utf8");

test("public host, waiting-room and caller screens are reachable from their routes", () => {
  assert.match(routes, /import\("\.\/Host\.jsx"\)/);
  assert.match(routes, /import\("\.\/HostRoom\.jsx"\)/);
  assert.match(routes, /import\("\.\/HostGame\.jsx"\)/);
  assert.match(routes, /<Route path="\/host" element={<Host\s*\/>}>[\s\S]*?<Route path="room" element={<HostRoom\s*\/>}\s*\/>[\s\S]*?<Route path="game" element={<HostGame\s*\/>}\s*\/>[\s\S]*?<\/Route>/);
});
