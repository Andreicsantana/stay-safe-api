const router = require("express").Router();
const bcrypt = require("bcrypt");
const { pool } = require("../db/pool");
const { authMiddleware } = require("../middleware/auth");

router.use(authMiddleware);

// GET /api/profiles/me - current profile
router.get("/me", async (req, res) => {
  res.json({ profile: req.profile });
});

// GET /api/profiles/my - all profiles of the user
router.get("/my", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin", created_at
     FROM profiles WHERE user_id = $1 ORDER BY created_at`,
    [req.userId]
  );
  res.json({ profiles: rows });
});

router.post("/", async (req, res) => {
  const { name, role, pin } = req.body;
  if (!name || !role) return res.status(400).json({ error: "Nome e role são obrigatórios" });
  if (!["carer", "dependent"].includes(role))
    return res.status(400).json({ error: "role deve ser 'carer' ou 'dependent'" });

  let dismiss_pin = null;
  if (pin) dismiss_pin = await bcrypt.hash(String(pin), 12);

  const { rows } = await pool.query(
    `INSERT INTO profiles (user_id, name, role, dismiss_pin)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin", created_at`,
    [req.userId, name.trim(), role, dismiss_pin]
  );
  res.status(201).json({ profile: rows[0] });
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, pin } = req.body;

  const { rows: check } = await pool.query(
    `SELECT id FROM profiles WHERE id = $1 AND user_id = $2`,
    [id, req.userId]
  );
  if (!check[0]) return res.status(404).json({ error: "Perfil não encontrado" });

  const updates = [];
  const values = [];
  let i = 1;
  if (name) { updates.push(`name = $${i++}`); values.push(name.trim()); }
  if (pin !== undefined) {
    const hash = pin ? await bcrypt.hash(String(pin), 12) : null;
    updates.push(`dismiss_pin = $${i++}`);
    values.push(hash);
  }
  if (!updates.length) return res.status(400).json({ error: "Nada para atualizar" });

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE profiles SET ${updates.join(", ")} WHERE id = $${i}
     RETURNING id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin"`,
    values
  );
  res.json({ profile: rows[0] });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const { rowCount } = await pool.query(
    `DELETE FROM profiles WHERE id = $1 AND user_id = $2`,
    [id, req.userId]
  );
  if (!rowCount) return res.status(404).json({ error: "Perfil não encontrado" });
  res.json({ deleted: true });
});

router.get("/dependents", async (req, res) => {
  if (req.profile.role !== "carer") return res.status(403).json({ error: "Apenas cuidadores" });

  const { rows } = await pool.query(
    `SELECT id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin", created_at
     FROM profiles
     WHERE user_id = $1 AND role = 'dependent'
     ORDER BY created_at`,
    [req.userId]
  );
  res.json({ dependents: rows });
});

// POST /api/profiles/relationships - link carer to dependent
router.post("/relationships", async (req, res) => {
  const { carerProfileId, dependentProfileId } = req.body;
  if (!carerProfileId || !dependentProfileId)
    return res.status(400).json({ error: "carerProfileId e dependentProfileId obrigatórios" });

  const { rows: carer } = await pool.query(
    `SELECT id FROM profiles WHERE id = $1 AND user_id = $2 AND role = 'carer'`,
    [carerProfileId, req.userId]
  );
  if (!carer[0]) return res.status(404).json({ error: "Perfil cuidador não encontrado" });

  const { rows: dep } = await pool.query(
    `SELECT id FROM profiles WHERE id = $1 AND user_id = $2 AND role = 'dependent'`,
    [dependentProfileId, req.userId]
  );
  if (!dep[0]) return res.status(404).json({ error: "Perfil dependente não encontrado" });

  await pool.query(
    `INSERT INTO relationships (carer_profile_id, dependent_profile_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [carerProfileId, dependentProfileId]
  );
  res.status(201).json({ linked: true });
});

// DELETE /api/profiles/relationships
router.delete("/relationships", async (req, res) => {
  const { carerProfileId, dependentProfileId } = req.body;
  await pool.query(
    `DELETE FROM relationships WHERE carer_profile_id = $1 AND dependent_profile_id = $2`,
    [carerProfileId, dependentProfileId]
  );
  res.json({ unlinked: true });
});

module.exports = router;