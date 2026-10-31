/**
 * Socket.IO v2 client layer.
 *
 * Everything the browser sends goes through `call()`, which waits for the
 * server ack described in server/net/CONTRACT.md. The browser never decides a
 * number, never scores a claim and never trusts its own memory of the room:
 * each screen re-reads the server snapshot.
 *
 * `session` is kept per browser tab, with a device-level recovery copy, so a
 * refresh can resume with the server-issued session token (see the storage note
 * below). That token is the only credential the browser holds; the raw engine
 * credentials (hostToken / playerToken) never cross the wire.
 */
import { io } from "socket.io-client";
import { browserSlots, createSeatStore } from "./lib/seatStore.js";

/** Same origin by default; override for a split deployment. */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
});

/**
 * Seat credentials live per browser tab, with a device-level recovery copy; see
 * lib/seatStore.js for the rule and the reason. The store is built on each call,
 * not once at import, so storage that is slow to appear (or gets disabled) never
 * throws here.
 */
const seatStore = () => createSeatStore(browserSlots(typeof window === "undefined" ? null : window));

export function loadSession() {
  return seatStore().load();
}

/** This tab's own seat only — never the device's last player. */
export function loadOwnSession() {
  return seatStore().loadOwn();
}

/**
 * The seat this BROWSER remembers while this TAB holds none. Screens may offer
 * to reclaim it; they must not take it without asking (lib/joinSeat.js).
 */
export function loadPendingSession() {
  return seatStore().loadPending();
}

export function saveSession(patch) {
  return seatStore().save(patch);
}

export function clearSession() {
  seatStore().clear();
}

/**
 * Emit and await the ack. Never throws: a missing answer comes back as a
 * failure object so callers can render it like any other refusal.
 */
export function call(event, payload, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(
        result && typeof result === "object"
          ? result
          : { ok: false, code: "INTERNAL", error: "the server answered with nonsense" }
      );
    };
    const timer = setTimeout(
      () => finish({ ok: false, code: "TIMEOUT", error: "the server did not answer" }),
      timeoutMs
    );
    if (payload === undefined) socket.emit(event, finish);
    else socket.emit(event, payload, finish);
  });
}

/** Subscribe and get the unsubscribe back. */
export function on(event, handler) {
  socket.on(event, handler);
  return () => socket.off(event, handler);
}

function whenConnected(timeoutMs = 8000) {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off("connect", done);
      resolve(false);
    }, timeoutMs);
    function done() {
      clearTimeout(timer);
      resolve(true);
    }
    socket.on("connect", done);
  });
}

/** Session codes that mean the saved credential is dead: stop offering to resume. */
const SESSION_DEAD = new Set([
  "SESSION_UNKNOWN",
  "SESSION_INVALID",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "SESSION_ROTATED",
]);

/**
 * Refusals that mean the seat itself is gone - the room was closed, swept or
 * never existed. Anything else (a timeout, a dropped connection, a save that
 * failed) is transient and must not throw away a credential the player can
 * still use.
 */
const SEAT_GONE = new Set([...SESSION_DEAD, "ROOM_NOT_FOUND", "UNKNOWN_PLAYER", "ROOM_CLOSED"]);

export function isSeatGone(code) {
  return SEAT_GONE.has(code);
}

/**
 * Re-attach this socket to the saved room. The server answers with a fresh
 * snapshot, which is the only state the screens use.
 */
export async function resumeSession() {
  const session = loadSession();
  if (!session.roomId || !session.sessionToken) {
    return { ok: false, code: "NOT_PLAYER", error: "you are not in a room" };
  }
  if (!(await whenConnected())) {
    return { ok: false, code: "DISCONNECTED", error: "no connection to the server" };
  }
  const result = await call("session:resume", {
    roomId: session.roomId,
    sessionToken: session.sessionToken,
  });
  if (result.ok) {
    saveSession({
      role: result.role || session.role,
      playerId: result.playerId || session.playerId,
    });
  } else if (isSeatGone(result.code)) {
    clearSession();
  }
  return result;
}

/** Ask for the room state again (host gets the host view, player the player view). */
export async function fetchState() {
  return call("room:state");
}
