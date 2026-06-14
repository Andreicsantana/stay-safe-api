const router = require("express").Router();
const bcrypt = require("bcrypt");
const { pool } = require("../db/pool");
const { authMiddleware, requireRole } = require("../middleware/auth");
const {
  notifyCarersOfAlert,
  notifyDependentOfAck,
  notifyAllOfResolution,
  notifyAllOfEscalation,
} = require("../ws/server");
const { sendAlertEmail } = require("../services/mailer");

router.use(authMiddleware);

// ── Shared query helpers ────────────────────────────────────────────────────

// Active alerts for a carer: all pending alerts from dependents of the same user
const ACTIVE_CARER_QUERY = `
  SELECT a.id, a.status, a.emitted_at, a.acknowledged_at, a.notes,
         p.name AS dependent_name, a.dependent_profile_id
  FROM alerts a
  JOIN profiles p ON p.id = a.dependent_profile_id
  WHERE p.user_id = $1
    AND p.role = 'dependent'
    AND a.status NOT IN ('resolved_carer','resolved_dependent','cancelled')
  ORDER BY a.emitted_at DESC
`;

// History for a carer: all alerts from dependents of the same user
const HISTORY_CARER_QUERY = `
  SELECT a.id, a.status, a.emitted_at, a.resolved_at, a.notes,
         p.name AS dependent_name, a.dependent_profile_id
  FROM alerts a
  JOIN profiles p ON p.id = a.dependent_profile_id
  WHERE p.user_id = $1
    AND p.role = 'dependent'
  ORDER BY a.emitted_at DESC
  LIMIT $2 OFFSET $3
`;

// ── GET /api/alerts/active ──────────────────────────────────────────────────
router.get("/active", async (req, res) => {
  const { id: profileId, role } = req.profile;

  let rows;
  if (role === "dependent") {
    ({ rows } = await pool.query(
      `SELECT a.id, a.status, a.emitted_at, a.acknowledged_at, a.notes,
              p.name AS dependent_name
       FROM alerts a
       JOIN profiles p ON p.id = a.dependent_profile_id
       WHERE a.dependent_profile_id = $1
         AND a.status NOT IN ('resolved_carer','resolved_dependent','cancelled')
       ORDER BY a.emitted_at DESC`,
      [profileId]
    ));
  } else {
    ({ rows } = await pool.query(ACTIVE_CARER_QUERY, [req.userId]));
  }

  res.json({ activeAlerts: rows });
});

// ── GET /api/alerts ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { id: profileId, role } = req.profile;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;

  let rows;
  if (role === "dependent") {
    ({ rows } = await pool.query(
      `SELECT a.id, a.status, a.emitted_at, a.resolved_at, a.notes,
              p.name AS dependent_name
       FROM alerts a
       JOIN profiles p ON p.id = a.dependent_profile_id
       WHERE a.dependent_profile_id = $1
       ORDER BY a.emitted_at DESC
       LIMIT $2 OFFSET $3`,
      [profileId, limit, offset]
    ));
  } else {
    ({ rows } = await pool.query(HISTORY_CARER_QUERY, [req.userId, limit, offset]));
  }

  res.json({ alerts: rows });
});

