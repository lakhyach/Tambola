import { randomBytes } from "node:crypto";

const INSTANCE_ID = /^[a-zA-Z0-9_-]{1,80}$/;

/** Short-lived, one-use tickets bridge the path-scoped owner cookie to Socket.IO. */
export function createBookingRealtime({ now = () => Date.now(), ttlMs = 30_000 } = {}) {
  const tickets = new Map();
  function issue({ instanceId, ownerSessionId }) {
    if (typeof instanceId !== "string" || !INSTANCE_ID.test(instanceId) || typeof ownerSessionId !== "string" || !ownerSessionId) return null;
    const at = now();
    for (const [key, ticket] of tickets) if (ticket.expiresAt <= at) tickets.delete(key);
    if (tickets.size >= 5000) tickets.delete(tickets.keys().next().value);
    const token = randomBytes(32).toString("hex");
    tickets.set(token, { instanceId, ownerSessionId, expiresAt: at + ttlMs });
    return token;
  }
  function consume(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    const ticket = tickets.get(token);
    tickets.delete(token);
    return ticket && ticket.expiresAt > now() ? { instanceId: ticket.instanceId, ownerSessionId: ticket.ownerSessionId } : null;
  }
  return { issue, consume, room(instanceId) { return `admin-bookings:${instanceId}`; } };
}
