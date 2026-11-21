const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

process.env.JWT_SECRET = "test-secret";

const { pool } = require("../src/db/pool");
const { createApp } = require("../src/app");

describe("API integration", () => {
  const app = createApp();
  let originalQuery;

  beforeEach(() => {
    originalQuery = pool.query;
  });

  it("GET /health checks DB connectivity", async () => {
    pool.query = async () => ({ rows: [{ "?column?": 1 }] });
    const okRes = await request(app).get("/health");
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.status, "ok");

    pool.query = async () => {
      throw new Error("db down");
    };
    const errRes = await request(app).get("/health");
    assert.equal(errRes.status, 503);
    pool.query = originalQuery;
  });

  it("POST /api/users/register validates email and password", async () => {
    const badEmail = await request(app).post("/api/users/register").send({
      name: "Maria",
      email: "invalid-email",
      phone: "11999999999",
      password: "password123",
    });
    assert.equal(badEmail.status, 400);

    const shortPwd = await request(app).post("/api/users/register").send({
      name: "Maria",
      email: "maria@example.com",
      phone: "11999999999",
      password: "123",
    });
    assert.equal(shortPwd.status, 400);
  });

  it("POST /api/auth/select-profile requires account JWT", async () => {
    const unauth = await request(app).post("/api/auth/select-profile").send({
      userId: "user-1",
      profileId: "prof-1",
    });
    assert.equal(unauth.status, 401);

    const token = jwt.sign({ userId: "user-1", type: "account" }, process.env.JWT_SECRET);
    const mismatch = await request(app)
      .post("/api/auth/select-profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: "user-2", profileId: "prof-1" });
    assert.equal(mismatch.status, 403);
  });

  it("GET /api/alerts/active-for-me forbids carer and works for dependent", async () => {
    const carerToken = jwt.sign({ profileId: "carer-1" }, process.env.JWT_SECRET);
    pool.query = async (sql) => {
      if (sql.includes("FROM profiles p")) {
        return {
          rows: [{ id: "carer-1", user_id: "user-1", name: "Maria", role: "carer", hasPin: false, email: "m@e.com" }],
        };
      }
      return { rows: [] };
    };
    const carerRes = await request(app)
      .get("/api/alerts/active-for-me")
      .set("Authorization", `Bearer ${carerToken}`);
    assert.equal(carerRes.status, 403);

    const depToken = jwt.sign({ profileId: "dep-1" }, process.env.JWT_SECRET);
    pool.query = async (sql) => {
      if (sql.includes("FROM profiles p")) {
        return {
          rows: [{ id: "dep-1", user_id: "user-1", name: "João", role: "dependent", hasPin: true, email: "m@e.com" }],
        };
      }
      return { rows: [] };
    };
    const depRes = await request(app)
      .get("/api/alerts/active-for-me")
      .set("Authorization", `Bearer ${depToken}`);
    assert.equal(depRes.status, 200);
    assert.equal(depRes.body.alert, null);
    pool.query = originalQuery;
  });

  it("POST /api/alerts/emit validates coordinates and allows missing GPS", async () => {
    const depToken = jwt.sign({ profileId: "dep-1" }, process.env.JWT_SECRET);
    pool.query = async (sql) => {
      if (sql.includes("FROM profiles p")) {
        return {
          rows: [{ id: "dep-1", user_id: "user-1", name: "João", role: "dependent", hasPin: false, email: "m@e.com" }],
        };
      }
      if (sql.includes("SELECT name FROM profiles")) {
        return { rows: [{ name: "João" }] };
      }
      if (sql.includes("SELECT id FROM alerts")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO alerts")) {
        return {
          rows: [{ id: "alert-1", status: "pending", emitted_at: "2026-11-21T12:00:00.000Z", latitude: null, longitude: null, address: null }],
        };
      }
      return { rows: [] };
    };

    const badCoords = await request(app)
      .post("/api/alerts/emit")
      .set("Authorization", `Bearer ${depToken}`)
      .send({ latitude: "abc", longitude: 10 });
    assert.equal(badCoords.status, 400);

    const noGps = await request(app)
      .post("/api/alerts/emit")
      .set("Authorization", `Bearer ${depToken}`)
      .send({});
    assert.equal(noGps.status, 201);
    assert.equal(noGps.body.mapsUrl, null);
    pool.query = originalQuery;
  });

  it("POST /api/alerts/:id/resolve returns 403 on wrong PIN and 429 after 5 attempts", async () => {
    const depToken = jwt.sign({ profileId: "dep-rate-1" }, process.env.JWT_SECRET);
    const pinHash = await bcrypt.hash("1234", 4);

    pool.query = async (sql) => {
      if (sql.includes("FROM profiles p")) {
        return {
          rows: [{ id: "dep-rate-1", user_id: "user-1", name: "João", role: "dependent", hasPin: true, email: "m@e.com" }],
        };
      }
      return {
        rows: [{ id: "alert-9", status: "pending", dependent_profile_id: "dep-rate-1", dismiss_pin: pinHash }],
      };
    };

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/alerts/alert-9/resolve")
        .set("Authorization", `Bearer ${depToken}`)
        .send({ pin: "0000" });
      assert.equal(res.status, 403);
    }

    const blocked = await request(app)
      .post("/api/alerts/alert-9/resolve")
      .set("Authorization", `Bearer ${depToken}`)
      .send({ pin: "0000" });
    assert.equal(blocked.status, 429);
    pool.query = originalQuery;
  });
});
