const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildMapsUrl, formatAlert } = require("../src/utils/alertFormatter");
const { isPinBlocked, recordPinFailure, clearPinFailures } = require("../src/utils/pinRateLimit");
const { buildAlertEmailPayload } = require("../src/services/mailer");

describe("alertFormatter", () => {
  it("builds Google Maps URL when coordinates exist and null otherwise", () => {
    assert.equal(
      buildMapsUrl(-23.5505, -46.6333),
      "https://www.google.com/maps?q=-23.5505,-46.6333"
    );
    assert.equal(buildMapsUrl(null, -46.6333), null);
    assert.equal(buildMapsUrl(-23.5505, undefined), null);
  });

  it("formats alert with and without GPS while keeping existing fields", () => {
    const withGps = formatAlert({
      id: "alert-1",
      status: "pending",
      emitted_at: "2026-11-20T18:00:00.000Z",
      dependent_profile_id: "dep-1",
      dependent_name: "João",
      latitude: -23.55,
      longitude: -46.63,
      address: "Av. Paulista, São Paulo",
    });

    assert.equal(withGps.id, "alert-1");
    assert.equal(withGps.created_at, "2026-11-20T18:00:00.000Z");
    assert.equal(withGps.emitted_at, "2026-11-20T18:00:00.000Z");
    assert.equal(withGps.dependentName, "João");
    assert.equal(withGps.dependent_name, "João");
    assert.equal(withGps.address, "Av. Paulista, São Paulo");
    assert.equal(withGps.mapsUrl, "https://www.google.com/maps?q=-23.55,-46.63");

    const withoutGps = formatAlert({
      id: "alert-2",
      status: "acknowledged",
      emitted_at: "2026-11-20T18:05:00.000Z",
      dependent_profile_id: "dep-1",
      dependent_name: "João",
    });

    assert.equal(withoutGps.latitude, null);
    assert.equal(withoutGps.longitude, null);
    assert.equal(withoutGps.address, null);
    assert.equal(withoutGps.mapsUrl, null);
  });
});

describe("pinRateLimit", () => {
  it("blocks after 5 failures within 5 minutes and clears on success", () => {
    const profileId = "profile-test-rate";
    const base = 1000000;
    clearPinFailures(profileId);

    for (let i = 0; i < 4; i++) {
      recordPinFailure(profileId, base + i * 1000);
      assert.equal(isPinBlocked(profileId, base + i * 1000), false);
    }

    recordPinFailure(profileId, base + 4000);
    assert.equal(isPinBlocked(profileId, base + 4000), true);

    assert.equal(isPinBlocked(profileId, base + 5 * 60 * 1000 + 5000), false);

    recordPinFailure(profileId, base + 6 * 60 * 1000);
    clearPinFailures(profileId);
    assert.equal(isPinBlocked(profileId, base + 6 * 60 * 1000), false);
  });
});

describe("mailer", () => {
  it("builds honest email without SMS, ligação or autoridades", () => {
    const payload = buildAlertEmailPayload(
      "cuidador@example.com",
      "João",
      "2026-11-20T18:00:00.000Z",
      -23.55,
      -46.63,
      "Av. Paulista, 1000"
    );

    assert.equal(payload.subject, "ALERTA: João pediu ajuda");
    assert.match(payload.html, /Estou indo/);
    assert.match(payload.html, /https:\/\/www\.google\.com\/maps\?q=-23\.55,-46\.63/);
    assert.doesNotMatch(payload.html, /\b(SMS|ligação|ligar|autoridades|polícia|SAMU)\b/i);
  });
});
