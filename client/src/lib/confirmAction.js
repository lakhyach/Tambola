/**
 * The confirmation step for a destructive host action.
 *
 * "End game" and "Reset" both destroy a round in progress, so they were guarded
 * by `window.confirm()`. That guard worked, but it is a native dialog: it is
 * outside the design, unreadable to assistive technology, invisible to every
 * automated check (a browser driver simply stops responding until a human
 * clicks it), and it cannot be reworded per state. So the guard lives here
 * instead, as an explicit second click on the same control.
 *
 * The rule, kept in one pure function so it can be tested without a DOM:
 *   first click on a destructive action  → arm it, fire nothing
 *   second click while it is armed       → fire it, disarm
 *   click on a DIFFERENT destructive one → re-arm onto that one, fire nothing
 *   cancel                               → disarm, fire nothing
 * Only one action can be armed at a time: two armed confirmations on one small
 * panel is how the wrong one gets clicked.
 */

/** The host actions that cannot be undone once sent. */
export const DESTRUCTIVE = Object.freeze(["game:end", "game:reset"]);

/**
 * What the panel says while an action is armed. Keyed by action; `confirm` is
 * the sentence under the buttons, `armed` the label the button takes.
 */
export const CONFIRM_COPY = Object.freeze({
  "game:end": {
    armed: "Confirm: end game",
    confirm: "End this round now? Every seat loses the rest of it, and only Reset follows. Click again to confirm.",
  },
  "game:reset": {
    armed: "Confirm: reset room",
    confirm: "Reset the room? Calls, awards and scores clear and every seat goes back to picking tickets. Click again to confirm.",
  },
});

/**
 * One click on a destructive control, given what is already armed.
 *
 * The returned `armed` is the whole new state of the panel: an action that just
 * fired is no longer armed, so nothing can fire twice by accident.
 *
 * @param {string|null} armed the currently armed action, if any
 * @param {string} action the control that was clicked
 * @returns {{armed: string|null, fire: boolean}}
 */
export function press(armed, action) {
  if (!DESTRUCTIVE.includes(action)) return { armed, fire: false };
  return armed === action ? { armed: null, fire: true } : { armed: action, fire: false };
}

/** A click on Cancel (or any state change) leaves nothing armed. */
export function disarm() {
  return null;
}
