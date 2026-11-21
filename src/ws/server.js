const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { formatAlert } = require("../utils/alertFormatter");
const {
  findActiveAlertsByDependentId,
  findActiveAlertsByUserId,
} = require("../repositories/alertRepository");
const {
  findProfileById,
  findCarerProfileIdsByDependentId,
} = require("../repositories/profileRepository");

const connections = new Map();

async function sendInitialAlertState(ws, profileId) {
  try {
    const profile = await findProfileById(profileId);
    if (!profile) return;

    if (profile.role === "dependent") {
      const rows = await findActiveAlertsByDependentId(profile.id, 1);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "ALERT_STATE",
            alert: rows[0] ? formatAlert(rows[0]) : null,
          })
        );
      }
      return;
    }

    if (profile.role === "carer") {
      const rows = await findActiveAlertsByUserId(profile.user_id);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "ALERT_STATE",
            activeAlerts: rows.map(formatAlert),
          })
        );
      }
    }
  } catch (e) {
    console.error("sendInitialAlertState error:", e);
  }
}

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
      if (!profileId) {
        ws.close(4002, "Invalid token");
        return;
      }
    } catch {
      ws.close(4002, "Invalid token");
      return;
    }

    if (!connections.has(profileId)) connections.set(profileId, new Set());
    connections.get(profileId).add(ws);

    ws.profileId = profileId;
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("close", () => {
      const set = connections.get(profileId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) connections.delete(profileId);
      }
    });

    ws.send(JSON.stringify({ type: "CONNECTED", profileId }));
    await sendInitialAlertState(ws, profileId);
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
  return wss;
}

function sendToProfile(profileId, payload) {
  const set = connections.get(profileId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  set.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

async function notifyCarers(dependentProfileId, payload) {
  try {
    const carerIds = await findCarerProfileIdsByDependentId(dependentProfileId);
    carerIds.forEach((carerId) => {
      sendToProfile(carerId, payload);
    });
  } catch (e) {
    console.error("notifyCarers error:", e);
  }
}

async function notifyCarersOfAlert(dependentProfileId, alertData) {
  await notifyCarers(dependentProfileId, { type: "NEW_ALERT", ...alertData });
}

async function notifyCarersOfAlertUpdate(dependentProfileId, alertData) {
  await notifyCarers(dependentProfileId, { type: "ALERT_UPDATED", ...alertData });
}

async function notifyDependentOfAck(dependentProfileId, alertId) {
  sendToProfile(dependentProfileId, {
    type: "ALERT_ACKNOWLEDGED",
    id: alertId,
    alertId,
    status: "acknowledged",
  });
}

async function notifyAllOfResolution(dependentProfileId, carerProfileId, alertId, status) {
  const payload = {
    type: "ALERT_RESOLVED",
    id: alertId,
    alertId,
    status,
  };
  sendToProfile(dependentProfileId, payload);
  await notifyCarers(dependentProfileId, payload);
}

async function notifyAllOfEscalation(dependentProfileId, alertId) {
  const payload = {
    type: "ALERT_ESCALATED",
    id: alertId,
    alertId,
    status: "escalated",
    message: "Ninguém respondeu ainda. Estamos tentando outras pessoas.",
  };
  sendToProfile(dependentProfileId, payload);
  await notifyCarers(dependentProfileId, payload);
}

module.exports = {
  initWs,
  sendToProfile,
  notifyCarersOfAlert,
  notifyCarersOfAlertUpdate,
  notifyDependentOfAck,
  notifyAllOfResolution,
  notifyAllOfEscalation,
};
