# Reference video analysis

Source: [“Latest TAMBOLA update | how to make own own TAMBOLA website | new admin panel”](https://www.youtube.com/watch?v=71hnNf9X3GE), publisher MAKE TAMBOLA. Direct browser playback reached **8:57 / 8:57**. The page marks the video auto-dubbed; Hindi auto-captions appeared during playback. YouTube transcript export returned “No transcript is available,” so observations come from watching the video and visible UI, not a transcript. UI states are direct evidence; unshown save, authorization, database, payment, and error behavior is not inferred.

## Timestamped observations

| Timestamp | Screen/workflow | Visible elements | User action | Observed result | Evidence confidence |
|---|---|---|---|---|---|
| 00:00–00:50 | Intro and player flow | Browser tabs and Tambola page; captions describe choosing tickets. | Narration describes selection; click outcome is not clear in this interval. | Introduces a hosted Tambola site and player flow. | Direct for screen/title; partial for workflow. |
| 00:50–01:20 | New booking | “New Booking” modal over a dated/time-based game page; name/phone-looking fields, ticket grid, “Book Now,” and countdown. | Ticket selection/booking is discussed; complete submit result is not established here. | Grid and booking UI are shown. Inventory hold and expiry behavior are not shown. | Direct for UI; booking semantics unclear. |
| 01:35–02:05 | Prize/configuration form | Pattern/prize rows, numeric values, check marks; visible rows include top/middle/bottom line, corners, quick games and bonuses. | Narration discusses prize values/configuration. | Values and enabled/disabled marks are visible. Persistence/effect is not demonstrated. | Direct for form; partial for action/effect. |
| 02:05–02:25 | Poster creation | Jackpot-style poster preview with date/time and prize list; “Book Now” link and contact/price-like details. | Narration describes automatic poster creation. | Poster preview is visible. Download/share behavior is not proven. | Direct for preview; action outcome unclear. |
| 02:35–03:00 | Run-game controls | “RUN GAME,” cadence choices (8, 10, 12, 18, 20, 60 seconds), prize/pattern buttons, “Reset Ticket,” “Reset Game.” | Narration explains run/reset controls. | Controls are visible. Reset effect and confirmation are not demonstrated. | Direct for controls; effects unclear. |
| 03:05–03:30 | Themes/store and mobile preview | Theme-store-like page; three phone mockups show ticket rows and “Buy,” WhatsApp, and search-like controls. | Narration discusses choosing a design/theme. | Multiple mobile previews are displayed. No transaction is observed. | Direct for preview; Buy/WhatsApp semantics unverified. |
| 03:40–04:30 | Ticket booking detail | “New Booking” form has customer name and phone, a summary such as “Random: 4,5,” Half Sheet and Fullsheet labels, ticket grid, “Book Now,” then “Done.” | A demo player name/phone is present; ticket cells are selected. | Selected cells highlight yellow and a booking summary appears. Whether a reservation is committed or reversible is unclear. | Direct for selection and visible summary; persistence unclear. |
| 04:55–05:25 | Ticket lookup / prize categories | “Search Your Ticket” input and button; categories such as Full House, Second Full House, Fullsheet Bonus, Halfsheet Bonus. | Narration refers to ticket search/monitoring. | Search and categories are visible; no query result is conclusively demonstrated. | Direct for UI; action/result unclear. |
| 05:25–06:05 | Player/live number board | 1–90 number grid, date/time, three counters, called numbers marked, colored ball/call strip, “Search Your Ticket.” | Game is running and calls appear. | Board marks called numbers and call strip grows. | Direct for live visual change. |
| 06:35–07:15 | Ongoing game / caller relationship | 90-number grid continues; captions refer to running a game from admin. | No distinct click is visible in sampled frames. | Public board remains live with called numbers marked. Synchronization mechanism is not shown. | Direct for state; implementation unknown. |
| 07:25–08:05 | Live prize/result panel | “game is live,” tiles for Full House, Second Full House, Fullsheet Bonus, Halfsheet Bonus, Corner, Middle Line, Bottom Line and Quick 5; some Fullsheet/Halfsheet entries show ticket-number/player attribution. | Narration discusses game-over/result display. | Prize tiles and “TNO”/player entries appear while status still says live. Final completed state is not shown in this panel. | Direct for displayed state; final behavior unproven. |
| 08:15–08:35 | Game settings | “Game Settings”; date/time picker, total ticket limit (“unlimited” nearby; 600 displayed), ticket price 200, dropdown and “Save game.” | Narration says settings can be selected/saved. | Values and Save control are visible. No successful save or resulting game is verified. | Direct for fields; persistence and price meaning unclear. |
| 08:40–08:57 | Website registration / outro | Registration form asks name, email, phone, website name and password, then “NEXT STEP.” | Narration discusses obtaining/designing a website. | Registration screen is shown; form is not submitted. | Direct for form; no account created. |

Playback reached the full duration; timestamps in the table are sampled observations, with denser samples around booking, admin controls, the live board, and the close. This is not a frame-by-frame review. Click results are recorded only where shown. The video does not clearly establish a distinct agent dashboard, authorization roles, tenant boundaries, booking cancellation/expiry, payment flow, report export, or completed-game transition.

## Reference routes

Each supplied route was attempted over ordinary HTTPS navigation. All six returned ERR_CERT_COMMON_NAME_INVALID. I stopped at the browser’s TLS failure and did not bypass it. None is observable in this review.

| Route | Result |
|---|---|
| https://super777tambola.com/ | TLS certificate name mismatch; not observed. |
| https://super777tambola.com/admin | TLS certificate name mismatch; not observed. |
| https://super777tambola.com/agent | TLS certificate name mismatch; not observed. |
| https://super777tambola.com/bumper | TLS certificate name mismatch; not observed. |
| https://super777tambola.com/bumper/admin | TLS certificate name mismatch; not observed. |
| https://super777tambola.com/bumper/agent | TLS certificate name mismatch; not observed. |

The video publisher is MAKE TAMBOLA; its title/description identify maketambola.com, and the recording shows those product screens. The requested super777tambola.com routes are a different domain. No evidence links their ownership or backend, so this is a third-party product reference, not a verified view of the same application.

## Feature inventories and current-platform comparison

“Video demonstrated” means the screen is visible, not that its hidden operation is proven.

| Product area | Video evidence | Current Tambola platform | Gap / decision / next step |
|---|---|---|---|
| Player website | Booking entry, date/time, ticket grid, ticket search, live 1–90 board and call strip. | Room-code/link join, server-generated ticket picker, ticket tabs, live board, marks, patterns, claims and reconnect. | Scheduled-event browse/booking and public instance landing pages are missing. Decide whether prebooking is required and what identity data is necessary. |
| Admin dashboard | Prize/configuration form, date/limit/price settings, run controls, poster preview. | Super Admin overview, rooms, players, history/settings, instance management; moderator backend. | Scheduling, booking queue, availability, dedicated instance operations and full moderator UI are missing. The price field is third-party context; this free-to-play platform must not add payments or payouts. |
| Agent dashboard | Separate agent UI is not clearly shown. Booking controls appear in public/admin footage, but actor identity is unclear. | Secure moderator principal and instance grants; no agent dashboard. | Do not equate video controls with agent rights. Owner decision needed on agent role, player-data access and booking permissions. |
| Regular game | Same 90-number board and prize panels are shown. | Regular instance uses the authoritative shared engine. | Instance-specific public URLs, branding/configuration and operations UI are incomplete. |
| Bumper game | A distinct Bumper experience is not clearly demonstrated. | Bumper instance exists and shares the engine; no standalone Bumper public URL/branding. | Confirm how Bumper differs. Do not infer behavior from route names. |
| Ticket availability and booking | Numbered grid, selection summary, New Booking, Book Now, ticket search, name/phone fields. | Per-room/game server-generated tickets selected by a seated player; uniqueness/validation enforced; no persistent stock. | Decide booking architecture (see product requirements). Do not persist phone data or add price/payment without an approved purpose/privacy policy. |
| Game configuration and operation | Date/time, ticket cap, price field, prize/pattern toggles, cadence and reset controls. | Host console handles start/call/pause/resume/end/reset/cadence/patterns; server-authoritative rules. | Scheduling, booking integration and instance presets are absent. Price/payout functionality is out of scope. |
| Player and winner management | Booking rows associate player labels with ticket numbers; result tiles show ticket/player attribution. | Seats, memberships, claims and awards persist; owner history; moderator can read/manage eligible memberships. | Booking lookup, agent search and winner-management UI are missing. Preserve game evidence; no manual winner override. |
| Reports and statistics | Counters and result categories are visible; no report/export screen was clearly demonstrated. | Owner dashboards/history; moderator instance-summary API. | Dedicated instance analytics/export UI is missing. Define metrics/retention and keep aggregation instance-scoped. |
| Branding and public sharing | Bright green/red pages, jackpot art, theme previews, poster and sharing controls. | Obsidian Hall design system, room codes/share links; branding mostly build-time/global. | Runtime instance branding and share cards are missing. Use original assets; do not copy third-party art or logos. |