// ── POST /api/alerts/emit ───────────────────────────────────────────────────
router.post("/emit", async (req, res) => {
  const dependentProfileId = req.profile.id;
  const { latitude, longitude } = req.body || {};

  try {
    const { rows: profileRows } = await pool.query(
      "SELECT name FROM profiles WHERE id = $1",
      [dependentProfileId]
    );
    if (!profileRows.length) return res.status(404).json({ error: "Perfil não encontrado" });
    const dependentName = profileRows[0].name;

    const { rows: existing } = await pool.query(
      `SELECT id FROM alerts 
       WHERE dependent_profile_id = $1 AND status NOT IN ('resolved_carer', 'resolved_dependent', 'cancelled')`,
      [dependentProfileId]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: "Já existe um alerta ativo", alertId: existing[0].id });
    }

    let address = null;
    if (latitude && longitude) {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
          {
            headers: {
              "User-Agent": "StaySafeApp/1.0 (staysafe.ofc@gmail.com)"
            }
          }
        );
        if (response.ok) {
          const data = await response.json();
          address = data.display_name;
        }
      } catch (err) {
        console.error("Erro no reverse geocoding (Nominatim):", err);
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO alerts (dependent_profile_id, status, latitude, longitude, address)
       VALUES ($1, 'pending', $2, $3, $4)
       RETURNING id, status, emitted_at, latitude, longitude, address`,
      [dependentProfileId, latitude || null, longitude || null, address]
    );

  const alert = rows[0];

  await notifyCarersOfAlert(dependentProfileId, {
    alertId: alert.id,
    dependentProfileId,
    dependentName,
    emittedAt: alert.emitted_at,
    status: "pending",
  });

  // Get user's email to send notification
  try {
    const { rows: userRows } = await pool.query(
      `SELECT u.email 
       FROM users u 
       JOIN profiles p ON p.user_id = u.id 
       WHERE p.id = $1`,
      [dependentProfileId]
    );
    if (userRows[0] && userRows[0].email) {
      console.info(`[ALERT] Disparando email para o usuário cadastrado: ${userRows[0].email}`);
      sendAlertEmail(userRows[0].email, dependentName, alert.emitted_at, alert.latitude, alert.longitude, alert.address);
    }
  } catch (e) {
    console.error("Erro ao buscar email para notificação:", e);
  }

  setTimeout(async () => {
    try {
      const { rows: check } = await pool.query(
        `SELECT status FROM alerts WHERE id = $1`,
        [alert.id]
      );
      if (
        check[0] &&
        !["acknowledged", "resolved_carer", "resolved_dependent", "escalated", "cancelled"].includes(check[0].status)
      ) {
        await pool.query(
          `UPDATE alerts SET status = 'escalated', escalated_at = NOW() WHERE id = $1`,
          [alert.id]
        );
        await notifyAllOfEscalation(dependentProfileId, alert.id);
      }
    } catch (e) {
      console.error("Auto-escalate error:", e);
    }
  }, parseInt(process.env.ESCALATE_MS) || 30000);

  res.status(201).json({ alertId: alert.id, status: alert.status, emittedAt: alert.emitted_at });
  } catch (err) {
    console.error("Erro em /emit:", err);
    res.status(500).json({ error: "Erro interno ao processar o alerta" });
  }
});

// ── POST /api/alerts/:id/acknowledge ───────────────────────────────────────
router.post("/:id/acknowledge", requireRole("carer"), async (req, res) => {
  const { id: alertId } = req.params;

  // Carer can acknowledge any alert from a dependent of the same user
  const { rows } = await pool.query(
    `SELECT a.id, a.status, a.dependent_profile_id
     FROM alerts a
     JOIN profiles p ON p.id = a.dependent_profile_id
     WHERE a.id = $1 AND p.user_id = $2`,
    [alertId, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Alerta não encontrado" });
  if (["resolved_carer", "resolved_dependent", "escalated", "cancelled"].includes(rows[0].status)) {
    return res.status(409).json({ error: "Alerta já encerrado" });
  }

  await pool.query(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_at = NOW() WHERE id = $1`,
    [alertId]
  );

  await notifyDependentOfAck(rows[0].dependent_profile_id, alertId);
  res.json({ alertId, status: "acknowledged" });
});

// ── POST /api/alerts/:id/resolve ────────────────────────────────────────────
router.post("/:id/resolve", async (req, res) => {
  const { id: profileId, role } = req.profile;
  const { id: alertId } = req.params;
  const { notes, pin } = req.body;

  let alertRow;
  if (role === "carer") {
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.dependent_profile_id
       FROM alerts a
       JOIN profiles p ON p.id = a.dependent_profile_id
       WHERE a.id = $1 AND p.user_id = $2`,
      [alertId, req.userId]
    );
    alertRow = rows[0];
  } else {
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.dependent_profile_id, p.dismiss_pin
       FROM alerts a
       JOIN profiles p ON p.id = a.dependent_profile_id
       WHERE a.id = $1 AND a.dependent_profile_id = $2`,
      [alertId, profileId]
    );
    alertRow = rows[0];

    if (alertRow?.dismiss_pin) {
      if (!pin) return res.status(400).json({ error: "PIN obrigatório" });
      const valid = await bcrypt.compare(String(pin), alertRow.dismiss_pin);
      if (!valid) return res.status(403).json({ error: "PIN incorreto" });
    }
  }

  if (!alertRow) return res.status(404).json({ error: "Alerta não encontrado" });
  if (["resolved_carer", "resolved_dependent", "cancelled"].includes(alertRow.status)) {
    return res.status(409).json({ error: "Alerta já encerrado" });
  }

  const newStatus = role === "carer" ? "resolved_carer" : "resolved_dependent";
  await pool.query(
    `UPDATE alerts SET status = $1, resolved_at = NOW(), resolved_by = $2, notes = COALESCE($3, notes) WHERE id = $4`,
    [newStatus, profileId, notes || null, alertId]
  );

  const carerProfileId = role === "carer" ? profileId : null;
  await notifyAllOfResolution(alertRow.dependent_profile_id, carerProfileId, alertId);
  res.json({ alertId, status: newStatus });
});

// ── GET /api/alerts/:id ─────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id: profileId, role } = req.profile;
  const { id: alertId } = req.params;

  let query, params;
  if (role === "carer") {
    query = `
      SELECT a.*, p.name AS dependent_name
      FROM alerts a
      JOIN profiles p ON p.id = a.dependent_profile_id
      WHERE a.id = $1 AND p.user_id = $2
    `;
    params = [alertId, req.userId];
  } else {
    query = `
      SELECT a.*, p.name AS dependent_name
      FROM alerts a
      JOIN profiles p ON p.id = a.dependent_profile_id
      WHERE a.id = $1 AND a.dependent_profile_id = $2
    `;
    params = [alertId, profileId];
  }

  const { rows } = await pool.query(query, params);
  if (!rows[0]) return res.status(404).json({ error: "Alerta não encontrado" });
  res.json(rows[0]);
});

module.exports = router;