import { randomUUID } from "node:crypto";

/** Durable worker for published sessions with automatic start enabled. */
export function createScheduledStartScheduler({
  store,
  controller,
  log = () => {},
  intervalMs = 1000,
  claimLeaseMs = 30000,
  retryMs = 5000,
  maxRoomRetryAttempts = 10,
  canRun = () => true,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
  unref = false,
} = {}) {
  if (!store || typeof store.claimDueScheduledStart !== "function") throw new Error("scheduled start scheduler needs a durable store");
  if (!controller || typeof controller.startScheduled !== "function") throw new Error("scheduled start scheduler needs a controller");
  const period = Number(intervalMs);
  if (!Number.isFinite(period) || period < 100 || period > 60000) throw new Error("scheduled start polling interval is out of range");

  let timer = null;
  let stopped = true;
  let running = false;
  let runToken = 0;

  function authorized() {
    if (stopped) return false;
    try { return canRun() !== false; } catch { return false; }
  }

  async function runOnce() {
    if (running || !authorized()) return { skipped: true };
    running = true;
    const token = ++runToken;
    let claimedCount = 0;
    try {
      for (let index = 0; index < 50 && authorized() && token === runToken; index += 1) {
        const claimToken = randomUUID();
        const claim = await store.claimDueScheduledStart({ claimToken, leaseMs: claimLeaseMs, retryMs });
        if (!claim?.claimed) {
          if (claim?.failed) log("scheduled game start rejected", claim.sessionId, claim.errorCode);
          if (claim?.reconciled) log("scheduled game start reconciled", claim.sessionId);
          break;
        }
        claimedCount += 1;
        // A lease can be lost while the claim query is in flight. Do not let a
        // draining/stale process start a game after it has lost authority; the
        // durable claim expires and a healthy process recovers it.
        if (!authorized() || token !== runToken) break;
        const result = await controller.startScheduled({ sessionId: claim.sessionId, claimToken });
        if (result?.ok) {
          log("scheduled game started", claim.sessionId, claim.roomCode, claim.scheduledAt);
          continue;
        }
        const code = String(result?.code || "SCHEDULED_START_FAILED").slice(0, 80);
        if (code === "SCHEDULED_START_CLAIM_LOST") {
          log("scheduled game start claim lost", claim.sessionId);
          continue;
        }
        const retry = code === "NO_PLAYERS"
          || (code === "ROOM_NOT_LIVE" && Number(claim.attempts || 0) < maxRoomRetryAttempts);
        const released = await store.releaseScheduledStartClaim({
          sessionId: claim.sessionId,
          claimToken,
          retry,
          retryMs,
          errorCode: code,
        });
        log(retry ? "scheduled game waiting" : "scheduled game start failed", claim.sessionId, released.state, code);
      }
      return { claimedCount };
    } catch (error) {
      // A transaction may have committed even if its response was lost. Leave
      // the claim to expire; the next pass reconciles against durable room/game
      // state instead of blindly starting a second round.
      log("scheduled start worker pass failed", error?.code || error?.name || "error");
      return { error: error?.code || "SCHEDULED_START_WORKER_FAILED", claimedCount };
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (!authorized() || timer) return;
    timer = setTimer(async () => {
      timer = null;
      await runOnce();
      schedule();
    }, period);
    if (unref && typeof timer?.unref === "function") timer.unref();
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    runOnce().finally(schedule);
  }

  function stop() {
    stopped = true;
    runToken += 1;
    if (timer) clearTimer(timer);
    timer = null;
  }

  return { start, stop, runOnce, isRunning: () => running, isStarted: () => !stopped };
}
