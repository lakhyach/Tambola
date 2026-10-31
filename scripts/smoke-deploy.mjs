/**
 * Post-deployment smoke test.
 *
 * A deploy is not finished when the container reports healthy; it is finished
 * when a browser could open the site, open a socket and start a room. This
 * script answers that from outside the process, using only the public URL.
 *
 * Checks (default profile - safe against a live site, writes nothing durable)
 *   1. GET /livez                 process is up
 *   2. GET /readyz                database reachable, migrations current, lease held
 *   3. GET /healthz               same facts as one object, incl. scheduler state
 *   4. GET /                      the built SPA is being served
 *   5. Socket.IO handshake        the engine answers an EIO=4 polling handshake
 *
 * Opt-in profile (--full) - creates one room and plays it, so run it against a
 * staging URL, not a room full of paying guests:
 *   6. room:create                host seat + session token
 *   7. room:join                  a second seat on a second socket
 *   8. game:start                 tickets issued to both seats
 *   9. game:call-next             both seats receive the same number:called
 *  10. game:end                   the room reaches COMPLETED
 *
 * CLI
 *   node scripts/smoke-deploy.mjs --url https://games.example.com
 *   node scripts/smoke-deploy.mjs --url http://127.0.0.1:4000 --full
 *   node scripts/smoke-deploy.mjs --url $URL --json
 *
 * Exit code 0 when every check passed, 1 otherwise. No credential is read; the
 * URL itself is never printed back (a tunnel URL can be a capability).
 */

import { pathToFileURL } from "node:url";

function arg(name, fallback = null) {
  const at = process.argv.indexOf("--" + name);
  return at === -1 ? fallback : process.argv[at + 1];
}

