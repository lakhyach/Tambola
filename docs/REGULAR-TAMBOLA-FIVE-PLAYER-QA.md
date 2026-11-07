# Ninety Club Regular Tambola: scheduled start and five-player QA guide

This guide follows the current Ninety Club screens and server behavior. The Regular and Bumper halls share the durable scheduled-start worker; Regular is selected by the room/session's `regular` game instance. This feature requires migration 033, which is already present in the verified production schema. Existing sessions default to host-controlled start.

## Before scheduling a real QA session

- Use a free, non-monetary game. Ninety Club has no payment, wager, cash-prize, or payout flow.
- Arrange five real people who agree to participate. Do not create accounts or bookings on their behalf. A host also receives a player seat and ticket; if the host is not one of the five test participants, the room will have six seats.
- Use an owner-published Regular game hall and a time when all participants can remain connected. No one needs a player account: a player joins with a display name and room code. A confirmed reservation instead uses its reservation reference and private booking code.
- Schedule only after the group is ready. A published auto-start session is a real public session. Do not create one just to test the UI.

## 1. Open a Regular room

1. Open `https://ninetyclub.cloud/host?instance=regular`. This is the public room-creation flow, not the owner/Admin sign-in flow. The server creates a host seat and returns a private session credential; keep the host browser session private and do not share its saved session token.
2. Enter the host's display name (at least three characters). If a hall selector is shown, choose Regular Tambola.
3. Choose **Create room**. The server returns the room code; it is not chosen by the browser.
4. On the waiting screen, copy or share the invite link. Keep the room code private to the invited group.
5. Select the host's ticket count in the ticket picker. The host is a player in the room and can make claims.
6. Review the host's pattern list before anyone starts. The six standard patterns are enabled; the five optional patterns are initially off on the server. The public host creation screen attempts to enable optional patterns automatically, then displays a review notice if it could not. Host-selectable patterns can be changed while the room is waiting; the choices lock at start.

The UI route wiring for `/host`, `/host/room`, and `/host/game` was missing in the checked-out candidate even though those screens and the server handlers exist. This work restores those routes and adds a regression test. Do not assume the route fix is live until a corrected image is released.

## 2. Create and publish the scheduled Regular session

Owner/admin access is through `https://ninetyclub.cloud/admin/signin`; MFA remains required. In the admin navigation open **Bookings** (the route is `/admin/sessions`). This page is the session and ticket inventory manager.

1. Select the **Regular Tambola** game instance.
2. Fill **Session name**.
3. Set **Scheduled start** to a future local date and time.
4. Select **Event time zone** (for example `Asia/Kolkata`). The UI converts the entered wall-clock time to a UTC instant and saves the IANA timezone for display.
5. Set **Booking opens** and **Booking closes**. Both must be valid and ordered before the scheduled start: open < close < start.
6. Set **Tickets to generate** from 1 to 10,000. For five one-ticket participants, use at least five inventory tickets. Capacity is session ticket inventory, not a guarantee of five seats in the room.
7. Enter the room code from step 1. The code must belong to a waiting room in the selected Regular instance. The UI requires it when automatic start is enabled.
8. Check **Automatically start this game at the scheduled time**. The default is off. Patterns and voice/caller settings are not configured here; they belong to the room and host caller console.
9. Choose **Create and generate tickets**. Wait for the confirmation that all requested numbered tickets were generated and saved. If the result is uncertain, use the displayed retry for that same generation task; do not create a second session.
10. Review the session row, room, timezone-rendered schedule, inventory count, and auto-start status. Choose **Publish** when the details are correct. Drafts are private; published sessions appear in public listings.

Direct-join seats receive engine-generated ticket grids when they choose a ticket count. For a numbered-inventory booking, the reservation's exact allocated ticket grids and serials are assigned to that player when they join; verify those assigned tickets in the waiting room. Legacy bookings without numbered inventory use engine-generated grids at the locked booking count.

To cancel before start, use **Cancel** in the session row and confirm. A cancelled auto-start session is not eligible for the worker. Once the game has started, cancellation is refused. Pause/reopen controls affect booking visibility; they are not game pause controls.

## 3. Five participants and booking

Label the people in your notes **QA Player 1** through **QA Player 5**. These are labels only, not accounts created by the system.

### Direct room join

1. Share the host invite link or the room code privately with each participant.
2. Each participant opens `/player`, enters a display name (at least three characters) and the room code, then chooses **Join**.
3. Each person chooses 1 or more tickets with the waiting-room ticket picker, up to the room's configured ceiling (default 4, hard maximum 12 per seat).
4. Confirm that the waiting room shows a connected seat and that the ticket preview is present. Refresh/reconnect before start to confirm the same seat and tickets return.

