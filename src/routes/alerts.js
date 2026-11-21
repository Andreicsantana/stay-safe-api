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
const { buildMapsUrl, formatAlert } = require("../utils/alertFormatter");
const { isPinBlocked, recordPinFailure, clearPinFailures } = require("../utils/pinRateLimit");

router.use(authMiddleware);

const ACTIVE_CARER_QUERY = `
  SELECT a.id, a.status, a.emitted_at, a.acknowledged_at, a.resolved_at,
         a.escalated_at, a.notes, a.latitude, a.longitude, a.address,
         p.name AS dependent_name, a.dependent_profile_id
  FROM alerts a
  JOIN profiles p ON p.id = a.dependent_profile_id
  WHERE p.user_id = $1
    AND p.role = 'dependent'
    AND a.status NOT IN ('resolved_carer','resolved_dependent','cancelled')
  ORDER BY a.emitted_at DESC
`;

const HISTORY_CARER_QUERY = `
  SELECT a.id, a.status, a.emitted_at, a.acknowledged_at, a.resolved_at,
         a.escalated_at, a.notes, a.latitude, a.longitude, a.address,
         p.name AS dependent_name, a.dependent_profile_id
  FROM alerts a
  JOIN profiles p ON p.id = a.dependent_profile_id
  WHERE p.user_id = $1
    AND p.role = 'dependent'
  ORDER BY a.emitted_at DESC
  LIMIT $2 OFFSET $3
`;

async function fetchAddressFromNominatim(latitude, longitude) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
      {
        headers: {
          "User-Agent": "StaySafeApp/1.0 (staysafe.ofc@gmail.com)",
        },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.display_name || null;
  } catch (err) {
    console.error("Erro no reverse geocoding (Nominatim):", err);
    return null;
  }
}

