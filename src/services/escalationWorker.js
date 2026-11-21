const { escalateExpiredPendingAlerts } = require("../repositories/alertRepository");
const { notifyAllOfEscalation } = require("../ws/server");

function startEscalationWorker(intervalMs = 5000) {
  const escalateMs = parseInt(process.env.ESCALATE_MS, 10) || 30000;

  const tick = async () => {
    try {
      const escalated = await escalateExpiredPendingAlerts(escalateMs);
      for (const row of escalated) {
        await notifyAllOfEscalation(row.dependent_profile_id, row.id);
      }
    } catch (err) {
      console.error("Escalation worker error:", err);
    }
  };

  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { startEscalationWorker };
