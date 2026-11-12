export const GAME_JOURNEY_STEPS = Object.freeze(["setup", "tickets", "play"]);

export function gameJourneyStepForRoom(state) {
  return state === "WAITING" ? "tickets" : "play";
}

export function gameJourneyStepForSession({ status, gameStatus } = {}) {
  if (status === "draft") return "setup";
  return ["live", "starting", "paused", "completed"].includes(gameStatus) ? "play" : "tickets";
}
