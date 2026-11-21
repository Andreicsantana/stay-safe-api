const { pool } = require("../db/pool");

const ALERT_COLUMNS = `
  a.id, a.status, a.emitted_at, a.acknowledged_at, a.resolved_at,
  a.escalated_at, a.notes, a.latitude, a.longitude, a.address,
  a.dependent_profile_id, p.name AS dependent_name
`;

async function findActiveAlertsByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLUMNS}
     FROM alerts a
     JOIN profiles p ON p.id = a.dependent_profile_id
     WHERE p.user_id = $1
       AND p.role = 'dependent'
       AND a.status NOT IN ('resolved_carer', 'resolved_dependent', 'cancelled')
     ORDER BY a.emitted_at DESC`,
    [userId]
  );
  return rows;
}

async function findActiveAlertsByDependentId(dependentProfileId, limit = null) {
  const limitClause = limit ? `LIMIT ${Number(limit)}` : "";
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLUMNS}
     FROM alerts a
     JOIN profiles p ON p.id = a.dependent_profile_id
     WHERE a.dependent_profile_id = $1
       AND a.status IN ('pending', 'notified', 'acknowledged', 'escalated')
     ORDER BY a.emitted_at DESC
     ${limitClause}`,
    [dependentProfileId]
  );
  return rows;
}

async function findAlertHistoryByUserId(userId, limit, offset) {
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLUMNS}
     FROM alerts a
     JOIN profiles p ON p.id = a.dependent_profile_id
     WHERE p.user_id = $1
       AND p.role = 'dependent'
     ORDER BY a.emitted_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

async function findAlertHistoryByDependentId(dependentProfileId, limit, offset) {
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLUMNS}
     FROM alerts a
     JOIN profiles p ON p.id = a.dependent_profile_id
     WHERE a.dependent_profile_id = $1
     ORDER BY a.emitted_at DESC
     LIMIT $2 OFFSET $3`,
    [dependentProfileId, limit, offset]
  );
  return rows;
}

async function updateAlertAddress(alertId, address) {
  const { rows } = await pool.query(
    `UPDATE alerts SET address = $1 WHERE id = $2
     RETURNING id, status, emitted_at, acknowledged_at, resolved_at,
               escalated_at, notes, latitude, longitude, address, dependent_profile_id`,
    [address, alertId]
  );
  return rows[0] || null;
}

async function escalateExpiredPendingAlerts(escalateMs) {
  const { rows } = await pool.query(
    `UPDATE alerts
     SET status = 'escalated', escalated_at = NOW()
     WHERE status = 'pending'
       AND emitted_at <= NOW() - ($1 * INTERVAL '1 millisecond')
     RETURNING id, dependent_profile_id`,
    [escalateMs]
  );
  return rows;
}

module.exports = {
  findActiveAlertsByUserId,
  findActiveAlertsByDependentId,
  findAlertHistoryByUserId,
  findAlertHistoryByDependentId,
  updateAlertAddress,
  escalateExpiredPendingAlerts,
};
