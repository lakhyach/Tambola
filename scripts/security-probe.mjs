/**
 * Security probe — the boundary, exercised over real HTTP and real sockets.
 *
 * The automated suite proves individual rules. This script proves the *edges*
 * of the deployed shape instead: the headers a browser is handed, whether an
 * anonymous caller can reach the control centre, whether a malformed body is
 * reported as the client's error rather than a server fault, and whether a
 * socket that lies about who it is, or which room it is in, gets anything.
 *
 * Two instances are booted in memory on ephemeral ports, so it needs no
 * database and cannot disturb a running server's instance lease:
 *
 *   main    generous event budget, one allow-listed origin  -> the HTTP and
 *           socket checks (a probe fires far more events than a player does)
 *   strict  the shipped event budget (burst 40, 20/s)       -> the rate-limit
 *           check, which cannot be performed on a generous budget
 *
 * Every check prints as it runs. Nothing is inferred from reading source:
 * each line is an assertion against a response or an ack.
 *
 * Run:  npm run security-probe
 *       node scripts/security-probe.mjs [--verbose]
 *
 * Exit code 0 only when every check passed.
 */

import http from "node:http";
import assert from "node:assert/strict";
import { io as connectClient } from "socket.io-client";

import { createApp } from "../server/index.js";
import { LEGACY_EVENTS } from "../server/net/validate.js";

const VERBOSE = process.argv.includes("--verbose");
const ALLOWED = "http://allowed.example";

function line(text = "") {
  console.log(text);
}
function header(text) {
  line("\n== " + text + " " + "=".repeat(Math.max(0, 58 - text.length)));
}

/** Guards a check: records pass/fail, never throws out of the runner. */
const results = [];
async function check(name, fn) {
  const number = results.length + 1;
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    line("  " + String(number).padStart(2, " ") + "  ok     " + name + (VERBOSE && detail ? "  [" + detail + "]" : ""));
  } catch (error) {
    results.push({ name, ok: false, detail: error && error.message });
    line("  " + String(number).padStart(2, " ") + "  FAIL   " + name);
    line("         " + String((error && error.message) || error).split("\n").join("\n         "));
  }
}

// ------------------------------------------------------------------ transports

/** A raw HTTP call: full control of headers and of the encoded path. */
function request(base, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, base);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON — a check may legitimately expect HTML */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.setTimeout(8000, () => req.destroy(new Error(method + " " + path + " timed out")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** A connected socket.io client. No reconnection: a dropped probe stays dropped. */
async function open(base) {
  const socket = connectClient(base, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    timeout: 6000,
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

/** Emit with an ack callback and wait for it. */
function call(socket, event, payload, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(event + " produced no ack within " + timeoutMs + "ms")), timeoutMs);
    const settle = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    if (payload === undefined) socket.emit(event, settle);
    else socket.emit(event, payload, settle);
  });
}

