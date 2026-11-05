import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");

test("free-start keeps the trusted-proxy app port on host loopback", () => {
  const script = read("deploy/free-start.ps1");
  assert.match(script, /-p\s+"127\.0\.0\.1:\$\{Port\}:4000"/);
  assert.doesNotMatch(script, /-p\s+"\$\{Port\}:4000"/);
  assert.match(script, /tunnel.*--url.*http:\/\/127\.0\.0\.1:\$Port/);
  assert.match(script, /-e\s+"MFA_ISSUER=Ninety Club"/);
  assert.doesNotMatch(script, /MFA_ISSUER=Tambola/);
});

test("Hostinger Compose keeps the database private and app ingress on loopback", () => {
  const compose = read("deploy/hostinger/compose.yml");
  assert.match(compose, /ports:\s*\n\s*- "127\.0\.0\.1:4000:4000"/);
  assert.match(compose, /DATABASE_PRIVATE_NETWORK:\s*"1"/);
  assert.match(compose, /networks:\s*\[tambola, database\]/);
  assert.match(compose, /database:\s*\n\s+internal:\s+true/);
  assert.match(compose, /OPENAI_API_KEY:/);
  assert.match(compose, /SARVAM_API_KEY:/);
  assert.match(compose, /read_only:\s+true/);
  assert.doesNotMatch(compose, /container_name:/, "project-scoped names keep disposable/staging stacks isolated");
  const db = compose.split("\n  app:")[0];
  assert.doesNotMatch(db, /^\s+ports:/m);
  const caddy = read("deploy/hostinger/Caddyfile.example");
  assert.match(caddy, /Strict-Transport-Security/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:4000/);
});

test("generic Docker Compose keeps trusted-proxy app ingress on host loopback", () => {
  const compose = read("docker-compose.yml");
  assert.match(compose, /TRUST_PROXY:\s*\$\{TRUST_PROXY:-1\}/);
  assert.match(compose, /ports:\s*\n\s*- "127\.0\.0\.1:4000:4000"/);
  assert.doesNotMatch(compose, /- "4000:4000"/);
  assert.match(compose, /POSTGRES_PASSWORD.*URL-safe/);
  assert.match(compose, /openssl rand -hex 32/);
});

test("documented standalone Docker command publishes only to host loopback", () => {
  const deployment = read("DEPLOYMENT.md");
  const dockerfile = read("Dockerfile");
  assert.match(deployment, /docker run[^\n]*-p 127\.0\.0\.1:4000:4000/);
  assert.match(dockerfile, /docker run[^\n]*-p 127\.0\.0\.1:4000:4000/);
  assert.doesNotMatch(deployment, /docker run[^\n]*-p 4000:4000/);
  assert.match(deployment, /POSTGRES_PASSWORD/);
  assert.match(deployment, /URL-safe\s+characters/);
});

test("Render uses the current MFA authenticator brand", () => {
  const render = read("deploy/render.yaml");
  assert.match(render, /- key: MFA_ISSUER\s+value: Ninety Club/);
  assert.doesNotMatch(render, /MFA_ISSUER[\s\S]{0,80}value: Tambola/);
});

test("Render requires the operator to supply its public origin", () => {
  const render = read("deploy/render.yaml");
  assert.match(render, /- key: PUBLIC_ORIGIN\s+sync: false/);
  assert.doesNotMatch(render, /PUBLIC_ORIGIN[\s\S]{0,100}REPLACE-ME/);
});