### If you want to exercise session bookings

1. Each participant opens the published session link (`/sessions/<session-id>`) from the public session listing.
2. For numbered inventory, select available ticket cards, enter a display name, and choose the booking action. Complete **Confirm reservation** if the reservation is held.
3. Save the displayed reservation reference and private booking code. The booking page offers copy; do not post the private code in group chat.
4. The confirmed booking page shows **Join game** when a room is assigned. The participant opens it and joins using the booking credentials under the player form's booking section. Confirm the participant has entered the waiting room and their issued ticket is visible before the scheduled start.
5. The owner sees reservation status and allocation in **Bookings**. Inventory status is available from **Inventory**. Do not treat a hold as confirmed; holds expire. A confirmed booking does not itself prove that the player joined the room.

The booking flow is free and has no payment step. Public availability comes from persisted reservation and inventory records. Booking is bounded by the configured open/close window and remaining capacity; after close or start, new booking is unavailable. A cancelled/expired hold releases capacity. Confirmed reservations are retained for history when a session is cancelled.

## 4. Verify the scheduled start

Use a short future time only for an authorized, consenting QA session. All five seats should join and select tickets several minutes beforehand. The worker is server-authoritative and polls durable published sessions; database time decides whether a session is due. It atomically leases the session, checks the room belongs to the same active game instance, requires the room to be waiting and at least one joined player, transitions the room to running, persists the scheduled/actual timestamps, then arms the durable number caller.

| Time relative to a 15:00 Asia/Kolkata start | Check |
|---|---|
| 14:45 | Publish and verify Regular hall, room code, booking window, ticket inventory and `Asia/Kolkata`; invite the five people. |
| 14:50 | All players join, select tickets, verify each seat and take screenshots without exposing reservation codes. |
| 14:55 | Refresh one player browser and reconnect it; confirm it returns to the same waiting room/tickets. The host should not press **Start Game** for an auto-start session. |
| 14:59 | Confirm all seats see waiting state and that no number has been called. The server may show the session as Scheduled/Waiting; the public countdown is informational. |
| 15:00 | Observe the room transition to Running without a host click. Record browser/local timezone and server/session timestamps shown by authorized diagnostics. |
| 15:00 onward | Confirm one transition, then the caller begins according to the room's auto-call setting/interval. Check all players see the same call and history. |

There is no guaranteed human-visible event at the exact millisecond: worker polling and process scheduling add a small delay. A session with no joined players remains in **Waiting for players** and is retried; the configured time does not fabricate a seat. A restart recovers the durable schedule and room state. Cancellation before the worker starts prevents execution. A manual host start while auto-start is reserved is refused with `AUTO_START_RESERVED` until the session is cancelled/disabled through supported session management.

The selected timezone labels the schedule; it does not change the instant already saved. For a test in another timezone, read the displayed timezone abbreviation and compare the UTC instant, not a device's unlabelled clock.

## 5. Run the live round

