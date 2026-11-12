import { test, expect } from "@playwright/test";

test("landing page renders in desktop and mobile viewports", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /play now/i }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Let the Good Times Roll!" })).toBeVisible();
  await page.screenshot({ path: "artifacts/browser-qa/landing-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "artifacts/browser-qa/landing-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(pageErrors).toEqual([]);
});

test("owner sign-in page exposes its form without internal recovery instructions", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/admin/signin");
  await expect(page.getByLabel(/username/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(page.getByText(/npm run owner:(reset|mfa-reset)/i)).toHaveCount(0);
  await page.screenshot({ path: "artifacts/browser-qa/admin-signin-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await page.screenshot({ path: "artifacts/browser-qa/admin-signin-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(pageErrors).toEqual([]);
});

test("QA owner publishes a 200-ticket Regular session; five isolated player browsers book and enter", async ({ page, browser }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/signin");
  await page.getByLabel("Username").fill("qa.owner");
  await page.getByLabel("Password").fill(process.env.QA_OWNER_PASSWORD || "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/super-admin$/);

  await page.goto("/super-admin/instances");
  const regularRow = page.locator("tr").filter({ hasText: "/regular" });
  await regularRow.getByText("Identity & new-room defaults").click();
  await regularRow.getByLabel("Show in public hall directory").check();
  await page.locator("details.adm-instance-appearance form button[type=submit]").last().click({ timeout: 5000 });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.goto("/super-admin/sessions");
  const instanceSelect = page.getByLabel("Game instance");
  await expect(instanceSelect).toBeVisible();
  await instanceSelect.selectOption({ label: "Regular Tambola" });
  const timeInputs = await page.evaluate(() => {
    const local = (date) => {
      const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
      return adjusted.toISOString().slice(0, 16);
    };
    const now = Date.now();
    return { start: local(new Date(now + 20 * 60_000)), opens: local(new Date(now - 5 * 60_000)), closes: local(new Date(now + 15 * 60_000)) };
  });
  await page.getByLabel("Session name").fill("QA Regular Tambola Session");
  await page.getByLabel(/Game starts — local date and time/i).fill(timeInputs.start);
  await page.getByLabel("Event timezone").selectOption("Asia/Kolkata");
  await page.getByLabel("Booking opens").fill(timeInputs.opens);
  await page.getByLabel("Booking closes").fill(timeInputs.closes);
  await page.getByLabel("Tickets to generate").fill("200");
  await page.getByLabel("Automatically start this game at the scheduled time").check();
  await page.getByRole("button", { name: "Create and generate tickets" }).click();
  await expect(page.getByText(/200 of 200 tickets generated and saved/i)).toBeVisible({ timeout: 90_000 });

  const sessionRow = page.locator("tr").filter({ hasText: "QA Regular Tambola Session" });
  await expect(sessionRow).toContainText("200 / 200 generated");
  await sessionRow.getByRole("button", { name: "Publish" }).click();
  await expect(sessionRow.getByText("open", { exact: true })).toBeVisible();
  const publicList = await page.evaluate(async () => {
    const response = await fetch("/api/public/instances/regular/sessions", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    const session = Array.isArray(data.sessions) ? data.sessions.find((item) => item.title === "QA Regular Tambola Session") : null;
    return { status: response.status, ok: Boolean(data.ok), count: Array.isArray(data.sessions) ? data.sessions.length : -1,
      sessionId: session?.sessionId || null, available: session?.available ?? null, capacity: session?.capacity ?? null };
  });
  expect(publicList.status).toBe(200);
  expect(publicList.ok).toBe(true);
  expect(publicList.count).toBeGreaterThan(0);
  expect(publicList.sessionId).toBeTruthy();
  await page.goto("/games/regular/sessions");
  await expect(page.getByText("QA Regular Tambola Session", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/browser-qa/published-session-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("QA Regular Tambola Session", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/browser-qa/published-session-mobile.png", fullPage: true });

  // Keep the owner dashboard open while separate browser contexts book, so its
  // subscribed inventory change is observed without a manual refresh.
  const adminPage = await page.context().newPage();
  await adminPage.goto("/super-admin/sessions");
  const adminInstance = adminPage.getByLabel("Game instance");
  await expect(adminInstance).toBeVisible();
  await adminInstance.selectOption({ label: "Regular Tambola" });
  const adminSessionRow = adminPage.locator("tr").filter({ hasText: "QA Regular Tambola Session" }).first();
  await expect(adminSessionRow).toContainText("0 held · 0 confirmed of 200");

  const tickets = [];
  const playerContexts = [];
  const playerPages = [];
  const playerRoomUrls = [];
  const playerErrors = [];
  for (let index = 1; index <= 5; index += 1) {
    const context = await browser.newContext({ timezoneId: "Asia/Kolkata", viewport: { width: 1365, height: 900 } });
    playerContexts.push(context);
    const playerPage = await context.newPage();
    playerPages.push(playerPage);
    playerPage.on("pageerror", (error) => playerErrors.push(error.message));
    await playerPage.goto(`/sessions/${encodeURIComponent(publicList.sessionId)}`);
    const ticketButton = playerPage.locator(".booking-ticket-item button.booking-ticket-select:enabled").first();
    await expect(ticketButton).toBeVisible();
    await ticketButton.click();
    const ticketSerial = (await playerPage.locator(".booking-ticket-item[data-selected='true'] .booking-ticket-item__identity strong").first().innerText()).trim();
    tickets.push(ticketSerial);
    await playerPage.locator("form.booking-form input").first().fill(`QA Player ${index}`);
    await playerPage.getByRole("button", { name: /hold/i }).click();
    await expect(playerPage.locator(".booking-result[role='status']").first()).toContainText(/held/i);
    await playerPage.getByRole("button", { name: /confirm reservation/i }).click();
    await expect(playerPage.locator(".booking-code-row input")).toBeVisible();
    const reservationId = (await playerPage.locator(".booking-reference code").innerText()).trim();
    const bookingToken = await playerPage.locator(".booking-code-row input").inputValue();
    await playerPage.goto(`/player?instance=regular&room=${encodeURIComponent(await playerPage.locator(".booking-join-next a").getAttribute("href").then((href) => new URL(href, "http://qa.local").searchParams.get("room")))}`);
    await playerPage.getByLabel("Your name").fill(`QA Player ${index}`);
    await playerPage.locator("details summary").filter({ hasText: /booking/i }).click();
    await playerPage.locator("#booking-reference").fill(reservationId);
    await playerPage.locator("#booking-token").fill(bookingToken);
    await playerPage.getByRole("button", { name: /join/i }).click();
    await expect(playerPage).toHaveURL(/\/player\/room$/);
    await expect(playerPage.locator("[data-oh-room-grid='true']")).toBeVisible();
    await expect(playerPage.locator(".oh-ticket-paper__title")).toHaveText(ticketSerial);
    await expect(playerPage.locator(".oh-ticket-serial-list")).toContainText(ticketSerial);
    await expect(playerPage.locator("[data-ticket-picker='true']")).toHaveCount(0);
    playerRoomUrls.push(playerPage.url());
  }
  expect(playerErrors).toEqual([]);
  expect(new Set(tickets).size).toBe(5);
  expect(tickets).toEqual(["TKT-0001", "TKT-0002", "TKT-0003", "TKT-0004", "TKT-0005"]);
  for (const playerPage of playerPages) {
    await playerPage.goto("/player/game");
    await expect(playerPage.locator("[data-scheduled-game='true']")).toContainText("Asia/Kolkata");
    await expect(playerPage.locator("[data-scheduled-game='true']")).toContainText(/Starts in/);
    // The session's private waiting room contributes its host seat; five booked
    // players plus that host are six active room seats.
    await expect(playerPage.locator(".player-game-info dl div").filter({ hasText: "Players" }).locator("dd")).toHaveText("6");
    await expect(playerPage.locator(".player-game-info dl div").filter({ hasText: "My tickets" }).locator("dd")).toHaveText("1");
    await expect(playerPage.locator(".oh-ticket-grid")).toHaveCount(1);
    await expect(playerPage.locator(".player-live-patterns")).toContainText("Top Line");
  }
  await playerPages[0].screenshot({ path: "artifacts/browser-qa/player-scheduled-countdown.png", fullPage: true });
  await playerPages[0].setViewportSize({ width: 390, height: 844 });
  await playerPages[0].goto(playerRoomUrls[0]);
  await expect(playerPages[0].locator(".oh-ticket-paper__title")).toHaveText(tickets[0]);
  await playerPages[0].screenshot({ path: "artifacts/browser-qa/player-ticket-serial-mobile.png", fullPage: true });
  await expect(adminSessionRow).toContainText("5 confirmed of 200", { timeout: 10_000 });
  await adminPage.reload();
  await expect(adminInstance).toBeVisible();
  await adminInstance.selectOption({ label: "Regular Tambola" });
  await expect(adminSessionRow).toContainText("5 confirmed of 200");

  const adminErrors = [];
  adminPage.on("pageerror", (error) => adminErrors.push(error.message));
  await adminPage.goto("/super-admin/posters");
  await expect(adminPage.getByRole("heading", { name: "Poster studio" })).toBeVisible();
  await adminPage.getByLabel("Instance").selectOption({ label: "Regular Tambola" });
  const posterSession = adminPage.getByLabel("Event / session");
  const sessionOption = posterSession.locator("option").filter({ hasText: "QA Regular Tambola Session" });
  await expect(sessionOption).toHaveCount(1);
  // Session options load asynchronously when the instance changes. Clear any
  // session auto-selected for the previous instance before selecting this one.
  await posterSession.selectOption("");
  await posterSession.selectOption(await sessionOption.getAttribute("value"));
  const eventFacts = adminPage.locator(".adm-poster-event-facts");
  await expect(eventFacts).toContainText("QA Regular Tambola Session");
  await expect(eventFacts).toContainText("195");
  await expect(eventFacts).toContainText(/Early Five|Top Line/);
  await expect(adminPage.getByLabel("Timezone")).toHaveValue("Asia/Kolkata");
  await expect(adminPage.getByLabel("Game title")).toHaveValue("QA Regular Tambola Session");
  const templates = adminPage.locator("button.adm-poster-template");
  expect(await templates.count()).toBeGreaterThan(1);
  const preview = adminPage.locator(".adm-poster-preview-stage svg.poster-art");
  await expect(preview).toBeVisible();
  const beforeComposition = await preview.evaluate((svg) => svg.outerHTML);
  await templates.nth(1).click();
  await expect(templates.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => preview.evaluate((svg) => svg.outerHTML)).not.toBe(beforeComposition);
  await adminPage.screenshot({ path: "artifacts/browser-qa/poster-studio-desktop.png", fullPage: true });
  await adminPage.getByRole("button", { name: "Mobile", exact: true }).click();
  await expect(adminPage.locator(".adm-poster-preview-stage.is-mobile")).toBeVisible();
  await adminPage.setViewportSize({ width: 390, height: 844 });
  expect(await adminPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await adminPage.screenshot({ path: "artifacts/browser-qa/poster-studio-mobile.png", fullPage: true });
  const brokenImages = await adminPage.locator("img").evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc));
  expect(brokenImages).toEqual([]);
  expect(adminErrors).toEqual([]);
  for (const context of playerContexts) await context.close();
  await adminPage.close();
  expect(errors).toEqual([]);
});
