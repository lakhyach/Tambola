import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createAdmin } from "../server/admin/index.js";
import { publicInstanceBranding, validateInstanceBranding } from "../server/instances/branding.js";

test("instance branding accepts only curated local logos, bounded copy and hex colors", () => {
  assert.deepEqual(validateInstanceBranding({ logo: "bumper-mark.svg", accent: "#A99BFF", tagline: "Bumper nights" }), {
    branding: { logo: "bumper-mark.svg", tagline: "Bumper nights", accent: "#a99bff" },
  });
  assert.equal(validateInstanceBranding({ logo: "https://example.invalid/logo.svg" }).error, "INVALID_BRANDING");
  assert.deepEqual(validateInstanceBranding({ icon: "regular-mark.svg" }), { branding: { icon: "regular-mark.svg" } });
  assert.equal(validateInstanceBranding({ icon: "https://example.invalid/icon.svg" }).error, "INVALID_BRANDING");
  assert.equal(validateInstanceBranding({ accent: "url(javascript:alert(1))" }).error, "INVALID_BRANDING");
  assert.equal(validateInstanceBranding({ accentBright: "#07110f" }).error, "INVALID_BRANDING");
  assert.equal(validateInstanceBranding({ tagline: "<svg onload=alert(1)>" }).error, "INVALID_BRANDING");
  assert.deepEqual(publicInstanceBranding({ logo: "https://example.invalid/x.svg", accent: "red", secret: "hidden" }), {});
  const contacts = { hostName: "Club Host", hostPhone: "+91 98765 43210", hostWhatsapp: "+91 98765 43210", hostEmail: "host@example.com", agents: [{ name: "Agent One", phone: "+91 91234 56789" }] };
  assert.deepEqual(validateInstanceBranding({ contacts }), { branding: { contacts } });
  assert.deepEqual(publicInstanceBranding({ contacts, privateNotes: "not public" }), { contacts });
  assert.equal(validateInstanceBranding({ contacts: { hostWhatsapp: "javascript:alert(1)" } }).error, "INVALID_BRANDING");
  assert.deepEqual(publicInstanceBranding({ contacts: { hostPhone: "<script>" } }), {});
});

test("public instance directory exposes only active public instance identity", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "publicdir" });
  const stack = env.newProcess();
  const admin = createAdmin({
    db: env.db,
    durable: true,
    registry: stack.registry,
    controller: stack.controller,
    mfaKey: { configured: false, key: null },
    publicOrigin: "https://example.invalid",
  });
  const app = express();
  app.use("/api/admin", admin.router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await env.db.query("UPDATE game_instances SET status='archived',public_visible=false WHERE instance_id='legacy'");
    const directoryResponse = await fetch(`${origin}/api/admin/public/instances`);
    assert.equal(directoryResponse.status, 200);
    const directory = await directoryResponse.json();
    assert.deepEqual(directory.instances.map((row) => row.slug), ["bumper", "regular"]);
    assert.ok(directory.instances.every((row) => !("instance_id" in row)));
    assert.equal(directory.instances.find((row) => row.slug === "bumper").branding.logo, "bumper-mark.svg");
    assert.equal(directory.instances.find((row) => row.slug === "regular").branding.logo, "regular-mark.svg");
    assert.notEqual(directory.instances.find((row) => row.slug === "bumper").branding.accent, directory.instances.find((row) => row.slug === "regular").branding.accent);

    const regularResponse = await fetch(`${origin}/api/admin/public/instances/regular`);
    assert.equal(regularResponse.status, 200);
    const regular = await regularResponse.json();
    assert.equal(regular.instance.display_name, "Regular Tambola");
    assert.equal(regular.instance.branding.logo, "regular-mark.svg");
    await env.db.query("UPDATE game_instances SET branding=$1::jsonb WHERE instance_id='bumper'", [JSON.stringify({ logo: "https://evil.invalid/logo.svg", accent: "url(javascript:alert(1))", hiddenField: "private" })]);
    const sanitized = await fetch(`${origin}/api/admin/public/instances/bumper`).then((response) => response.json());
    assert.deepEqual(sanitized.instance.branding, {}, "public payload revalidates even stored branding");
    assert.equal(regular.instance.branding.logo, "regular-mark.svg", "instance branding remains isolated after another instance changes");

    const legacyResponse = await fetch(`${origin}/api/admin/public/instances/legacy`);
    assert.equal(legacyResponse.status, 404);
    assert.deepEqual(await legacyResponse.json(), { ok: false, code: "INSTANCE_NOT_FOUND", error: "no active public instance" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await env.close();
  }
});