1. The host enters `/host/game` after start. Players move to `/player/game` automatically.
2. Verify each player's own ticket and the 1–90 board. Calls mark matching ticket cells automatically from the official call history; there is no tap-to-mark control.
3. The default caller is automatic at the room interval. The host can use **Pause**, **Resume**, **Auto: On/Off**, and interval controls in the caller console. The supported interval chips are 3, 5, 8, 10, 15, 20, and 30 seconds. Manual **Call next number** is available when auto-call is off. These controls require host authority; players do not see them.
4. Voice is optional and local to each browser. Speech depends on that device/browser and starts only after browser interaction. The caller console offers English, Hindi, and Hinglish; playful callouts are optional. Available browser voices vary, so check the voice panel on each device. The visible number, board, and call history remain authoritative.
5. Players choose a claim button only when it becomes available. The server evaluates the player's server-issued tickets against official calls, applies the claim window/grace rules, and sends the result. The room allows one winner per pattern by default; claims for already-awarded patterns and duplicate claims are rejected. The host does not manually approve a valid claim in the default flow.
6. Standard patterns: Early Five (any five of one ticket's 15 numbers), Top Line, Middle Line, Bottom Line (all five in that row), Corners, and Full House (all 15). Optional host-selectable patterns are Early Seven, Star, Box, Second Full House, and Half Sheet. Review the diagrams/hints in the waiting-room pattern panel; only enabled patterns are claimable. Half Sheet requires at least three tickets on one seat, with any two called numbers on each of three tickets. Second Full House is a different ticket finishing after the first Full House award.
7. The host may pause and resume; the server clock pauses too. **End round** is a two-step host action and completes the game for everyone. Results, awards and leaderboard remain available. **Reset room** is separately guarded and begins another round; do not use it until results are recorded.
8. A late joiner can observe/chat but has no current-round ticket and cannot claim; ticket selection applies to the next round. If a connection drops, wait for Socket.IO to reconnect or refresh. A player seat's saved session restores tickets, call history, claims and results. Host reconnection restores the console; the room may pause while the host is disconnected.
9. Chat is room-local and currently memory-only; server restart clears chat history, while durable game state is recovered. Do not use chat as an audit record.

## 6. Five-player test matrix

Use a separate row per player and fill **Actual**, **Pass/Fail**, and **Evidence/defect** during the session. Never include passwords, MFA codes, private booking codes, session tokens, or screenshots containing them.

| ID | Participant | Action | Expected behavior | Actual | Pass/Fail | Evidence / defect |
|---|---|---|---|---|---|---|
| R01 | Host + QA Player 1–5 | Create Regular room and verify code/link | One waiting room in Regular; host is a seat | | | |
| R02 | Host | Create session inventory | Exact requested ticket count reaches Ready; retries are idempotent | | | |
| R03 | QA Player 1–5 | Reserve one ticket each (if testing booking) | Each booking is confirmed, capacity decreases once, ticket serials shown | | | |
| R04 | QA Player 1–5 | Join and choose tickets | Five distinct seats connect; each sees its server-issued grid | | | |
| R05 | Host | Inspect auto-start and room configuration | Auto-start enabled only for this session; correct Regular instance and timezone | | | |
| R06 | Everyone | Observe before scheduled instant | Room remains WAITING; no official calls | | | |
| R07 | Everyone | Wait through scheduled instant | One RUNNING transition; no host Start click | | | |
| R08 | Everyone | Observe caller | First call follows successful transition; all clients show same number/history | | | |
| R09 | QA Player 1–5 | Refresh/reconnect one at a time | Same seat/tickets and current history return | | | |
| R10 | QA Player 1–5 | Check ticket after calls | Called numbers mark automatically, no local tap marks | | | |
| R11 | QA Player with valid pattern | Submit claim | Server verdict/award appears consistently in player and host views | | | |
| R12 | Another player | Submit already-won pattern | Duplicate/exclusive claim is refused with clear feedback | | | |
| R13 | Host | Pause, resume, change cadence | State and caller pace synchronize; no duplicate call | | | |
| R14 | Host | End round | Everyone sees completed state, final awards and results | | | |
| R15 | Host | Refresh console after completion | Durable room/results reload; no call is replayed | | | |
| R16 | Host | Cancel a separate not-yet-started QA session | It does not auto-start; do not cancel the live test session | | | |

Record room/session ID (not credentials), local time and timezone, browser/device, player label, exact steps, expected versus actual, whether one/all participants were affected, and a screenshot/video with secrets cropped. A useful defect report is:

```text
Test ID:
Browser/device and version:
Room/session ID:
Participant label (no private token):
Timestamp and timezone:
Reproduction steps:
Expected:
Actual:
Affected: one participant / everyone
Evidence (cropped):
```

## Supported and known limitations

- Supported: Regular and Bumper use the shared durable auto-start worker; migration 033 makes it opt-in per published session; timezone is persisted; atomic database claiming prevents duplicate worker starts; restart recovery is implemented; manual sessions remain host-controlled; caller starts after the room transition; tickets and claims are server-validated.
- Booking test fixture correction: the earlier failure came from trying to publish a draft after its booking window had expired. The fixture now publishes while the window is valid, closes it afterward using database time, verifies public visibility with booking closed, and confirms an already-expired draft still cannot be published. The integration test passes against isolated PostgreSQL 17.
- Local release checks: the full suite, including a real `pg_dump`/`pg_restore` backup and restore, passes against an isolated PostgreSQL 17.11 cluster using the native `PG_BIN` driver. No Docker container is required for that verified path.
- Browser and manual QA status: Codex Computer Use still fails with `failed to write kernel assets: The system cannot find the path specified`. An isolated Chrome 157 profile was therefore used against the local Vite app and a separate test-schema API. The public `/host` and `/player` screens rendered; `/host/room` and `/host/game` without a saved host session returned to `/host`; `/admin/sessions` redirected to `/admin/signin`; no HTTP responses with 4xx/5xx status or uncaught browser exceptions were observed on those pages. No room, account, reservation, or game was created. Owner-only session configuration and gameplay screens were not exercised because that would require an authorized QA owner and real participants. The guide is ready for manual QA with five consenting participants; that QA remains outstanding.
- No user-supplied five-person QA group is available in this task. Do not create a production session or claim a real five-player result without those consenting participants.
