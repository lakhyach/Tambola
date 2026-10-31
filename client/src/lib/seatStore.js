/**
 * Where a seat credential lives in the browser, and why it is in two places.
 *
 * `tab` (sessionStorage) holds THIS TAB's seat: a refresh finds it again, and two
 * windows of one browser can each hold a different seat - the host in one, a
 * player in the other - without overwriting each other.
 *
 * `device` (localStorage) holds the device's last seat and is read only by a tab
 * that has no seat of its own. That is what keeps the landing-page promise ("your
 * ticket lives through a refresh") true on a phone whose browser dropped and
 * rebuilt the tab.
 *
 * `load()` applies that fallback. `loadOwn()` deliberately does not, and
 * `loadPending()` reports the fallback separately so a screen can *ask* before
 * taking it: the join page must never silently seat a brand-new tab as whoever
 * last played on this browser, because then two tabs are not two players.
 *
 * Before this split both lived in one shared slot, so a second window silently
 * resumed the first window's seat, and a host who opened their own invite link
 * became a player and lost the draw controls.
 *
 * This module is storage-agnostic and throws nothing: unavailable storage
 * (private mode, a disabled API, a quota error) degrades to "this seat cannot be
 * resumed", which net.js and the node suite can both drive with stubs.
 */

export const SEAT_KEY = "tambola.session.v2";

/** A slot only counts as a seat when it carries the credential to resume it. */
export function isSeat(value) {
  return Boolean(value && value.roomId && value.sessionToken);
}

function readSlot(target) {
  if (!target) return {};
  try {
    const raw = JSON.parse(target.getItem(SEAT_KEY));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeSlot(target, value) {
  if (!target) return;
  try {
    target.setItem(SEAT_KEY, JSON.stringify(value));
  } catch {
    /* quota or private mode: the server still holds the seat */
  }
}

function removeSlot(target) {
  if (!target) return;
  try {
    target.removeItem(SEAT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {{tab?: unknown, device?: unknown}} [slots] Storage-like objects, or
 *   anything missing/throwing - each case is treated as "no memory here".
 */
export function createSeatStore({ tab = null, device = null } = {}) {
  return {
    /** This tab's seat first; the device's last seat only as a fallback. */
    load() {
      const own = readSlot(tab);
      if (isSeat(own)) return own;
      const saved = readSlot(device);
      return isSeat(saved) ? saved : own;
    },

    /**
     * Only what THIS tab holds. The join page needs the distinction: a tab that
     * carries its own seat is that player coming back, and resuming it silently
     * is right. A tab that carries nothing is a brand-new tab, and the device
     * copy it could fall back to belongs to whoever last sat down on this
     * machine — handing it out without asking turns a new tab into that player.
     */
    loadOwn() {
      const own = readSlot(tab);
      return isSeat(own) ? own : {};
    },

    /** The device-level copy, but only when this tab has no seat of its own. */
    loadPending() {
      const own = readSlot(tab);
      if (isSeat(own)) return {};
      const saved = readSlot(device);
      return isSeat(saved) ? saved : {};
    },

    /** Record the seat in this tab and refresh the device-level recovery copy. */
    save(patch = {}) {
      const next = { ...this.load(), ...patch };
      writeSlot(tab, next);
      writeSlot(device, next);
      return next;
    },

    /**
     * Forget this tab's seat. The device-level copy is dropped only when it is
     * the same seat, so one window leaving a room cannot erase a neighbouring
     * window's host or player credential.
     */
    clear() {
      const own = readSlot(tab);
      removeSlot(tab);
      const saved = readSlot(device);
      if (!isSeat(own) || saved.sessionToken === own.sessionToken) removeSlot(device);
    },
  };
}

/** Pick the real browser slots; a window without storage yields null slots. */
export function browserSlots(source) {
  const pick = (name) => {
    try {
      return source?.[name] || null;
    } catch {
      return null;
    }
  };
  return { tab: pick("sessionStorage"), device: pick("localStorage") };
}
