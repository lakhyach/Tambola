import test from "node:test";
import assert from "node:assert/strict";
import { generateTickets, validateTicket } from "../server/game/ticket.js";
import { makeRng } from "./helpers.js";

const fingerprint = (grid) => grid.flat().filter(Number.isInteger).sort((a, b) => a - b).join(",");

test("ticket generator produces the requested valid unique batches through the configured 10,000 maximum", () => {
  for (const count of [1, 10, 100, 200, 500, 10_000]) {
    const tickets = generateTickets(count, makeRng(0x71c000 + count));
    assert.equal(tickets.length, count, `${count} requested tickets are returned`);
    assert.equal(new Set(tickets.map(fingerprint)).size, count, `${count} ticket number sets are unique`);
    for (const [index, ticket] of tickets.entries()) {
      assert.equal(validateTicket(ticket).valid, true, `ticket ${index + 1} of ${count} is valid`);
    }
  }
});
