import { randomBytes } from "node:crypto";
import { createPool } from "../server/db/pool.js";
import { migrate } from "../server/db/migrate.js";
import { createOwnerStore } from "../server/admin/owner-store.js";
import { hashPassword } from "../server/admin/password.js";

const connectionString = process.env.QA_DATABASE_URL;
const ownerPassword = process.env.QA_OWNER_PASSWORD;
if (!connectionString || !ownerPassword) throw new Error("QA_DATABASE_URL and QA_OWNER_PASSWORD are required for the isolated browser harness.");
const parsed = new URL(connectionString);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) || parsed.port !== "55439" || parsed.pathname !== "/postgres") {
  throw new Error("Browser QA is restricted to the disposable local PostgreSQL 17 database on port 55439.");
}

const schema = `browser_qa_${randomBytes(6).toString("hex")}`;
const control = createPool({ connectionString, schema: "public", applicationName: "tambola-browser-qa-setup" });
let app;
let schemaCreated = false;
let shuttingDown = false;
try {
  await control.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  const db = createPool({ connectionString, schema, applicationName: "tambola-browser-qa-seed" });
  await migrate({ db });
  const ownerStore = createOwnerStore({ db });
  await ownerStore.create({ username: "qa.owner", passwordHash: await hashPassword(ownerPassword), role: "super_admin" });
  await db.end();

  process.env.DATABASE_URL = connectionString;
  process.env.DB_SCHEMA = schema;
  process.env.AUTO_MIGRATE = "0";
  process.env.NODE_ENV = "development";
  process.env.OWNER_MFA_KEY = "";
  process.env.MFA_ISSUER = "Ninety Club QA";
  process.env.LOG_LEVEL = "error";
  delete process.env.ALLOW_MEMORY_ONLY;
  const { createApp } = await import("../server/index.js");
  app = await createApp({ production: false, mfaKey: { configured: false, key: null }, origins: [], log: () => {} });
  const port = await app.listen(4173);
  console.log(`ISOLATED_QA_APP_READY port=${port}`);

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (app) await app.closeServer({ closeRoomsDurably: false }).catch(() => {});
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await control.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
} catch (error) {
  if (schemaCreated) await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  await control.end().catch(() => {});
  throw error;
}
