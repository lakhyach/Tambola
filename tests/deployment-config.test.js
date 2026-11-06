import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");

/** Run git in this repository, or return null when there is no git metadata to
 * ask (a packaged source tree). Only the "not a git repository" case is
 * tolerated; any other git failure propagates as a test failure. */
function gitOrNothing(args) {
  try {
    return execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" });
  } catch (error) {
    const where = String(error.stderr || error.message || "");
    if (/not a git repository/i.test(where)) return null;
    throw error;
  }
}

const MIGRATIONS_DIR = "server/db/migrations";

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

/**
 * Ninety Club runs on a host that already serves ZANCTA. This file is the whole
 * coexistence contract, so it is asserted rather than trusted: every rule below
 * is a way the game could have been shipped in a form that damages the other
 * application on the box.
 */
test("shared-VPS compose keeps Ninety Club inside its own blast radius", () => {
  const compose = read("deploy/vps-zancta/compose.yaml");
  // Nothing binds a host port, so Traefik stays the only listener on :80/:443.
  assert.doesNotMatch(compose, /^[ \t]+ports:[ \t]*$/m, "publishing a host port can collide with ZANCTA's edge");
  // This host runs without swap; an uncapped leak reaches the OOM killer's
  // choosing, and that choice may be a ZANCTA container.
  assert.match(compose, /mem_limit: 1g/);
  assert.match(compose, /cpus: "1"/);
  assert.match(compose, /ulimits:\s*\n\s+nofile:\s*\n\s+soft:\s+65535\s*\n\s+hard:\s+65535/);
  assert.match(compose, /stop_grace_period: 60s/, "sockets need room to drain on SIGTERM");
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  // Routed only by our own namespaced objects, never by touching ZANCTA's.
  assert.match(compose, /traefik\.docker\.network=proxy/);
  assert.doesNotMatch(compose, /traefik\.http\.routers\.(?!nc-)[a-z]/, "every router must be nc-* namespaced");
  assert.doesNotMatch(compose, /traefik\.http\.middlewares\.(?!nc-)[a-z]/, "every middleware must be nc-* namespaced");
  assert.match(compose, /Host\(`ninetyclub\.cloud`\)/);
  assert.match(compose, /certresolver=le/, "a publicly trusted certificate, not a self-signed one");
  // The edge network belongs to ZANCTA's stack; joining it externally means this
  // project can neither create it nor take it down.
  assert.match(compose, /proxy:\s+external: true/);
  // Secrets are a 600-mode file on the host, never a value in a tracked file.
  assert.match(compose, /env_file:\s+- \/home\/zancta-admin\/ninetyclub\/ninetyclub\.env/);
  assert.doesNotMatch(compose, /(DATABASE_URL|API_KEY|PASSWORD)=/, "no secret may be inlined in compose");
  // Schema changes stay an explicit operator action.
  assert.match(compose, /migrate:\s+(.|\n)*?profiles: \["ops"\]/);
});

/**
 * The production boot gate compares each migration file's sha256 against the
 * ledger and refuses to serve traffic on a mismatch (MIGRATION_DRIFT). That is
 * correct fail-closed behaviour, but it makes line endings an availability
 * concern: Git applying a text conversion to one file - an editor, another
 * operator's core.autocrlf, a renormalize - is enough to stop the game booting.
 *
 * Migrations are therefore frozen bytes once applied, and the repository says
 * so explicitly. (One shipped file already carries historically mixed endings.
 * It is left exactly as it is: normalising it would change its checksum and
 * refuse production, which is the failure this rule exists to prevent.)
 */
test("migration SQL is exempt from line-ending conversion", () => {
  const attributes = read(".gitattributes");
  assert.match(
    attributes,
    /^server\/db\/migrations\/\*\.sql -text$/m,
    "migration SQL must be exempt from text conversion, or a cosmetic checkout can cause MIGRATION_DRIFT"
  );
  // The pin must be the rule that wins for these paths, so no broader `*.sql`
  // text rule may be declared after it.
  const pinLine = attributes.split("\n").findIndex((line) => line.startsWith("server/db/migrations/*.sql -text"));
  const laterSqlTextRule = attributes.split("\n").findIndex((line, index) => index > pinLine && /^\*\.sql\s+text/.test(line));
  assert.equal(laterSqlTextRule, -1, "a later *.sql text rule would override the pin");
});

/**
 * The pin above, resolved instead of merely read.
 *
 * Asserting the sentence in `.gitattributes` proves the file exists; it does not
 * prove the rule wins. `git check-attr` answers the question the checkout
 * actually asks, and it catches every way of losing the exemption - a broader
 * `*.sql text` rule, an `eol=crlf` added for a directory, or a global
 * `core.autocrlf` interacting with a rule the next operator adds.
 */
test("every shipped migration resolves to no text conversion", () => {
  const listed = gitOrNothing(["ls-files", "-z", "--", MIGRATIONS_DIR]);
  if (listed === null) return; // no git metadata: there is no checkout to convert
  const files = listed.split("\0").filter(Boolean).filter((path) => path.endsWith(".sql"));
  assert.ok(files.length > 0, "the migration directory should contain SQL files");
  const report = gitOrNothing(["check-attr", "text", "eol", "--", ...files]).replace(/\r\n/g, "\n");
  const lines = report.split("\n").filter(Boolean);
  assert.equal(lines.length, files.length * 2, "check-attr should answer for each file and attribute");
  for (const line of lines) {
    const [, attribute, value] = line.split(": ");
    if (attribute === "text") {
      // `-text` resolves to `unset`. Anything else - `set`, `auto` - means Git
      // may rewrite the bytes on checkout, and a rewritten applied migration is
      // a refused boot.
      assert.equal(value, "unset", `${line} - text must be unset so the recorded checksum keeps matching`);
    } else {
      // `eol` has no rule for these paths, so it resolves to `unspecified`;
      // `unset` would be acceptable too. What must never appear is a concrete
      // ending, because that turns the conversion back on.
      assert.doesNotMatch(
        line,
        /eol: (crlf|lf|cr)\b/,
        `${line} - a concrete eol for migration SQL would convert it on checkout and break its checksum`
      );
    }
  }
});

/**
 * Drift, caught while it is still only a local file.
 *
 * server/db/migrate.js stores sha256 of the raw migration bytes and the server
 * refuses to serve traffic when the ledger and the file disagree
 * (MIGRATION_DRIFT). An applied migration that has been modified in the working
 * tree - re-saved with different line endings, `git add --renormalize`d,
 * half-reverted - is therefore a build-time trap: the image would ship bytes the
 * production ledger no longer recognises, and the next deploy would not boot.
 * This rehearsal was real, not hypothetical: a locally rebuilt image carried a
 * CRLF-converted `030_indian_poster_presets.sql` and reported drift against a
 * database that had applied the committed version.
 *
 * Untracked files are excluded on purpose. A migration that has never been
 * committed cannot have been applied anywhere, so there is no checksum for it to
 * contradict yet; adding one is normal work, not drift.
 */
test("no committed migration has been modified in the working tree", (t) => {
  const status = gitOrNothing(["status", "--porcelain", "-z", "--", MIGRATIONS_DIR]);
  if (status === null) {
    t.diagnostic("no git metadata in this checkout - nothing to compare the working tree against");
    return;
  }
  const touched = status
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !entry.startsWith("??") && !entry.startsWith("!!"));
  assert.deepEqual(
    touched,
    [],
    "applied migrations are frozen bytes: changing one rewrites its checksum and the next production boot refuses traffic (MIGRATION_DRIFT). Revert the file, or add a new migration instead."
  );
});

