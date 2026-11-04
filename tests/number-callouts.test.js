import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNumberAnnouncement,
  ENGLISH_CALLOUTS,
  HINGLISH_CALLOUTS,
  getNumberCallout,
  NUMBER_CALLOUT_COUNT,
  SARVAM_CALLOUTS,
} from "../client/src/lib/number-callouts.js";

test("English and Romanized Hinglish each have one unique callout per number", () => {
  assert.equal(NUMBER_CALLOUT_COUNT, 90);
  assert.equal(ENGLISH_CALLOUTS.length, 90);
  assert.equal(HINGLISH_CALLOUTS.length, 90);
  assert.equal(new Set(ENGLISH_CALLOUTS).size, 90);
  assert.equal(new Set(HINGLISH_CALLOUTS).size, 90);
  for (let number = 1; number <= 90; number += 1) {
    const english = getNumberCallout(number, { language: "en" });
    const hinglish = getNumberCallout(number, { language: "hi" });
    assert.equal(english, SARVAM_CALLOUTS.en[number] || ENGLISH_CALLOUTS[number - 1]);
    assert.equal(hinglish, SARVAM_CALLOUTS.hinglish[number] || HINGLISH_CALLOUTS[number - 1]);
    assert.ok(!/[\u0900-\u097f]/u.test(hinglish), `Hinglish ${number} uses Roman script`);
    assert.notEqual(english, hinglish, `languages differ for ${number}`);
    assert.ok(english.length <= 120 && hinglish.length <= 120, `callout ${number} is concise`);
  }
});

test("Hinglish lines use distinct joke vocabulary instead of translated English templates", () => {
  const filler = new Set("the a an is are was were be been being and or but with for to of in on at by from this that has have had it its their they your you please".split(" "));
  const words = (line) => new Set(
    line.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !filler.has(word))
  );

  for (let index = 0; index < NUMBER_CALLOUT_COUNT; index += 1) {
    if (SARVAM_CALLOUTS.en[index + 1]) continue; // fixed approved audition lines are tested verbatim below
    const english = words(ENGLISH_CALLOUTS[index]);
    const hinglish = words(HINGLISH_CALLOUTS[index]);
    const shared = [...english].filter((word) => hinglish.has(word));
    const combined = new Set([...english, ...hinglish]);
    const overlap = shared.length / Math.max(1, combined.size);
    assert.ok(overlap < 0.2, `callout ${index + 1} reuses English joke vocabulary: ${shared.join(", ")}`);
  }
  for (const number of [1, 7, 11, 27, 44, 55, 77, 90]) {
    assert.equal(getNumberCallout(number, { language: "en" }), SARVAM_CALLOUTS.en[number]);
    assert.equal(getNumberCallout(number, { language: "hi" }), SARVAM_CALLOUTS.hinglish[number]);
  }
});

test("callouts remain deterministic and number-indexed across caller preferences", () => {
  for (let number = 1; number <= 90; number += 1) {
    for (const language of ["en", "hi"]) {
      assert.equal(
        getNumberCallout(number, { language, callIndex: 1, festival: "classic", personality: "playful" }),
        getNumberCallout(number, { language, callIndex: 90, festival: "classic", personality: "friendly" }),
      );
    }
  }
  assert.equal(getNumberCallout(27, { language: "en" }), SARVAM_CALLOUTS.en[27]);
  assert.equal(getNumberCallout(27, { language: "hi" }), SARVAM_CALLOUTS.hinglish[27]);
  assert.equal(getNumberCallout(27, { language: "hindi" }), SARVAM_CALLOUTS.hindi[27]);
});

test("festival flavor appends to, and never replaces, the number-specific line", () => {
  const base = getNumberCallout(42, { language: "en" });
  const festival = getNumberCallout(42, { language: "en", festival: "diwali" });
  assert.ok(festival.startsWith(base));
  assert.notEqual(festival, getNumberCallout(43, { language: "en", festival: "diwali" }));
  assert.match(getNumberCallout(42, { language: "hi", festival: "diwali" }), /^[\x00-\x7f]+$/);
});

test("untrusted or out-of-range calls cannot produce invented copy", () => {
  assert.equal(getNumberCallout(0), "");
  assert.equal(getNumberCallout(91), "");
  assert.equal(getNumberCallout(Number.NaN), "");
});

test("announcements speak the authoritative number before its matching callout", () => {
  assert.equal(buildNumberAnnouncement(42, { language: "en" }), "forty-two");
  assert.equal(buildNumberAnnouncement(42, { language: "hi" }), "bayalis");
  assert.equal(buildNumberAnnouncement(27, { language: "en", includeCallout: true }), SARVAM_CALLOUTS.en[27]);
  assert.equal(buildNumberAnnouncement(27, { language: "hi", includeCallout: true }), SARVAM_CALLOUTS.hinglish[27]);
  assert.equal(buildNumberAnnouncement(27, { language: "hindi", includeCallout: true }), SARVAM_CALLOUTS.hindi[27]);
  assert.equal(buildNumberAnnouncement(1, { language: "en", includeCallout: true }), SARVAM_CALLOUTS.en[1]);
  assert.equal(buildNumberAnnouncement(90, { language: "en", includeCallout: true }), SARVAM_CALLOUTS.en[90]);
});
