/**
 * Server-authoritative Tambola game engine.
 *
 * One TambolaRoom instance == one game room. It owns the only trusted copy of
 * the 1-90 draw order, the called history, the tickets, the participants, the
 * awarded patterns, the scoreboard and the game state.
 *
 * Browsers submit INTENTS (join, start, call next, claim, chat) and receive
 * VERDICTS. They never supply numbers, marks, points, winner flags or state,
 * and this module ignores such fields even when a client sends them.
 *
 * Design notes
 * ------------
 * - The draw is a Fisher-Yates shuffle of 1..90 built once at START from
 *   node:crypto. The unplayed tail is private: snapshots expose only the
 *   numbers already called plus a remaining count, never the shuffle.
 * - Claim arbitration is synchronous. Node's single-threaded event loop means
 *   no other claim can interleave between "is this valid?" and "award it", so
 *   two clients cannot take the same exclusive prize. Never add `await`
 *   inside claim() without reintroducing an explicit lock.
 * - Tickets are delivered per socket (emitTo), never broadcast, so no player
 *   can read another player's ticket.
 * - The engine is transport-free: the Socket.IO layer injects `emit` (room
 *   scoped) and `emitTo` (one socket). Tests pass recorders. Nothing here
 *   imports socket.io.
 *
 * Phase 3 additions (all optional, the memory-only behaviour is unchanged):
 * - `hydrate` rebuilds a room from durable state without generating a ticket,
 *   a draw or an award, and `integrityErrors()` states why a room cannot be
 *   trusted if it cannot.
 * - `applyCommittedCall` is the only way a number reaches the history when a
 *   database is present: the database has already written the row.
 * - `prepareClaim` / `commitClaim` split verification from awarding so the
 *   award can be committed durably before it is applied here.
 * - `externalScheduler` hands the calling clock to server/persist/scheduler.js
 *   so a room never has two timers.
 */

import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { generateTicket, validateTicket } from "./ticket.js";
import { evaluateClaimAcrossTickets, getPattern, enabledPatternIds, PATTERNS } from "./patterns.js";

export const GameState = Object.freeze({
  WAITING: "WAITING",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
});

/**
 * Allowed state transitions. Anything else is rejected with INVALID_TRANSITION.
 *   WAITING    -> RUNNING      host starts a fresh game
 *   WAITING    -> COMPLETED    host closes the room before the first call
 *   RUNNING    -> PAUSED       host pauses
 *   RUNNING    -> COMPLETED    all 90 called, or host ends the game
 *   PAUSED     -> RUNNING      host resumes
 *   PAUSED     -> COMPLETED    host ends the game
 *   COMPLETED  -> WAITING      host resets the room for a new game
 */
export const STATE_TRANSITIONS = Object.freeze({
  WAITING: [GameState.RUNNING, GameState.COMPLETED],
  RUNNING: [GameState.PAUSED, GameState.COMPLETED],
  PAUSED: [GameState.RUNNING, GameState.COMPLETED],
  COMPLETED: [GameState.WAITING],
});

export const DEFAULT_CONFIG = Object.freeze({
  /** ms between server-scheduled calls while auto-call is on */
  callIntervalMs: 8000,
  /** the server drives the draw on a timer; the host may still call manually */
  autoCall: true,
  maxPlayers: 100,
  /** a player who reconnects inside this window keeps ticket and score */
  disconnectGraceMs: 60000,
  /** minimum ms between two chat messages from the same player */
  chatIntervalMs: 2000,
  maxChatLength: 120,
  /** 0 disables the window; N > 0 requires Early Five to complete by call N */
  earlyFiveMaxCalls: 0,
  /**
   * How many calls may pass after a pattern completes before it can no longer
   * be claimed. 0 is the traditional Indian rule — claim before the next number
   * is called. N allows N further calls of grace for slow phones; a negative
   * value turns the rule off entirely. Also reachable as an admin setting.
   */
  claimWindowCalls: 0,
  /** most tickets a single seat may hold; clamped TICKET_MIN..TICKET_MAX */
  maxTicketsPerPlayer: 4,
  /** pattern id -> boolean, overrides enabledByDefault */
  patterns: {},
  multipleWinnersPerPattern: false,
});

/** Hard bounds on a seat's ticket count, independent of the room's max. */
export const TICKET_MIN = 1;
export const TICKET_MAX = 12;

/**
 * How many past messages a room remembers in memory, so a seat that joins
 * mid-round can ask what the room already said. Deliberately small: chat is not
 * game state, is never persisted, is never in a snapshot, and travels only to
 * the one connection that asks for it.
 */
export const CHAT_HISTORY = 24;

export const ErrorCodes = Object.freeze({
  BAD_PAYLOAD: "BAD_PAYLOAD",
  ROOM_EXISTS: "ROOM_EXISTS",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_CLOSED: "ROOM_CLOSED",
  ROOM_FULL: "ROOM_FULL",
  NAME_TAKEN: "NAME_TAKEN",
  NOT_HOST: "NOT_HOST",
  NOT_PLAYER: "NOT_PLAYER",
  UNKNOWN_PLAYER: "UNKNOWN_PLAYER",
  INVALID_STATE: "INVALID_STATE",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  DRAW_EXHAUSTED: "DRAW_EXHAUSTED",
  UNKNOWN_PATTERN: "UNKNOWN_PATTERN",
  ALREADY_AWARDED: "ALREADY_AWARDED",
  ALREADY_CLAIMED_BY_YOU: "ALREADY_CLAIMED_BY_YOU",
  CLAIM_TOO_LATE: "CLAIM_TOO_LATE",
  RATE_LIMITED: "RATE_LIMITED",
  TICKET_LIMIT: "TICKET_LIMIT",
});

function fail(code, message, extra = {}) {
  return { ok: false, code, error: message, ...extra };
}

function ok(payload = {}) {
  return { ok: true, ...payload };
}

/**
 * Thrown when durable state and the in-memory room disagree, or when a room
 * cannot be rebuilt safely. Recovery treats this as "fail closed": the room is
 * frozen and the reason is reported instead of a new game being invented.
 */
export class IntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "IntegrityError";
    this.code = "RECOVERY_REQUIRED";
    this.details = details;
  }
}