async function request(url, { timeoutMs, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = performance.now();
    const response = await fetch(url, { signal: controller.signal, headers, redirect: "manual" });
    const body = await response.text();
    return { status: response.status, body, ms: performance.now() - started, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

function jsonOf(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {string} baseUrl absolute origin, no path
 * @param {{timeoutMs?: number, full?: boolean}} [options]
 * @returns {Promise<{ok: boolean, checks: Array<{id:string, ok:boolean, detail:string, ms?:number}>}>}
 */
export async function runSmoke(baseUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const origin = String(baseUrl || "").replace(/\/+$/, "");
  const checks = [];
  const record = (id, ok, detail, ms) => checks.push({ id, ok, detail, ms: ms === undefined ? undefined : Math.round(ms) });
  const url = (path) => origin + path;

  if (!/^https?:\/\/[^/]+$/i.test(origin)) {
    record("url", false, "base URL must be a bare http(s) origin");
    return { ok: false, checks };
  }

  async function probe(id, path, validate) {
    try {
      const response = await request(url(path), { timeoutMs });
      const parsed = jsonOf(response.body);
      const verdict = validate(response, parsed);
      record(id, verdict.ok, verdict.detail, response.ms);
    } catch (error) {
      record(id, false, "unreachable: " + (error && error.name === "AbortError" ? "timeout" : "network error"));
    }
  }

  await probe("livez", "/livez", (response, body) => {
    if (response.status !== 200) return { ok: false, detail: "HTTP " + response.status };
    if (!body || body.live !== true) return { ok: false, detail: "no live:true in the answer" };
    return { ok: true, detail: "process alive" };
  });

  await probe("readyz", "/readyz", (response, body) => {
    if (response.status !== 200) {
      const reasons = body && Array.isArray(body.reasons) ? body.reasons.join(", ") : "no reasons given";
      return { ok: false, detail: "HTTP " + response.status + " (" + reasons + ")" };
    }
    if (!body || body.ready !== true) return { ok: false, detail: "not ready" };
    if (body.durable !== true) return { ok: false, detail: "serving in memory mode; a restart would lose every room" };
    return { ok: true, detail: "durable, lease held" };
  });

  await probe("healthz", "/healthz", (response, body) => {
    if (response.status !== 200) return { ok: false, detail: "HTTP " + response.status };
    const migrations = body && body.migrations; 
    if (!migrations || migrations.current !== true) return { ok: false, detail: "migrations not current" };
    const pending = Array.isArray(migrations.pending) && migrations.pending.length ? " (" + migrations.pending.join(", ") + ")" : "";
    return { ok: true, detail: "schema current" + pending };
  });

  await probe("spa", "/", (response) => {
    if (response.status !== 200) return { ok: false, detail: "HTTP " + response.status };
    const html = response.body || "";
    if (!/<div id="root"/.test(html) && !/<script[^>]+src=/.test(html)) {
      return { ok: false, detail: "answered 200 but not with the built client" };
    }
    return { ok: true, detail: "client bundle served" };
  });

  // A real Engine.IO handshake. Anything that terminates WebSockets (a proxy
  // without upgrade support, a CDN in front of a stale origin) usually breaks
  // here before a player would notice.
  await probe("socket-handshake", "/socket.io/?EIO=4&transport=polling", (response) => {
    if (response.status !== 200) return { ok: false, detail: "HTTP " + response.status };
    if (!/^0\{/.test(response.body || "")) return { ok: false, detail: "unexpected handshake body" };
    return { ok: true, detail: "Socket.IO answers EIO=4" };
  });

  if (options.full) {
    const multiplayer = await runMultiplayer(origin, timeoutMs);
    checks.push(...multiplayer);
  }

  return { ok: checks.every((check) => check.ok), checks };
}

/** One real room, two real sockets, one real call. Opt-in only. */
async function runMultiplayer(origin, timeoutMs) {
  const checks = [];
  const record = (id, ok, detail) => checks.push({ id, ok, detail });

  const { io } = await import("socket.io-client").catch(() => ({ io: null }));
  if (!io) {
    record("multiplayer", false, "socket.io-client is not installed (npm install before --full)");
    return checks;
  }

  const connect = (label) =>
    new Promise((resolve, reject) => {
      const socket = io(origin, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: timeoutMs });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(label + " connect timeout"));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        socket.close();
        reject(error);
      });
    });

  const ask = (socket, event, payload = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ack timeout: " + event)), timeoutMs);
      socket.emit(event, payload, (response) => {
        clearTimeout(timer);
        resolve(response || { ok: false, error: "empty ack" });
      });
    });

  let host;
  let guest;
  try {
    host = await connect("host");
    record("multiplayer.host-socket", true, "websocket connected");

    const created = await ask(host, "room:create", { name: "SmokeHost" });
    record("multiplayer.room-create", created.ok === true, created.ok ? "room created" : "refused: " + (created.code || "unknown"));
    if (!created.ok) return checks;

    guest = await connect("guest");
    const joined = await ask(guest, "room:join", { roomId: created.roomId, name: "SmokeGuest" });
    record("multiplayer.room-join", joined.ok === true, joined.ok ? "second seat seated" : "refused: " + (joined.code || "unknown"));
    if (!joined.ok) return checks;

    const heard = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      guest.once("number:called", (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    const started = await ask(host, "game:start");
    record("multiplayer.game-start", started.ok === true, started.ok ? "tickets issued" : "refused: " + (started.code || "unknown"));
    if (!started.ok) return checks;

    const called = await ask(host, "game:call-next");
    const broadcast = await heard;
    const mirrored = Boolean(called.ok && broadcast && broadcast.number === called.number);
    record(
      "multiplayer.call-fanout",
      mirrored,
      mirrored ? "both seats saw number " + called.number : "the guest seat did not receive the call"
    );

    const ended = await ask(host, "game:end");
    record("multiplayer.game-end", ended.ok === true, ended.ok ? "room completed" : "refused: " + (ended.code || "unknown"));
  } catch (error) {
    record("multiplayer", false, "aborted: " + (error && error.message));
  } finally {
    if (guest) guest.close();
    if (host) host.close();
  }
  return checks;
}

export function formatSmoke(result) {
  const lines = ["Tambola deployment smoke test"];
  for (const check of result.checks) {
    lines.push("  " + (check.ok ? "PASS" : "FAIL") + "  " + check.id.padEnd(24) + " " + check.detail + (check.ms !== undefined ? " (" + check.ms + "ms)" : ""));
  }
  lines.push("  " + (result.ok ? "RESULT: PASS" : "RESULT: FAIL"));
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = arg("url") || process.env.SMOKE_URL || "http://127.0.0.1:4000";
  const result = await runSmoke(url, { full: process.argv.includes("--full"), timeoutMs: Number(arg("timeout", "8000")) || 8000 });
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(formatSmoke(result));
  process.exitCode = result.ok ? 0 : 1;
}
