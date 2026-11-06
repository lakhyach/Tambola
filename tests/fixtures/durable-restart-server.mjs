import { randomBytes } from "node:crypto";
import { createApp } from "../../server/index.js";

let app;

try {
  app = await createApp({
    databaseUrl: process.env.TEST_DATABASE_URL,
    allowPublicHosting: true,
    schema: process.env.TEST_DB_SCHEMA,
    origins: [],
    config: { autoCall: false, callIntervalMs: 60000 },
    mfaKey: { configured: true, key: randomBytes(32) },
    log: () => {},
  });
  const port = await app.listen(0);
  process.send?.({
    type: "ready",
    port,
    recovered: app.recovery.recovered.map((room) => room.roomId),
    frozen: app.recovery.frozen.map((room) => room.roomId),
  });
} catch (error) {
  process.send?.({ type: "error", error: error.message });
  process.exit(1);
}

process.on("message", async (message) => {
  if (message === "crash") process.exit(77);
  if (message === "close") {
    await app?.closeServer();
    process.exit(0);
  }
});