/** URL-safe, unambiguous, unpredictable room code (no I/O/0/1 lookalikes). */
export function newRoomId(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function newToken(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

const LOWER_HEX = /^[0-9a-f]*$/;

/**
 * Compare two hex credentials without leaking timing differences. Case
 * sensitivity is deliberate: Buffer.from("AABB", "hex") would silently accept
 * upper case, so an attacker could probe the token in a normalised alphabet.
 */
function hexEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!LOWER_HEX.test(a) || !LOWER_HEX.test(b)) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufB.length !== bufA.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const FULL_DRAW = Object.freeze(Array.from({ length: 90 }, (_, i) => i + 1));

/** A seat's ticket fingerprint: its 15 numbers sorted, so duplicates are caught. */
function ticketFingerprint(grid) {
  return grid.flat().filter((n) => n !== null && n !== undefined).sort((a, b) => a - b).join(",");
}

/** Public shape of one owned ticket: a stable number plus its grid. */
function publicTicket(ticket) {
  return { no: ticket.no, grid: ticket.grid };
}

/**
 * Coerce whatever the persistence/recovery layer hands back into the engine's
 * canonical `[{ no, grid }]` seat list. Accepts the new `tickets` array (either
 * `{no, grid}` objects or bare grids) and the legacy single `ticket` field.
 */
function normalizeStoredTickets(entry) {
  if (Array.isArray(entry.tickets)) {
    return entry.tickets
      .map((t, i) => (t && t.grid ? { no: t.no || i + 1, grid: t.grid } : { no: i + 1, grid: t }))
      .filter((t) => Array.isArray(t.grid));
  }
  if (entry.ticket && Array.isArray(entry.ticket)) return [{ no: 1, grid: entry.ticket }];
  return [];
}

export class TambolaRoom {
  /**
   * @param {object} options
   * @param {string} options.roomId
   * @param {(event: string, payload: any) => void} [options.emit] room-scoped broadcast
   * @param {(socketId: string, event: string, payload: any) => void} [options.emitTo] private send
   * @param {object} [options.config]
   * @param {(max: number) => number} [options.rng] integer source in [0, max)
   * @param {() => number} [options.now] millisecond clock
   * @param {(entry: object) => void} [options.onAudit] every recorded game event
   * @param {boolean} [options.externalScheduler] the calling clock is owned
   *        outside this class (server/persist/scheduler.js), so no timer here
   * @param {object} [options.hydrate] authoritative state read from the database
   */
  constructor({
    roomId,
    emit,
    emitTo,
    config,
    rng,
    now,
    setTimer,
    clearTimer,
    onHostGone,
    onAudit,
    externalScheduler,
    keepHostSeat,
    hydrate,
  } = {}) {
    if (!roomId) throw new Error("roomId is required");
    this.roomId = roomId;
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
    this.rng = rng || randomInt;
    this.now = now || (() => Date.now());
    this.setTimer = setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = clearTimer || ((timer) => clearTimeout(timer));
    this.emit = typeof emit === "function" ? emit : () => {};
    this.emitTo = typeof emitTo === "function" ? emitTo : () => {};
    /** fired when the host participant is removed for good, so the room can close */
    this.onHostGone = typeof onHostGone === "function" ? onHostGone : () => {};
    /** mirrored to durable state; the audit trail of this room */
    this.onAudit = typeof onAudit === "function" ? onAudit : () => {};
    this.externalScheduler = Boolean(externalScheduler);
    /**
     * Durable mode: the host's SEAT is part of the game's history, so losing
     * the connection never removes it. The room waits for its owner instead of
     * quietly becoming somebody else's.
     */
    this.keepHostSeat = Boolean(keepHostSeat);

    this.state = GameState.WAITING;
    this.createdAt = this.now();

    // Credentials below are server-side only. Since they never leave the
    // process (browsers hold a session token instead, see persist/sessions.js)
    // they are minted fresh on every boot, which retires any token that an
    // older build may have handed to a browser.
    this.hostToken = newToken(24);
    this.hostSocketId = null;
    this.hostPlayerId = null;

    /** playerId -> player record */
    this.players = new Map();
    /** socketId -> playerId, reverse lookup for disconnect handling */
    this.socketToPlayer = new Map();
    this.pendingRemovals = new Map();

    /** private: the official shuffle, never serialised to any client */
    this.draw = [];
    this.cursor = 0;
    /** public history, oldest first */
    this.calledNumbers = [];
    this.calledSet = new Set();

    /** patternId -> winner records (length 1 unless multiple winners allowed) */
    this.awards = new Map();
    this.claimLog = [];
    this.audit = [];
    this.lastChatAt = new Map();
    /**
     * The room's conversation, newest last, capped at CHAT_HISTORY. Chat is not
     * game state: it is never persisted and never part of a snapshot, and it is
     * lost when the process restarts. It is kept in memory for one reason — a
     * seat that joins mid-round would otherwise see an empty chat panel while
     * the room is clearly talking.
     */
    this.chatLog = [];
    this.autoCallTimer = null;

    /** game round this state belongs to; the database owns the numbering */
    this.gameNumber = 0;

    if (hydrate) this.hydrateFrom(hydrate);
  }

  // ------------------------------------------------------- hydration (phase 3)

  /**
   * Rebuild from authoritative durable state. Generates nothing: no ticket, no
   * draw, no award. Participants come back disconnected, because a socket from
   * a dead process is gone; live sockets re-attach through the session layer.
   */
  hydrateFrom(source = {}) {
    const state = source.state || GameState.WAITING;
    if (!Object.prototype.hasOwnProperty.call(STATE_TRANSITIONS, state)) {
      throw new IntegrityError("unknown room state in durable state: " + state, { roomId: this.roomId });
    }
    this.state = state;
    if (Number.isFinite(source.createdAt)) this.createdAt = source.createdAt;
    this.gameNumber = Number.isInteger(source.gameNumber) ? source.gameNumber : 0;
    this.hostPlayerId = source.hostPlayerId || null;

    this.players = new Map();
    for (const entry of source.players || []) {
      if (!entry || typeof entry.id !== "string") {
        throw new IntegrityError("durable participant without an id", { roomId: this.roomId });
      }
      this.players.set(entry.id, {
        id: entry.id,
        token: newToken(16),
        name: entry.name,
        socketId: null,
        connected: false,
        tickets: normalizeStoredTickets(entry),
        ticketCount: 0,
        points: Number.isInteger(entry.points) ? entry.points : 0,
        claims: Array.isArray(entry.claims) ? entry.claims.slice() : [],
        joinedAt: Number.isFinite(entry.joinedAt) ? entry.joinedAt : this.now(),
      });
      const seated = this.players.get(entry.id);
      seated.ticketCount = Number.isInteger(entry.ticketCount) && entry.ticketCount > 0
        ? entry.ticketCount
        : seated.tickets.length || 1;
    }

    this.draw = Array.isArray(source.draw) ? source.draw.slice() : [];
    this.calledNumbers = Array.isArray(source.calledNumbers) ? source.calledNumbers.slice() : [];
    this.calledSet = new Set(this.calledNumbers);
    this.cursor = Number.isInteger(source.cursor) ? source.cursor : this.calledNumbers.length;

    this.awards = new Map();
    for (const award of source.awards || []) {
      const winners = this.awards.get(award.pattern) || [];
      winners.push({
        playerId: award.playerId,
        name: award.name,
        points: award.points,
        callIndex: award.callIndex,
        at: award.at,
      });
      this.awards.set(award.pattern, winners);
    }
    this.claimLog = Array.isArray(source.claimLog) ? source.claimLog.slice() : [];
  }

  /**
   * Everything that must hold before this room is allowed to keep playing.
   * Returns a list of human-readable problems; empty means trustworthy.
   */
  integrityErrors() {
    const problems = [];
    const push = (message) => problems.push(message);

    if (!Object.values(GameState).includes(this.state)) push("room state is not one of the four known states");
    if (this.hostPlayerId && !this.players.has(this.hostPlayerId)) {
      push("the recorded host is not a participant of this room");
    }
    if (this.state === GameState.WAITING && this.draw.length) {
      push("a WAITING room still carries a draw sequence");
    }
    if (this.state !== GameState.WAITING && this.players.size === 0) {
      push("a game is in progress but the room has no participants");
    }

    if (this.draw.length) {
      if (this.draw.length !== 90) push("the draw holds " + this.draw.length + " numbers, expected 90");
      if (new Set(this.draw).size !== this.draw.length) push("the draw contains a repeated number");
      const sorted = this.draw.slice().sort((a, b) => a - b).join(",");
      if (sorted !== FULL_DRAW.join(",")) push("the draw is not a permutation of 1-90");
    }

    if (this.cursor < this.calledNumbers.length) push("the draw cursor is behind the called history");
    if (this.cursor > 90) push("the draw cursor is past 90");
    if (this.cursor > this.draw.length) push("the draw cursor is past the end of the stored draw");
    if (this.calledNumbers.length !== this.cursor) {
      push("called history has " + this.calledNumbers.length + " entries but the cursor says " + this.cursor);
    }
    if (this.calledSet.size !== this.calledNumbers.length) push("the called history contains a repeat");
    for (let i = 0; i < this.calledNumbers.length; i++) {
      if (this.draw.length && this.draw[i] !== this.calledNumbers[i]) {
        push("call " + (i + 1) + " does not match the stored draw plan");
        break;
      }
    }

    for (const [pattern, winners] of this.awards.entries()) {
      if (!PATTERNS[pattern]) push("an award exists for unknown pattern " + pattern);
      if (winners.length && !this.config.multipleWinnersPerPattern && winners.length > 1) {
        push("pattern " + pattern + " was awarded to " + winners.length + " players but is exclusive");
      }
      for (const winner of winners) {
        const player = this.players.get(winner.playerId);
        if (!player) push("an award for " + pattern + " names a participant who is gone");
        else if (!player.claims.includes(pattern)) {
          push(player.name + " holds an award for " + pattern + " that is not on their claim list");
        }
      }
    }
    for (const player of this.players.values()) {
      let expected = 0;
      for (const [pattern, winners] of this.awards.entries()) {
        // an unknown pattern is already reported above; adding its points would
        // throw and hide every other problem behind a TypeError message
        if (!PATTERNS[pattern]) continue;
        if (winners.some((winner) => winner.playerId === player.id)) expected += PATTERNS[pattern].points;
      }
      if (player.points !== expected) {
        push(player.name + " has " + player.points + " points but their awards add up to " + expected);
      }
      for (const pattern of player.claims) {
        const winners = this.awards.get(pattern) || [];
        if (!winners.some((winner) => winner.playerId === player.id)) {
          push(player.name + " claims " + pattern + " which was never awarded to them");
        }
      }
    }
    return problems;
  }

  /** Throws unless this room is internally consistent. */
  assertIntegrity() {
    const problems = this.integrityErrors();
    if (problems.length) {
      throw new IntegrityError(problems.join("; "), { roomId: this.roomId, problems });
    }
  }

  /**
   * The engine's own credentials are server-side; the transport layer needs
   * them to keep talking to this class after a session has been verified.
   */
  playerCredential(playerId) {
    const player = this.players.get(playerId);
    return player ? player.token : null;
  }

  /**
   * The host credential, for server-side operators only. It authorises the same
   * lifecycle actions a connected host socket does (see assertHost), so an
   * authenticated operator can drive a room whose host browser is away. It is
   * never placed in any snapshot or ack, exactly like playerCredential().
   */
  hostCredential() {
    return this.hostToken;
  }


  // ----------------------------------------------------------- internal utils

  record(entry) {
    const built = { at: this.now(), ...entry };
    this.audit.push(built);
    if (this.audit.length > 500) this.audit.shift();
    this.onAudit(built);
    return built;
  }

  /** Is this socket the currently registered host connection for the room? */
  isHostSocket(socketId) {
    return Boolean(socketId) && socketId === this.hostSocketId;
  }

  assertHost(auth = {}) {
    if (auth.socketId && auth.socketId === this.hostSocketId) return null;
    if (auth.hostToken && hexEquals(this.hostToken, auth.hostToken)) return null;
    return fail(ErrorCodes.NOT_HOST, "only the host may perform this action");
  }

  playersList() {
    return [...this.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      isHost: player.id === this.hostPlayerId,
      points: player.points,
      // How many tickets this seat is playing. It is the chosen count, not the
      // grids already minted: a seat that never touched the picker holds none
      // yet, but is issued its committed count at start (see start()). Reading
      // `tickets.length` here made those seats look like they were not playing.
      // A count is never a grid.
      tickets: player.ticketCount,
    }));
  }

  issueTicket() {
    const ticket = generateTicket(this.rng);
    const check = validateTicket(ticket);
    if (!check.valid) {
      throw new Error("engine produced an invalid ticket: " + check.errors.join("; "));
    }
    return ticket;
  }

  /** The room's per-seat ticket ceiling, clamped to the hard bounds. */
  ticketCeiling() {
    const raw = Number(this.config.maxTicketsPerPlayer);
    const max = Number.isFinite(raw) ? Math.floor(raw) : TICKET_MIN;
    return Math.min(TICKET_MAX, Math.max(TICKET_MIN, max));
  }

  /**
   * Mint a fresh ticket that does not duplicate anything this seat already
   * holds. generateTickets already de-dupes within a batch, so a small retry
   * against the seat's own set is all that is needed.
   */
  mintDistinctTicket(owned) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const grid = this.issueTicket();
      if (!owned.has(ticketFingerprint(grid))) return grid;
    }
    return this.issueTicket();
  }

  /**
   * A seat chooses how many tickets it wants before the round begins.
   *
   * Server-authoritative and enforced here, not just in the UI:
   *  - only while the room is WAITING (a locked selection cannot be changed once
   *    the first number is called, which is what keeps a claim's ticket stable);
   *  - the count is clamped to 1..maxTicketsPerPlayer; asking for more returns
   *    TICKET_LIMIT rather than silently over-issuing;
   *  - growing appends new, distinct tickets and shrinking drops from the end, so
   *    a ticket a player can already see never changes under them.
   */
  selectTickets({ playerId, count, playerToken, socketId } = {}) {
    let player = this.players.get(playerId);
    if (!player && socketId) player = this.players.get(this.socketToPlayer.get(socketId));
    if (!player) return fail(ErrorCodes.NOT_PLAYER, "you are not a participant of this room");
    if (playerToken !== undefined && player.token !== playerToken) {
      return fail(ErrorCodes.NOT_PLAYER, "bad player credential");
    }
    if (this.state !== GameState.WAITING) {
      return fail(ErrorCodes.INVALID_STATE, "ticket selection is locked once the game has started", { state: this.state });
    }
    const ceiling = this.ticketCeiling();
    const wanted = Number.isInteger(count) ? count : NaN;
    if (!Number.isInteger(wanted) || wanted < TICKET_MIN) {
      return fail(ErrorCodes.BAD_PAYLOAD, "count must be a whole number of tickets");
    }
    if (wanted > ceiling) {
      return fail(ErrorCodes.TICKET_LIMIT, "this room allows at most " + ceiling + " tickets per player", { max: ceiling });
    }

    player.ticketCount = wanted;
    const owned = new Set(player.tickets.map((t) => ticketFingerprint(t.grid)));
    if (wanted < player.tickets.length) {
      // dropping tickets frees their fingerprints so a later re-add never collides
      player.tickets = player.tickets.slice(0, wanted);
      owned.clear();
      for (const t of player.tickets) owned.add(ticketFingerprint(t.grid));
    } else {
      while (player.tickets.length < wanted) {
        const grid = this.mintDistinctTicket(owned);
        owned.add(ticketFingerprint(grid));
        player.tickets.push({ no: player.tickets.length + 1, grid });
      }
    }
    // keep the numbering contiguous after any shrink/grow
    player.tickets.forEach((t, i) => { t.no = i + 1; });

    this.record({ type: "tickets-selected", player: player.id, count: wanted });
    this.emit("room:updated", { players: this.playersList() });
    return ok({ ticketCount: wanted, maxTickets: ceiling, tickets: player.tickets.map(publicTicket) });
  }

  // ------------------------------------------------------------------- roster

  /**
   * Register a participant. Identity is the server-issued playerId + token;
   * the display name is only a label, must be 3-20 chars, and must be unique
   * among connected participants so nobody can impersonate somebody else.
   * Repeating a join from the same socket is idempotent.
   */
  join({ name, socketId, playerId, playerToken, hostToken } = {}) {
    if (playerId !== undefined || hostToken !== undefined) {
      return this.resume({ playerId, playerToken, hostToken, socketId });
    }
    if (this.state === GameState.COMPLETED) {
      return fail(ErrorCodes.ROOM_CLOSED, "game finished - ask the host to reset the room");
    }
    if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 20) {
      return fail(ErrorCodes.BAD_PAYLOAD, "name must be 3-20 characters");
    }
    if (typeof socketId !== "string" || !socketId) {
      return fail(ErrorCodes.BAD_PAYLOAD, "missing connection identity");
    }
    const cleanName = name.trim().replace(/\s+/g, " ");

    const known = this.socketToPlayer.get(socketId);
    if (known && this.players.has(known)) {
      const player = this.players.get(known);
      return ok({ ...this.sessionView(player), resumed: true });
    }

    if (this.players.size >= this.config.maxPlayers) {
      return fail(ErrorCodes.ROOM_FULL, "room is full (" + this.config.maxPlayers + " players)");
    }
    const taken = [...this.players.values()].some(
      (p) => p.connected && p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (taken) return fail(ErrorCodes.NAME_TAKEN, "that name is already taken in this room");

    const player = {
      id: newToken(6),
      token: newToken(16),
      name: cleanName,
      socketId,
      connected: true,
      tickets: [],
      ticketCount: 1,
      points: 0,
      claims: [],
      joinedAt: this.now(),
    };
    this.players.set(player.id, player);
    this.socketToPlayer.set(socketId, player.id);
    this.record({ type: "join", player: player.id, name: player.name });
    this.emit("room:updated", { players: this.playersList() });
    return ok(this.sessionView(player));
  }

  /** Designate the participant that owns the room (called once at creation). */
  setHost({ socketId, playerId }) {
    if (!this.players.has(playerId)) return fail(ErrorCodes.UNKNOWN_PLAYER, "unknown player id");
    this.hostPlayerId = playerId;
    this.hostSocketId = socketId || this.hostSocketId;
    return ok({ hostPlayerId: playerId, hostSocketId: this.hostSocketId });
  }

  /** Reattach a known participant - or the host - to a fresh socket id. */
  resume({ playerId, playerToken, hostToken, socketId } = {}) {
    if (hostToken !== undefined) {
      if (!hexEquals(this.hostToken, hostToken)) {
        return fail(ErrorCodes.NOT_HOST, "bad host credential");
      }
      if (this.hostPlayerId && this.players.has(this.hostPlayerId)) {
        const hostPlayer = this.players.get(this.hostPlayerId);
        this.reattach(hostPlayer, socketId);
      } else if (socketId) {
        this.hostSocketId = socketId;
      }
      this.record({ type: "host-resume" });
      this.emit("room:updated", { players: this.playersList() });
      const hostPlayer = this.players.get(this.hostPlayerId);
      return ok({
        role: "host",
        resumed: true,
        playerId: this.hostPlayerId,
        playerToken: hostPlayer ? hostPlayer.token : undefined,
        snapshot: this.hostSnapshot(),
      });
    }
    const player = this.players.get(playerId);
    if (!player || typeof playerToken !== "string" || player.token !== playerToken) {
      return fail(ErrorCodes.UNKNOWN_PLAYER, "unknown player id or bad credential");
    }
    this.reattach(player, socketId);
    this.record({ type: "resume", player: player.id });
    this.emit("room:updated", { players: this.playersList() });
    return ok({ ...this.sessionView(player), resumed: true, snapshot: this.playerSnapshot(player.id) });
  }

  /**
   * Re-attach a participant whose identity the caller has ALREADY verified.
   *
   * Phase 3 session handling: a browser presents a session token, the transport
   * checks it against the hashed session store and only then calls this. The
   * engine deliberately has no idea what an HTTP session is; it trusts the
   * transport the way it trusts `socket.id`, and this is the one place a
   * reconnection may name a playerId without also naming a credential.
   */
  attachAuthenticated({ playerId, socketId } = {}) {
    const player = this.players.get(playerId);
    if (!player) return fail(ErrorCodes.UNKNOWN_PLAYER, "unknown player id for this room");
    this.reattach(player, socketId);
    this.record({ type: "resume", player: player.id, via: "session" });
    this.emit("room:updated", { players: this.playersList() });
    const role = player.id === this.hostPlayerId ? "host" : "player";
    return ok({
      role,
      resumed: true,
      playerId: player.id,
      snapshot: role === "host" ? this.hostSnapshot() : this.playerSnapshot(player.id),
    });
  }

  reattach(player, socketId) {
    const timer = this.pendingRemovals.get(player.id);
    if (timer) {
      this.clearTimer(timer);
      this.pendingRemovals.delete(player.id);
    }
    if (player.socketId && player.socketId !== socketId) {
      this.socketToPlayer.delete(player.socketId);
    }
    player.socketId = socketId || player.socketId;
    player.connected = Boolean(player.socketId);
    if (player.connected) this.socketToPlayer.set(player.socketId, player.id);
    if (player.id === this.hostPlayerId) this.hostSocketId = player.socketId;
  }

  sessionView(player) {
    return {
      playerId: player.id,
      playerToken: player.token,
      name: player.name,
      ticket: player.tickets.length ? player.tickets[0].grid : null,
      tickets: player.tickets.map(publicTicket),
      ticketCount: player.ticketCount,
      points: player.points,
      claims: player.claims.slice(),
    };
  }

  /** Socket dropped: flag as disconnected, then sweep after the grace window. */
  detach(socketId) {
    let removed = false;
    const playerId = this.socketToPlayer.get(socketId);
    this.socketToPlayer.delete(socketId);

    if (!playerId) {
      if (this.hostSocketId === socketId) {
        this.hostSocketId = null;
        this.record({ type: "host-disconnected" });
        this.emit("host:changed", { hostConnected: false });
        removed = true;
      }
      return removed ? { host: true } : null;
    }

    const player = this.players.get(playerId);
    if (!player) return { playerId: null };
    player.connected = false;
    player.socketId = null;
    if (player.id === this.hostPlayerId) {
      this.hostSocketId = null;
      this.emit("host:changed", { hostConnected: false });
      if (this.keepHostSeat) {
        // An unreachable owner is not a gone owner. The seat and the ticket
        // stay, the calling clock stops, and the room waits: nobody else can
        // take over a game they did not start.
        this.record({ type: "host-lost", player: player.id });
        if (this.state === GameState.RUNNING) {
          this.stopAutoCall();
          this.transition(GameState.PAUSED);
          this.emit("game:state", this.stateView());
        }
        this.emit("room:updated", { players: this.playersList() });
        return { playerId: player.id, host: true, waitingForHost: true };
      }
    }
    if (!this.pendingRemovals.has(player.id)) {
      const timer = this.setTimer(() => this.dropPlayer(player.id, "grace period expired"), this.config.disconnectGraceMs);
      if (timer && typeof timer.unref === "function") timer.unref();
      this.pendingRemovals.set(player.id, timer);
    }
    this.record({ type: "disconnect", player: player.id });
    this.emit("room:updated", { players: this.playersList() });
    return { playerId: player.id };
  }

  /**
   * Remove a participant entirely - they stop being an active player.
   *
   * Once the round is COMPLETED the seat is only vacated: it keeps its points
   * and awards and shows as away, because the final board is part of the room's
   * record. Erasing it here made a finished game's standings shrink under the
   * host while the results screen was open. `reset()` clears those seats for
   * real (`final: true`) so a new round starts with the people who are present.
   */
  dropPlayer(playerId, reason, { final = false } = {}) {
    const timer = this.pendingRemovals.get(playerId);
    if (timer) {
      this.clearTimer(timer);
      this.pendingRemovals.delete(playerId);
    }
    const player = this.players.get(playerId);
    if (!player) return false;
    const wasHost = this.hostPlayerId === playerId;
    if (!final && this.state === GameState.COMPLETED && !wasHost) {
      if (player.socketId) this.socketToPlayer.delete(player.socketId);
      player.socketId = null;
      player.connected = false;
      this.record({ type: "seat-vacated", player: playerId, reason });
      this.emit("room:updated", { players: this.playersList() });
      return true;
    }
    if (wasHost && this.keepHostSeat) {
      // leaving voluntarily does not hand the room away either: the seat is
      // kept, the game stops, and the same credential can come back to it
      if (player.socketId) this.socketToPlayer.delete(player.socketId);
      player.socketId = null;
      player.connected = false;
      this.hostSocketId = null;
      const timer = this.pendingRemovals.get(playerId);
      if (timer) {
        this.clearTimer(timer);
        this.pendingRemovals.delete(playerId);
      }
      this.record({ type: "host-lost", player: playerId, reason });
      if (this.state === GameState.RUNNING) {
        this.stopAutoCall();
        this.transition(GameState.PAUSED);
        this.emit("game:state", this.stateView());
      }
      this.emit("host:changed", { hostConnected: false });
      this.emit("room:updated", { players: this.playersList() });
      return true;
    }
    if (player.socketId) this.socketToPlayer.delete(player.socketId);
    this.players.delete(playerId);
    this.lastChatAt.delete(playerId);
    if (wasHost) this.hostPlayerId = null;
    this.record({ type: "removed", player: playerId, reason, wasHost });
    this.emit("room:updated", { players: this.playersList() });
    if (wasHost) this.onHostGone(playerId, reason);
    return true;
  }

  leave({ playerId, playerToken } = {}) {
    const player = this.players.get(playerId);
    if (!player || player.token !== playerToken) {
      return fail(ErrorCodes.UNKNOWN_PLAYER, "unknown player id or bad credential");
    }
    this.dropPlayer(playerId, "left");
    return ok({ left: true });
  }

  // ---------------------------------------------------------------- game flow

  transition(target) {
    if (!STATE_TRANSITIONS[this.state].includes(target)) {
      return fail(ErrorCodes.INVALID_TRANSITION, "cannot go from " + this.state + " to " + target, { state: this.state });
    }
    this.state = target;
    return ok({ state: target });
  }

  start(auth = {}) {
    const denied = this.assertHost(auth);
    if (denied) return denied;
    if (this.state !== GameState.WAITING) {
      return fail(ErrorCodes.INVALID_STATE, "game is " + this.state, { state: this.state });
    }
    const active = [...this.players.values()].filter((p) => p.connected);
    if (active.length < 1) return fail(ErrorCodes.INVALID_STATE, "nobody is connected to play");

    const moved = this.transition(GameState.RUNNING);
    if (!moved.ok) return moved;

    this.draw = shuffled(FULL_DRAW, this.rng);
    this.cursor = 0;
    this.calledNumbers = [];
    this.calledSet = new Set();
    this.awards = new Map();
    this.claimLog = [];
    for (const player of this.players.values()) {
      player.points = 0;
      player.claims = [];
      // honour the seat's chosen count; a seat that never chose still gets one.
      const want = Math.min(Math.max(1, player.ticketCount || 1), this.ticketCeiling());
      player.ticketCount = want;
      const owned = new Set(player.tickets.map((t) => ticketFingerprint(t.grid)));
      while (player.tickets.length < want) {
        const grid = this.mintDistinctTicket(owned);
        owned.add(ticketFingerprint(grid));
        player.tickets.push({ no: player.tickets.length + 1, grid });
      }
      if (player.tickets.length > want) player.tickets = player.tickets.slice(0, want);
      player.tickets.forEach((t, i) => { t.no = i + 1; });
    }
    this.record({ type: "start", players: this.players.size });
    this.emit("game:state", this.stateView());
    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      for (const t of player.tickets) {
        this.emitTo(player.socketId, "ticket:assigned", {
          ticket: t.grid,
          ticketNo: t.no,
          ticketCount: player.tickets.length,
        });
      }
    }
    if (this.config.autoCall) this.scheduleAutoCall();
    const ticketsIssued = [...this.players.values()].reduce((n, p) => n + p.tickets.length, 0);
    return ok({ state: this.state, ticketsIssued, snapshot: this.hostSnapshot() });
  }

  /**
   * The only public way a number enters the history: an authorised host
   * intent. There is deliberately no `number` parameter - a client cannot
   * propose a call even if it sends one.
   */
  callNext(auth = {}) {
    const denied = this.assertHost(auth);
    if (denied) return denied;
    return this.drawNext({ source: "host" });
  }

  drawNext(meta = {}) {
    if (this.state === GameState.PAUSED) return fail(ErrorCodes.INVALID_STATE, "game is paused");
    if (this.state !== GameState.RUNNING) {
      return fail(ErrorCodes.INVALID_STATE, "game is " + this.state, { state: this.state });
    }
    if (this.cursor >= this.draw.length) {
      return fail(ErrorCodes.DRAW_EXHAUSTED, "all 90 numbers have been called");
    }
    return this.applyCommittedCall({
      number: this.draw[this.cursor],
      index: this.cursor + 1,
      source: meta.source,
    });
  }

  /**
   * Put an already-official call into the live room.
   *
   * When a database is configured this is the ONLY entry point for a number:
   * persist/ writes the draw_calls row first, then applies it here, so a
   * number can never be broadcast before it is durable. The assertions below
   * are what make a mismatch (corrupted row, wrong round, second timer) blow up
   * instead of quietly desynchronising the game.
   */
  applyCommittedCall({ number, index, source = "host", calledAt } = {}) {
    if (!Number.isInteger(number) || number < 1 || number > 90) {
      throw new IntegrityError("a committed call carries a number outside 1-90", { roomId: this.roomId, number });
    }
    if (!Number.isInteger(index) || index < 1) {
      throw new IntegrityError("a committed call carries no position", { roomId: this.roomId, index });
    }
    if (this.state !== GameState.RUNNING) {
      throw new IntegrityError("a call was committed while the game is " + this.state, { roomId: this.roomId });
    }
    if (index !== this.cursor + 1) {
      throw new IntegrityError(
        "committed call position " + index + " does not follow the local cursor " + this.cursor,
        { roomId: this.roomId, index, cursor: this.cursor }
      );
    }
    if (this.draw.length && this.draw[index - 1] !== number) {
      throw new IntegrityError(
        "committed call " + number + " is not position " + index + " of the stored draw",
        { roomId: this.roomId, number, index }
      );
    }

    this.cursor = index;
    this.calledNumbers.push(number);
    this.calledSet.add(number);
    this.emit("number:called", {
      number,
      index: this.cursor,
      remaining: this.draw.length ? this.draw.length - this.cursor : null,
      calledAt,
    });
    this.record({ type: "call", number, index: this.cursor, source });

    if (this.draw.length && this.cursor === this.draw.length) {
      const finished = this.transition(GameState.COMPLETED);
      if (finished.ok) this.finish("all 90 numbers called");
    }
    return ok({ number, index: this.cursor, remaining: this.draw.length - this.cursor });
  }

  pause(auth = {}) {
    const denied = this.assertHost(auth);
    if (denied) return denied;
    if (this.state !== GameState.RUNNING) {
      return fail(ErrorCodes.INVALID_STATE, "cannot pause a " + this.state + " game");
    }
    this.stopAutoCall();
    this.transition(GameState.PAUSED);
    this.record({ type: "pause" });
    this.emit("game:state", this.stateView());
    return ok({ state: this.state });
  }

  resumeGame(auth = {}) {
    const denied = this.assertHost(auth);
    if (denied) return denied;
    if (this.state !== GameState.PAUSED) {
      return fail(ErrorCodes.INVALID_STATE, "cannot resume a " + this.state + " game");
    }
    this.transition(GameState.RUNNING);
    this.record({ type: "resume" });
    this.emit("game:state", this.stateView());
    if (this.config.autoCall) this.scheduleAutoCall();
    return ok({ state: this.state });
  }

  end(auth = {}) {
    const denied = this.assertHost(auth);
    if (denied) return denied;
    if (this.state === GameState.COMPLETED) return ok({ state: this.state });
    this.stopAutoCall();
    const moved = this.transition(GameState.COMPLETED);
    if (!moved.ok) return moved;
    this.finish("host ended the game");
    return ok({ state: this.state });
  }

  /** COMPLETED -> WAITING: same room and roster, brand-new game on reset. */
  reset(auth = {}) {
    const denied = this.assertHost(auth);
    if (denied) return denied;
    if (this.state !== GameState.COMPLETED) {
      return fail(ErrorCodes.INVALID_TRANSITION, "reset is only allowed once the game has completed");
    }
    this.stopAutoCall();
    this.state = GameState.WAITING;
    this.draw = [];
    this.cursor = 0;
    this.calledNumbers = [];
    this.calledSet = new Set();
    this.awards = new Map();
    this.claimLog = [];
    // Seats that closed the tab after the final whistle were kept on the board.
    // A new round starts with the people who are actually here: clear those out
    // (and their pending grace timers) before anybody is dealt a ticket.
    for (const player of [...this.players.values()]) {
      if (!player.connected && player.id !== this.hostPlayerId) {
        this.dropPlayer(player.id, "gone before the next round", { final: true });
      }
    }
    for (const player of this.players.values()) {
      player.points = 0;
      player.claims = [];
      player.tickets = [];
    }
    this.record({ type: "reset" });
    this.emit("game:state", this.stateView());
    return ok({ state: this.state, snapshot: this.hostSnapshot() });
  }

  finish(reason) {
    this.stopAutoCall();
    this.emit("game:state", this.stateView());
    this.emit("game:completed", { reason, leaderboard: this.leaderboard(), awards: this.awardList() });
    this.record({ type: "completed", reason });
  }

  scheduleAutoCall() {
    this.stopAutoCall();
    // With a database the durable scheduler owns the clock: one timer per
    // room, in persist/scheduler.js, claiming its tick with a row lock.
    if (this.externalScheduler) return;
    const interval = Number(this.config.callIntervalMs);
    if (!Number.isFinite(interval) || interval < 500) return;
    this.autoCallTimer = this.setTimer(() => this.autoTick(interval), interval);
    if (this.autoCallTimer && typeof this.autoCallTimer.unref === "function") this.autoCallTimer.unref();
  }

  autoTick(interval) {
    if (this.state !== GameState.RUNNING) return;
    this.drawNext({ source: "scheduler" });
    if (this.state === GameState.RUNNING) {
      this.autoCallTimer = this.setTimer(() => this.autoTick(interval), interval);
      if (this.autoCallTimer && typeof this.autoCallTimer.unref === "function") this.autoCallTimer.unref();
    }
  }

  stopAutoCall() {
    if (this.autoCallTimer) {
      this.clearTimer(this.autoCallTimer);
      this.autoCallTimer = null;
    }
  }

  setAutoCall({ enabled, intervalMs, socketId, hostToken } = {}) {
    const denied = this.assertHost({ socketId, hostToken });
    if (denied) return denied;
    if (intervalMs !== undefined) {
      if (!Number.isInteger(intervalMs) || intervalMs < 500 || intervalMs > 120000) {
        return fail(ErrorCodes.BAD_PAYLOAD, "intervalMs must be an integer between 500 and 120000");
      }
      this.config.callIntervalMs = intervalMs;
    }
    if (typeof enabled === "boolean") this.config.autoCall = enabled;
    if (this.state === GameState.RUNNING) {
      if (this.config.autoCall) this.scheduleAutoCall();
      else this.stopAutoCall();
    }
    this.record({ type: "auto-call", enabled: this.config.autoCall, intervalMs: this.config.callIntervalMs });
    return ok({ autoCall: this.config.autoCall, callIntervalMs: this.config.callIntervalMs });
  }

  // ------------------------------------------------------------------- claims

  /**
   * Verify a claim using authoritative state only. Ordered checks:
   *   1 claimant is a participant of THIS room (and presents their credential)
   *   2 claimant has an assigned ticket
   *   3 the game is RUNNING
   *   4 the pattern exists and is enabled
   *   5 the claimant has not already taken this pattern
   *   6 the pattern has not already been awarded to somebody else
   *   7/8 every required ticket number was really called and the exact pattern
   *        definition holds, verified against the server's own history
   *        (evaluateClaim)
   * Awarding happens in the same synchronous block as the checks when nothing
   * is configured to persist the room, so simultaneous claims cannot both
   * succeed. With a database the transport calls prepareClaim(), commits the
   * award with row locks, then calls commitClaim() - see persist/controller.js.
   */
  claim(params = {}) {
    const prepared = this.prepareClaim(params);
    if (!prepared.ok) return prepared;
    return this.commitClaim(prepared);
  }

  /**
   * Every check, no mutation. Returns the award the caller is entitled to, so
   * the persistence layer can write it durably first.
   */
  prepareClaim({ playerId, pattern, ticketNo, playerToken, socketId } = {}) {
    let player = this.players.get(playerId);
    if (!player && socketId) {
      const bySocket = this.socketToPlayer.get(socketId);
      player = this.players.get(bySocket);
    }
    if (!player) return fail(ErrorCodes.NOT_PLAYER, "you are not a participant of this room");
    if (playerToken !== undefined && player.token !== playerToken) {
      return fail(ErrorCodes.NOT_PLAYER, "bad player credential");
    }
    if (!player.tickets.length) return fail(ErrorCodes.NOT_PLAYER, "no ticket has been assigned to you yet");
    if (this.state !== GameState.RUNNING) {
      return fail(ErrorCodes.INVALID_STATE, "claims need a RUNNING game, it is " + this.state);
    }
    const known = getPattern(pattern, this.config);
    if (!known) return fail(ErrorCodes.UNKNOWN_PATTERN, "unknown or disabled pattern: " + pattern);

    const awarded = this.awards.get(pattern) || [];
    if (awarded.some((entry) => entry.playerId === player.id)) {
      return fail(ErrorCodes.ALREADY_CLAIMED_BY_YOU, "you already claimed " + known.label);
    }
    if (awarded.length && !this.config.multipleWinnersPerPattern) {
      return fail(ErrorCodes.ALREADY_AWARDED, known.label + " was already won by " + awarded[0].name, {
        pattern,
        awardedTo: awarded[0].playerId,
      });
    }

    // Verify against this player's actual tickets. A claim may name one ticket
    // (a targeted claim) or leave it open, in which case the server picks the
    // ticket that completed the pattern earliest. It never trusts a client hint
    // about which ticket won - the grids here are the server's own.
    const verdict = evaluateClaimAcrossTickets(pattern, player.tickets, this.calledNumbers, this.config, {
      ticketNo,
    });
    this.claimLog.push({
      at: this.now(),
      playerId: player.id,
      name: player.name,
      pattern,
      accepted: Boolean(verdict.valid),
      reason: verdict.valid ? "complete" : verdict.reason,
      ticketNo: verdict.valid ? verdict.ticketNo : null,
      callIndex: this.cursor,
    });

    if (!verdict.valid) {
      this.record({ type: "claim-rejected", player: player.id, pattern, reason: verdict.reason });
      const code = verdict.late ? ErrorCodes.CLAIM_TOO_LATE : ErrorCodes.INVALID_STATE;
      return fail(code, "invalid claim: " + verdict.reason, {
        pattern,
        reason: verdict.reason,
        ...(verdict.late ? { late: true } : {}),
      });
    }

    return ok({
      prepared: {
        playerId: player.id,
        pattern,
        label: known.label,
        points: known.points,
        ticketNo: verdict.ticketNo,
        completedOnCall: verdict.completedOnCall ?? null,
        callIndex: this.cursor,
      },
    });
  }

  /**
   * Apply a prepared award. Kept separate from the checks so a database can
   * arbitrate exclusivity (and survive a restart) between the two.
   */
  commitClaim(preparedOrResult = {}) {
    const prepared = preparedOrResult.prepared || preparedOrResult;
    if (!prepared || !prepared.playerId || !prepared.pattern) {
      return fail(ErrorCodes.INVALID_STATE, "nothing was prepared to commit");
    }
    const player = this.players.get(prepared.playerId);
    if (!player) return fail(ErrorCodes.NOT_PLAYER, "that participant is gone");
    // A claim prepared on the last tick of a round must not be paid out into the
    // results screen: the window is re-checked here as well, against the same
    // authoritative history, because the durable path awaits a database write
    // between preparing and committing.
    if (this.state !== GameState.RUNNING) {
      return fail(ErrorCodes.INVALID_STATE, "the round ended before the claim was awarded", {
        pattern: prepared.pattern,
      });
    }
    const window = this.config.claimWindowCalls;
    if (Number.isInteger(window) && window >= 0 && Number.isInteger(prepared.completedOnCall)) {
      const lateBy = this.calledNumbers.length - prepared.completedOnCall;
      if (lateBy > window) {
        return fail(ErrorCodes.CLAIM_TOO_LATE, "invalid claim: the next number was called before the award landed", {
          pattern: prepared.pattern,
          late: true,
        });
      }
    }
    const known = getPattern(prepared.pattern, this.config);
    if (!known) return fail(ErrorCodes.UNKNOWN_PATTERN, "unknown pattern: " + prepared.pattern);

    const awarded = this.awards.get(prepared.pattern) || [];
    if (awarded.some((entry) => entry.playerId === player.id)) {
      return fail(ErrorCodes.ALREADY_CLAIMED_BY_YOU, "you already claimed " + known.label);
    }
    if (awarded.length && !this.config.multipleWinnersPerPattern) {
      return fail(ErrorCodes.ALREADY_AWARDED, known.label + " was already won by " + awarded[0].name, {
        pattern: prepared.pattern,
        awardedTo: awarded[0].playerId,
      });
    }

    player.points += known.points;
    player.claims.push(prepared.pattern);
    awarded.push({
      playerId: player.id,
      name: player.name,
      points: known.points,
      ticketNo: prepared.ticketNo ?? null,
      callIndex: prepared.callIndex ?? this.cursor,
      at: this.now(),
    });
    this.awards.set(prepared.pattern, awarded);
    this.record({ type: "claim", player: player.id, pattern: prepared.pattern, points: known.points });

    const result = {
      pattern: prepared.pattern,
      label: known.label,
      won: true,
      playerId: player.id,
      name: player.name,
      points: known.points,
      ticketNo: prepared.ticketNo ?? null,
      leaderboard: this.leaderboard(),
      awards: this.awardList(),
    };
    this.emit("claim:result", result);
    this.emit("room:updated", { players: this.playersList() });
    return ok(result);
  }

  /** Read-only: could this player truthfully claim this pattern right now? */
  claimability(playerId, pattern) {
    const player = this.players.get(playerId);
    if (!player || !player.tickets.length) return { valid: false, reason: "no ticket" };
    return evaluateClaimAcrossTickets(pattern, player.tickets, this.calledNumbers, this.config, {});
  }

  leaderboard() {
    return [...this.players.values()]
      .map((p) => ({ playerId: p.id, player: p.name, points: p.points, claims: p.claims.slice() }))
      .sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));
  }

  awardList() {
    const out = [];
    for (const [pattern, winners] of this.awards.entries()) {
      for (const winner of winners) {
        out.push({
          pattern,
          label: PATTERNS[pattern].label,
          playerId: winner.playerId,
          name: winner.name,
          points: winner.points,
          ticketNo: winner.ticketNo ?? null,
          callIndex: winner.callIndex,
        });
      }
    }
    return out.sort((a, b) => a.callIndex - b.callIndex);
  }

  // --------------------------------------------------------------- chat + misc

  chat({ playerId, playerToken, text } = {}) {
    const player = this.players.get(playerId);
    if (!player || (playerToken !== undefined && player.token !== playerToken)) {
      return fail(ErrorCodes.NOT_PLAYER, "unknown player or bad credential");
    }
    if (typeof text !== "string") return fail(ErrorCodes.BAD_PAYLOAD, "text must be a string");
    const clean = text.replace(/[\u0000-\u001f]/g, "").trim().slice(0, this.config.maxChatLength);
    if (!clean) return fail(ErrorCodes.BAD_PAYLOAD, "empty message");
    const last = this.lastChatAt.get(player.id) || 0;
    if (this.now() - last < this.config.chatIntervalMs) {
      return fail(ErrorCodes.RATE_LIMITED, "one message every " + this.config.chatIntervalMs + "ms");
    }
    this.lastChatAt.set(player.id, this.now());
    const message = {
      // an opaque id so a client can recognise a message it has already shown:
      // a seat that rejoins gets the history replayed, and the live broadcast of
      // the next message must not double up anything already on screen
      id: "c-" + newToken(10),
      from: player.name,
      playerId: player.id,
      text: clean,
      at: this.now(),
    };
    this.chatLog.push(message);
    if (this.chatLog.length > CHAT_HISTORY) this.chatLog.splice(0, this.chatLog.length - CHAT_HISTORY);
    this.emit("chat:message", message);
    return ok({ sent: true, text: clean, id: message.id });
  }

  /**
   * The room's conversation, oldest first. Deliberately NOT part of any snapshot
   * — it is read on demand by a seat that just arrived (chat:history), so a room
   * full of players does not re-send the same text on every number call.
   */
  recentChat() {
    return this.chatLog.slice();
  }

  // ------------------------------------------------------------------ snapshot

  stateView() {
    return {
      roomId: this.roomId,
      state: this.state,
      calledCount: this.cursor,
      remaining: this.draw.length ? this.draw.length - this.cursor : null,
      lastCall: this.calledNumbers.length ? this.calledNumbers[this.calledNumbers.length - 1] : null,
      autoCall: Boolean(this.config.autoCall),
      callIntervalMs: this.config.callIntervalMs,
      enabledPatterns: enabledPatternIds(this.config),
    };
  }

  /** What every participant may see. Never includes the future draw. */
  publicSnapshot() {
    return {
      roomId: this.roomId,
      ...this.stateView(),
      calledNumbers: this.calledNumbers.slice(),
      players: this.playersList(),
      awards: this.awardList(),
      leaderboard: this.leaderboard(),
    };
  }

  /** Public snapshot plus the requester's own tickets only. */
  playerSnapshot(playerId) {
    const base = this.publicSnapshot();
    const player = this.players.get(playerId);
    if (!player) return base;
    return {
      ...base,
      playerId: player.id,
      name: player.name,
      points: player.points,
      claims: player.claims.slice(),
      ticket: player.tickets.length ? player.tickets[0].grid : null,
      tickets: player.tickets.map(publicTicket),
      ticketCount: player.ticketCount,
      maxTickets: this.ticketCeiling(),
    };
  }

  /** Host view: everything a player sees plus room internals, still no draw tail. */
  hostSnapshot() {
    return {
      ...this.playerSnapshot(this.hostPlayerId),
      hostConnected: Boolean(this.hostSocketId),
      roomId: this.roomId,
      recentEvents: this.audit.slice(-50),
      claimLog: this.claimLog.slice(-50),
    };
  }

  destroy() {
    this.stopAutoCall();
    for (const timer of this.pendingRemovals.values()) this.clearTimer(timer);
    this.pendingRemovals.clear();
  }
}

/** Convenience factory used by the socket layer and the tests. */
export function createRoom(options = {}) {
  return new TambolaRoom(options);
}