router.get("/active", async (req, res, next) => {
  try {
    const { id: profileId, role } = req.profile;

    let rows;
    if (role === "dependent") {
      ({ rows } = await pool.query(
        `SELECT a.id, a.status, a.emitted_at, a.acknowledged_at, a.resolved_at,
                a.escalated_at, a.notes, a.latitude, a.longitude, a.address,
                a.dependent_profile_id, p.name AS dependent_name
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

    res.json({ activeAlerts: rows.map(formatAlert) });
  } catch (err) {
    next(err);
  }
});

router.get("/active-for-me", requireRole("dependent"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.emitted_at, a.acknowledged_at, a.resolved_at,
              a.escalated_at, a.notes, a.latitude, a.longitude, a.address,
              a.dependent_profile_id, p.name AS dependent_name
       FROM alerts a
       JOIN profiles p ON p.id = a.dependent_profile_id
       WHERE a.dependent_profile_id = $1
         AND a.status IN ('pending', 'notified', 'acknowledged', 'escalated')
       ORDER BY a.emitted_at DESC
       LIMIT 1`,
      [req.profile.id]
    );

    res.json({ alert: rows[0] ? formatAlert(rows[0]) : null });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { id: profileId, role } = req.profile;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    let rows;
    if (role === "dependent") {
      ({ rows } = await pool.query(
        `SELECT a.id, a.status, a.emitted_at, a.acknowledged_at, a.resolved_at,
                a.escalated_at, a.notes, a.latitude, a.longitude, a.address,
                a.dependent_profile_id, p.name AS dependent_name
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

    res.json({ alerts: rows.map(formatAlert) });
  } catch (err) {
    next(err);
  }
});

router.post("/emit", requireRole("dependent"), async (req, res) => {
  const dependentProfileId = req.profile.id;
  const { latitude, longitude } = req.body || {};
  const lat = latitude != null ? Number(latitude) : null;
  const lng = longitude != null ? Number(longitude) : null;

  try {
    const { rows: profileRows } = await pool.query(
      "SELECT name FROM profiles WHERE id = $1",
      [dependentProfileId]
    );
    if (!profileRows.length) return res.status(404).json({ error: "Perfil não encontrado" });
    const dependentName = profileRows[0].name;

    const { rows: existing } = await pool.query(
      `SELECT id FROM alerts
       WHERE dependent_profile_id = $1
         AND status NOT IN ('resolved_carer', 'resolved_dependent', 'cancelled')`,
      [dependentProfileId]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: "Já existe um alerta ativo", alertId: existing[0].id });
    }

    const { rows } = await pool.query(
      `INSERT INTO alerts (dependent_profile_id, status, latitude, longitude, address)
       VALUES ($1, 'pending', $2, $3, NULL)
       RETURNING id, status, emitted_at, latitude, longitude, address`,
      [dependentProfileId, lat, lng]
    );

    const alert = rows[0];
    const mapsUrl = buildMapsUrl(alert.latitude, alert.longitude);

    await notifyCarersOfAlert(dependentProfileId, {
      id: alert.id,
      alertId: alert.id,
      dependentProfileId,
      dependent_profile_id: dependentProfileId,
      dependentName,
      dependent_name: dependentName,
      emittedAt: alert.emitted_at,
      emitted_at: alert.emitted_at,
      created_at: alert.emitted_at,
      status: "pending",
      latitude: alert.latitude,
      longitude: alert.longitude,
      address: null,
      mapsUrl,
    });

    if (lat != null && lng != null) {
      fetchAddressFromNominatim(lat, lng).then(async (resolvedAddress) => {
        if (!resolvedAddress) return;
        try {
          await pool.query("UPDATE alerts SET address = $1 WHERE id = $2", [
            resolvedAddress,
            alert.id,
          ]);
        } catch (err) {
          console.error("Erro ao atualizar endereço do alerta:", err);
        }
      });
    }

    try {
      const { rows: userRows } = await pool.query(
        `SELECT u.email
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         WHERE p.id = $1`,
        [dependentProfileId]
      );
      if (userRows[0]?.email) {
        console.info(`[ALERT] Disparando email para o usuário cadastrado: ${userRows[0].email}`);
        sendAlertEmail(
          userRows[0].email,
          dependentName,
          alert.emitted_at,
          alert.latitude,
          alert.longitude,
          null
        );
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
          !["acknowledged", "resolved_carer", "resolved_dependent", "escalated", "cancelled"].includes(
            check[0].status
          )
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
    }, parseInt(process.env.ESCALATE_MS, 10) || 30000);

    res.status(201).json({
      id: alert.id,
      alertId: alert.id,
      status: alert.status,
      emittedAt: alert.emitted_at,
      created_at: alert.emitted_at,
      latitude: alert.latitude,
      longitude: alert.longitude,
      address: null,
      mapsUrl,
    });
  } catch (err) {
    console.error("Erro em /emit:", err);
    res.status(500).json({ error: "Erro interno ao processar o alerta" });
  }
});

router.post("/:id/acknowledge", requireRole("carer"), async (req, res, next) => {
  try {
    const { id: alertId } = req.params;

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
    res.json({ id: alertId, alertId, status: "acknowledged" });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/resolve", async (req, res, next) => {
  try {
    const { id: profileId, role } = req.profile;
    const { id: alertId } = req.params;
    const { notes, pin } = req.body || {};

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

      if (!alertRow) return res.status(404).json({ error: "Alerta não encontrado" });

      if (alertRow.dismiss_pin) {
        if (isPinBlocked(profileId)) {
          return res.status(429).json({
            error: "Muitas tentativas incorretas de PIN. Aguarde alguns minutos ou peça ao cuidador para encerrar.",
          });
        }
        if (!pin) {
          return res.status(400).json({ error: "PIN obrigatório." });
        }
        const valid = await bcrypt.compare(String(pin), alertRow.dismiss_pin);
        if (!valid) {
          recordPinFailure(profileId);
          return res.status(403).json({ error: "PIN incorreto." });
        }
        clearPinFailures(profileId);
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
    await notifyAllOfResolution(alertRow.dependent_profile_id, carerProfileId, alertId, newStatus);
    res.json({ id: alertId, alertId, status: newStatus });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { id: profileId, role } = req.profile;
    const { id: alertId } = req.params;

    let query;
    let params;
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
    res.json(formatAlert(rows[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
