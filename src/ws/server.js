const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");

// Map: profileId -> Set<WebSocket>
const connections = new Map();

function initWs(server) {
  const wss = new WebSocket.Server({ server, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Token required");
      return;
    }

    let profileId;
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      profileId = payload.profileId;
    } catch {
      ws.close(4002, "Invalid token");
      return;
    }

    if (!connections.has(profileId)) connections.set(profileId, new Set());
    connections.get(profileId).add(ws);

    ws.profileId = profileId;
    ws.isAlive = true;

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => {
      const set = connections.get(profileId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) connections.delete(profileId);
      }
    });

    ws.send(JSON.stringify({ type: "CONNECTED", profileId }));
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  console.info("WebSocket server initialized");
}

function sendToProfile(profileId, payload) {
  const set = connections.get(profileId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  set.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// Notify all CARER profiles of the same user as the dependent
async function notifyCarersOfAlert(dependentProfileId, alertData) {
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS carer_profile_id
       FROM profiles p
       WHERE p.user_id = (
         SELECT user_id FROM profiles WHERE id = $1
       )
       AND p.role = 'carer'`,
      [dependentProfileId]
    );
    rows.forEach((r) => {
      sendToProfile(r.carer_profile_id, { type: "NEW_ALERT", ...alertData });
    });
  } catch (e) {
    console.error("notifyCarers error:", e);
  }
}

async function notifyDependentOfAck(dependentProfileId, alertId) {
  sendToProfile(dependentProfileId, { type: "ALERT_ACKNOWLEDGED", alertId });
}

async function notifyAllOfResolution(dependentProfileId, carerProfileId, alertId) {
  sendToProfile(dependentProfileId, { type: "ALERT_RESOLVED", alertId });
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS carer_profile_id
       FROM profiles p
       WHERE p.user_id = (
         SELECT user_id FROM profiles WHERE id = $1
       )
       AND p.role = 'carer'`,
      [dependentProfileId]
    );
    rows.forEach((r) => {
      sendToProfile(r.carer_profile_id, { type: "ALERT_RESOLVED", alertId });
    });
  } catch (e) {
    console.error("notifyAllOfResolution error:", e);
  }
}

async function notifyAllOfEscalation(dependentProfileId, alertId) {
  sendToProfile(dependentProfileId, { type: "ALERT_ESCALATED", alertId });
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS carer_profile_id
       FROM profiles p
       WHERE p.user_id = (
         SELECT user_id FROM profiles WHERE id = $1
       )
       AND p.role = 'carer'`,
      [dependentProfileId]
    );
    rows.forEach((r) => sendToProfile(r.carer_profile_id, { type: "ALERT_ESCALATED", alertId }));
  } catch (e) {
    console.error("notifyAllOfEscalation error:", e);
  }
}

module.exports = {
  initWs,
  sendToProfile,
  notifyCarersOfAlert,
  notifyDependentOfAck,
  notifyAllOfResolution,
  notifyAllOfEscalation,
};