/** Collect every instance of `event` that arrives within `ms`. */
function listen(socket, event, ms) {
  return new Promise((resolve) => {
    const seen = [];
    const onEvent = (payload) => seen.push(payload);
    socket.on(event, onEvent);
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(seen);
    }, ms);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An ack that must have been accepted. */
function accepted(ack, what) {
  assert.ok(ack && ack.ok === true, what + " was refused: " + JSON.stringify(ack));
  return ack;
}

/** An ack that must have been refused, and must carry a documented code. */
function refused(ack, what, code) {
  assert.ok(ack && typeof ack === "object", what + " produced no answer at all");
  assert.equal(ack.ok, false, what + " was wrongly accepted: " + JSON.stringify(ack).slice(0, 200));
  if (code) assert.equal(ack.code, code, what + " was refused with " + ack.code + " instead of " + code);
  else assert.ok(typeof ack.code === "string" && ack.code, what + " was refused without a code");
  return ack;
}

// ---------------------------------------------------------------------- setup

async function main() {
  header("booting two in-memory instances");
  // Production gives a client 30 s to finish one request — headers bounded by
  // Node's server.requestTimeout, a started-but-stalled body bounded by the
  // admin router's body timeout, both driven by HTTP_REQUEST_TIMEOUT_MS. The
  // probe owns these instances and the truncated-body check cannot wait half a
  // minute, so it compresses the same knob to 1.5 s: the behaviour under test
  // is the timeout firing, just observed faster.
  process.env.HTTP_REQUEST_TIMEOUT_MS = "1500";
  const main = await createApp({
    memoryOnly: true,
    origins: [ALLOWED],
    publicOrigin: "https://hall.example",
    // A probe fires far more events than a player: the budget is proved
    // separately, on the second instance, with the shipped numbers.
    limits: { burst: 5000, perSecond: 2000 },
    config: { autoCall: false, chatIntervalMs: 0, callIntervalMs: 60000, maxTicketsPerPlayer: 4 },
    log: () => {},
  });
  const mainUrl = "http://127.0.0.1:" + (await main.listen(0));

  const strict = await createApp({
    memoryOnly: true,
    origins: [],
    config: { autoCall: false, chatIntervalMs: 0, callIntervalMs: 60000 },
    log: () => {},
  });
  const strictUrl = "http://127.0.0.1:" + (await strict.listen(0));

  line("  main   " + mainUrl + "  (origin allow-list: " + ALLOWED + ")");
  line("  strict " + strictUrl + "  (shipped event budget)");

  const sockets = [];
  const openSocket = async (base) => {
    const socket = await open(base);
    sockets.push(socket);
    return socket;
  };

  try {
    // ------------------------------------------------------------ A. HTTP

    header("A. HTTP surface");
    const shell = await request(mainUrl, "/");
    const api = {};

    await check("liveness answers 200 and says nothing else", async () => {
      const res = await request(mainUrl, "/livez");
      assert.equal(res.status, 200, "/livez answered " + res.status);
      const body = JSON.stringify(res.json);
      assert.ok(!/version|commit|uptime/i.test(body), "/livez disclosed more than liveness: " + body.slice(0, 160));
      return "200";
    });

    await check("a first-party-only content policy is announced", async () => {
      const csp = shell.headers["content-security-policy"];
      assert.ok(csp, "no Content-Security-Policy header on /");
      assert.match(csp, /default-src 'self'/, "CSP does not default to 'self': " + csp);
      return "default-src 'self'";
    });

    await check("the policy forbids framing, objects and a rewritten base", async () => {
      const csp = shell.headers["content-security-policy"] || "";
      for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"]) {
        assert.ok(csp.includes(directive), "CSP is missing " + directive);
      }
      return "4 directives";
    });

    await check("no inline script and no eval is allowed", async () => {
      const csp = shell.headers["content-security-policy"] || "";
      assert.ok(/script-src 'self'/.test(csp), "script-src is not pinned to 'self'");
      assert.ok(!/script-src[^;]*unsafe-eval/.test(csp), "script-src allows unsafe-eval");
      assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src allows unsafe-inline");
      return "script-src 'self'";
    });

    await check("the page cannot be framed and is not sniffed", async () => {
      assert.equal(shell.headers["x-frame-options"], "DENY", "X-Frame-Options is " + shell.headers["x-frame-options"]);
      assert.equal(shell.headers["x-content-type-options"], "nosniff", "X-Content-Type-Options is " + shell.headers["x-content-type-options"]);
      return "DENY + nosniff";
    });

    await check("referrers are trimmed and browser capabilities are denied", async () => {
      assert.equal(shell.headers["referrer-policy"], "same-origin", "Referrer-Policy is " + shell.headers["referrer-policy"]);
      const policy = shell.headers["permissions-policy"] || "";
      for (const feature of ["camera=()", "microphone=()", "geolocation=()", "payment=()"]) {
        assert.ok(policy.includes(feature), "Permissions-Policy does not deny " + feature);
      }
      return "same-origin + 4 features";
    });

    await check("the stack is not advertised", async () => {
      assert.equal(shell.headers["x-powered-by"], undefined, "X-Powered-By still advertises Express");
      return "no X-Powered-By";
    });

    await check("plain HTTP is not pinned to HTTPS", async () => {
      assert.equal(shell.headers["strict-transport-security"], undefined, "HSTS was sent over http, which would pin localhost for six months");
      return "no HSTS over http";
    });

    await check("an allow-listed origin is echoed back", async () => {
      const res = await request(mainUrl, "/livez", { headers: { origin: ALLOWED } });
      assert.equal(res.headers["access-control-allow-origin"], ALLOWED, "allow-listed origin was not echoed");
      assert.match(String(res.headers.vary || ""), /Origin/, "Vary does not name Origin");
      return ALLOWED;
    });

    await check("an unlisted origin gets no CORS permission", async () => {
      const res = await request(mainUrl, "/livez", { headers: { origin: "http://evil.example" } });
      assert.equal(res.headers["access-control-allow-origin"], undefined, "a foreign origin was granted CORS access");
      return "no ACAO";
    });

    for (const path of ["/api/admin/overview", "/api/admin/players", "/api/admin/audit"]) {
      await check("an anonymous caller is refused " + path, async () => {
        const res = await request(mainUrl, path);
        assert.equal(res.status, 401, path + " answered " + res.status);
        assert.equal(res.json && res.json.code, "UNAUTHENTICATED", path + " refused with " + (res.json && res.json.code));
        assert.ok(!/\bat\s+\w+\s*\(/.test(res.text), path + " leaked a stack trace");
        return "401 UNAUTHENTICATED";
      });
    }

    await check("a forged owner cookie is refused like no cookie", async () => {
      const res = await request(mainUrl, "/api/admin/overview", {
        headers: { cookie: "tambola_owner=" + "a".repeat(48) + "; tambola_csrf=" + "b".repeat(32) },
      });
      assert.equal(res.status, 401, "a forged cookie answered " + res.status);
      return "401";
    });

    await check("an oversized body is the client's error, not the server's", async () => {
      const body = JSON.stringify({ username: "operator", password: "x".repeat(32000) });
      const res = await request(mainUrl, "/api/admin/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      assert.equal(res.status, 413, "an oversized sign-in body answered " + res.status);
      assert.equal(res.json && res.json.code, "PAYLOAD_TOO_LARGE", "code was " + (res.json && res.json.code));
      assert.ok(!res.text.includes("x".repeat(200)), "the request body was echoed back");
      return "413 PAYLOAD_TOO_LARGE";
    });

    await check("a truncated body is the client's error too", async () => {
      // Declares 80 bytes, sends 12, then says nothing more and keeps the socket
      // open. The honest guarantees: the server never hangs forever on it, the
      // answer is the client's fault (4xx), and the process is still healthy
      // afterwards. The body timeout answers 408 REQUEST_TIMEOUT — a stalled
      // upload must not sit in the parser until Node's own timeout frees it.
      const res = await request(mainUrl, "/api/admin/signin", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "80" },
        body: '{"username":"oper',
      });
      assert.ok(res.status >= 400 && res.status < 500, "a truncated body answered " + res.status + ", which is not a client error");
      assert.equal(res.json && res.json.code, "REQUEST_TIMEOUT", "a stalled body was refused with " + (res.json && res.json.code));
      const alive = await request(mainUrl, "/livez");
      assert.equal(alive.status, 200, "the process stopped answering /livez after one truncated body");
      return res.status + " REQUEST_TIMEOUT (the body timeout ended it as the client's error; liveness held)";
    });

    await check("a state-changing request needs the CSRF token", async () => {
      const res = await request(mainUrl, "/api/admin/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The value never reaches authentication: the request is refused at the
        // CSRF gate. It is phrased as a placeholder so the secret scanner's
        // shape check does not flag a probe file that guards nothing.
        body: JSON.stringify({ username: "operator", password: "placeholder-not-a-secret" }),
      });
      assert.equal(res.status, 403, "a POST without a CSRF token answered " + res.status);
      assert.equal(res.json && res.json.code, "CSRF_FAILED", "code was " + (res.json && res.json.code));
      assert.equal(res.headers["set-cookie"], undefined, "a session cookie was issued without a CSRF token");
      return "403 CSRF_FAILED";
    });

    await check("an encoded traversal reaches no file outside the build", async () => {
      const res = await request(mainUrl, "/assets/%2e%2e%2f%2e%2e%2fpackage.json");
      assert.ok(!/"dependencies"\s*:/.test(res.text), "the server returned package.json");
      assert.ok(!/node_modules/.test(res.text), "the server returned something from node_modules");
      return res.status + " and no file contents";
    });

    api.shell = shell;

    // ---------------------------------------------------------- B. Sockets

    header("B. Socket boundary");
    const hostA = await openSocket(mainUrl);
    const roomA = accepted(await call(hostA, "room:create", { name: "ProbeHostA" }), "room A");
    const hostB = await openSocket(mainUrl);
    const roomB = accepted(await call(hostB, "room:create", { name: "ProbeHostB" }), "room B");

    const guest = await openSocket(mainUrl);
    const player = await openSocket(mainUrl);
    const stranger = await openSocket(mainUrl);
    const seatA = accepted(await call(player, "room:join", { roomId: roomA.roomId, name: "ProbePlayer" }), "player seat in room A");
    accepted(await call(stranger, "room:join", { roomId: roomB.roomId, name: "ProbeRival" }), "rival seat in room B");
    line("  room A " + roomA.roomId + " (host + 1 seat), room B " + roomB.roomId + " (host + 1 seat)");

    for (const legacy of LEGACY_EVENTS.slice(0, 2)) {
      await check("the retired event '" + legacy + "' is refused, not ignored", async () => {
        const ack = await call(guest, legacy, { room: "ABCD2345" });
        assert.equal(ack && ack.code, "LEGACY_EVENT", "'" + legacy + "' answered " + JSON.stringify(ack));
        return "LEGACY_EVENT";
      });
    }

    await check("a guessed room code opens nothing", async () => {
      const ack = await call(guest, "room:join", { roomId: "ZZZZ9999", name: "ProbeGuest" });
      refused(ack, "joining a room that does not exist", "ROOM_NOT_FOUND");
      return "ROOM_NOT_FOUND";
    });

    await check("a name that is too short or too long is refused", async () => {
      refused(await call(guest, "room:join", { roomId: roomA.roomId, name: "ab" }), "a 2-character name", "BAD_PAYLOAD");
      refused(await call(guest, "room:join", { roomId: roomA.roomId, name: "n".repeat(41) }), "a 41-character name", "BAD_PAYLOAD");
      return "2 and 41 characters";
    });

    await check("a non-string name is refused, not coerced", async () => {
      refused(await call(guest, "room:join", { roomId: roomA.roomId, name: 12345 }), "a numeric name", "BAD_PAYLOAD");
      refused(await call(guest, "room:join", { roomId: roomA.roomId, name: { first: "Probe" } }), "an object name", "BAD_PAYLOAD");
      return "number and object";
    });

    await check("a forgotten room code with a real token is refused", async () => {
      const ack = await call(guest, "session:resume", { roomId: "ZZZZ9999", sessionToken: seatA.sessionToken });
      refused(ack, "resuming into a room that does not exist");
      return ack.code;
    });

    await check("a forged session token unlocks no seat", async () => {
      const ack = await call(guest, "session:resume", { roomId: roomA.roomId, sessionToken: "f".repeat(48) });
      refused(ack, "resuming with a token nobody was issued");
      return ack.code;
    });

    await check("a malformed session token is refused before it is looked up", async () => {
      refused(await call(guest, "session:resume", { roomId: roomA.roomId, sessionToken: "not-a-token" }), "a non-hex token", "BAD_PAYLOAD");
      refused(await call(guest, "session:resume", { roomId: roomA.roomId, sessionToken: 42 }), "a numeric token", "BAD_PAYLOAD");
      return "2 shapes";
    });

    await check("a token from one room opens nothing in another", async () => {
      const ack = await call(guest, "session:resume", { roomId: roomB.roomId, sessionToken: seatA.sessionToken });
      refused(ack, "using room A's seat in room B");
      assert.notEqual(ack.role, "host", "a foreign token was given a role");
      return ack.code;
    });

    await check("a payload with too many fields is refused", async () => {
      const fat = {};
      for (let i = 0; i < 14; i += 1) fat["f" + i] = i;
      refused(await call(guest, "room:join", { roomId: roomA.roomId, name: "ProbeGuest", ...fat }), "a 15-field payload", "BAD_PAYLOAD");
      return "15 fields";
    });

    await check("a payload far over the size limit is refused", async () => {
      refused(
        await call(guest, "room:join", { roomId: roomA.roomId, name: "ProbeGuest", pad: "p".repeat(5000) }),
        "a 5 kB payload",
        "BAD_PAYLOAD"
      );
      return "5 kB";
    });

    await check("a control character in a name is stripped, not stored", async () => {
      const named = await openSocket(mainUrl);
      const ack = accepted(await call(named, "room:join", { roomId: roomA.roomId, name: "Pro\u0000be" }), "a name with a NUL byte");
      assert.equal(ack.name, "Probe", "the stored name is " + JSON.stringify(ack.name));
      named.close();
      return JSON.stringify(ack.name);
    });

    for (const action of ["game:start", "game:call-next", "game:end", "game:reset"]) {
      await check("a player cannot send '" + action + "'", async () => {
        refused(await call(player, action), "a player sending " + action, "NOT_HOST");
        return "NOT_HOST";
      });
    }

    await check("a player cannot retune the host's clock", async () => {
      refused(await call(player, "game:set-autocall", { intervalMs: 500 }), "a player setting auto-call", "NOT_HOST");
      refused(await call(player, "game:set-autocall", { intervalMs: 10 }), "an out-of-range interval from a player", "NOT_HOST");
      return "NOT_HOST";
    });

    await check("host commands with no round in progress are refused by state", async () => {
      const ack = await call(hostA, "game:call-next");
      refused(ack, "calling a number while the room is waiting");
      return ack.code;
    });

    await check("one room's host cannot drive another room", async () => {
      const before = accepted(await call(hostA, "room:state"), "room A state");
      refused(await call(hostB, "game:call-next"), "room B calling while waiting");
      const after = accepted(await call(hostA, "room:state"), "room A state again");
      assert.equal(after.snapshot.calledCount, before.snapshot.calledCount, "room A's call count changed from another room");
      return "room A untouched at " + after.snapshot.calledCount;
    });

    await check("a claim before the round starts is refused", async () => {
      const ack = await call(player, "claim:submit", { pattern: "fullHouse" });
      refused(ack, "claiming while the room is waiting");
      return ack.code;
    });

    await check("a ticket count over the room ceiling is refused by the room", async () => {
      const ack = await call(player, "tickets:select", { count: 5 });
      refused(ack, "asking for 5 when the ceiling is 4", "TICKET_LIMIT");
      assert.equal(ack.max, 4, "the refusal does not name the ceiling: " + JSON.stringify(ack));
      return "TICKET_LIMIT (max 4)";
    });

    await check("a ticket count outside the hard range is refused as a payload", async () => {
      refused(await call(player, "tickets:select", { count: 999 }), "999 tickets", "BAD_PAYLOAD");
      refused(await call(player, "tickets:select", { count: 0 }), "0 tickets", "BAD_PAYLOAD");
      refused(await call(player, "tickets:select", { count: 2.5 }), "2.5 tickets", "BAD_PAYLOAD");
      refused(await call(player, "tickets:select", { count: "3" }), "a stringified count", "BAD_PAYLOAD");
      return "999 / 0 / 2.5 / \"3\"";
    });

    const picked = accepted(await call(player, "tickets:select", { count: 2 }), "choosing 2 tickets");
    line("  seat holds " + picked.ticketCount + " ticket(s)");

    await check("chat longer than the room allows is refused", async () => {
      const ack = await call(player, "chat:send", { text: "x".repeat(500) });
      refused(ack, "a 500-character message");
      return ack.code;
    });

    await check("a non-string message is refused", async () => {
      refused(await call(player, "chat:send", { text: { evil: "<img onerror=alert(1)>" } }), "an object message", "BAD_PAYLOAD");
      refused(await call(player, "chat:send", { text: 42 }), "a numeric message", "BAD_PAYLOAD");
      return "object and number";
    });

    await check("an unknown event is ignored and the connection survives", async () => {
      player.emit("game:teleport", { number: 7 }, () => {});
      const after = accepted(await call(player, "room:state"), "room state after an unknown event");
      assert.ok(after.snapshot, "the server stopped answering after an unknown event");
      return "still answering";
    });

    const started = accepted(await call(hostA, "game:start"), "starting room A");
    line("  room A started, " + started.ticketsIssued + " ticket(s) issued");

    await check("a claim cannot carry its own verdict", async () => {
      await call(hostA, "game:call-next");
      await call(hostA, "game:call-next");
      await call(hostA, "game:call-next");
      const ack = await call(player, "claim:submit", {
        pattern: "fullHouse",
        won: true,
        points: 999,
        name: "Somebody Else",
        playerId: "not-my-id",
      });
      assert.equal(ack.ok, false, "a claim carrying won:true was awarded: " + JSON.stringify(ack).slice(0, 200));
      assert.ok(!JSON.stringify(ack).includes("999"), "the fabricated points came back in the answer");
      return "refused, " + ack.code;
    });

    await check("a pattern the server has no rule for is refused", async () => {
      const ack = await call(player, "claim:submit", { pattern: "royalFlush" });
      refused(ack, "claiming a pattern that does not exist");
      return ack.code;
    });

    await check("a claim cannot name a ticket the seat does not hold", async () => {
      const ack = await call(player, "claim:submit", { pattern: "topLine", ticketNo: 9 });
      refused(ack, "claiming against ticket 9 of 2");
      return ack.code;
    });

    await check("a round that has started cannot be re-configured", async () => {
      refused(await call(player, "tickets:select", { count: 1 }), "choosing tickets mid-round");
      return "refused";
    });

    await check("room A's numbers never reach room B", async () => {
      const hearing = listen(stranger, "number:called", 600);
      await call(hostA, "game:call-next");
      await call(hostA, "game:call-next");
      const heard = await hearing;
      assert.equal(heard.length, 0, "a seat in room B heard " + heard.length + " call(s) from room A");
      return "0 of 2 heard";
    });

    await check("an oversized frame kills its own connection, not the server", async () => {
      const doomed = await openSocket(mainUrl);
      const closed = new Promise((resolve) => {
        doomed.once("disconnect", (reason) => resolve(reason));
        setTimeout(() => resolve(null), 4000);
      });
      doomed.emit("chat:send", { text: "x".repeat(200000) });
      const reason = await closed;
      assert.ok(reason, "a 200 kB frame was accepted without closing the connection");
      const res = await request(mainUrl, "/livez");
      assert.equal(res.status, 200, "the server did not survive an oversized frame");
      return "connection closed (" + reason + "), server 200";
    });

    // ------------------------------------------------------- C. Rate limit

    header("C. Shipped event budget (second instance)");
    const flooded = await openSocket(strictUrl);

    await check("a burst of events is throttled, not served", async () => {
      const answers = [];
      for (let i = 0; i < 70; i += 1) answers.push(await call(flooded, "room:state"));
      const limited = answers.filter((a) => a && a.code === "RATE_LIMITED").length;
      assert.ok(limited > 0, "70 events in a burst were all served on a budget of 40");
      return limited + " of 70 throttled";
    });

    await check("a throttled connection recovers as its budget refills", async () => {
      await sleep(500);
      const ack = await call(flooded, "room:state");
      assert.ok(ack && ack.code !== "RATE_LIMITED", "the connection was still throttled after the budget refilled");
      assert.equal(ack.code, "NOT_PLAYER", "an unrelated connection was answered with " + ack.code);
      return "answered again";
    });
  } finally {
    for (const socket of sockets) socket.close();
    await main.closeServer().catch(() => {});
    await strict.closeServer().catch(() => {});
  }

  // ------------------------------------------------------------- the verdict

  const failed = results.filter((r) => !r.ok);
  header("verdict");
  if (failed.length === 0) {
    line("RESULT: PASS — " + results.length + " of " + results.length + " checks held.");
    line("");
    line("  Headers, CORS, the admin boundary and every socket path that carries");
    line("  authority were exercised against a real listening server. A refused");
    line("  check prints its assertion above; nothing is skipped.");
  } else {
    line("RESULT: FAIL — " + (results.length - failed.length) + " of " + results.length + " held, " + failed.length + " failed:");
    for (const failure of failed) line("  - " + failure.name + ": " + failure.detail);
  }
  line("");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("\nPROBE ABORTED:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
