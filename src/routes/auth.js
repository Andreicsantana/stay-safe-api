const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");
const { sendToProfile } = require("../ws/server");

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "E-mail e senha são obrigatórios" });
  }

  try {
    const { rows: users } = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [email.toLowerCase().trim()]
    );

    const user = users[0];
    if (!user) {
      return res.status(401).json({ error: "E-mail ou senha incorretos" });
    }

    const isValid = await bcrypt.compare(String(password), user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "E-mail ou senha incorretos" });
    }

    // Get profiles for user
    const { rows: profiles } = await pool.query(
      `SELECT id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin", created_at
       FROM profiles WHERE user_id = $1 ORDER BY created_at`,
      [user.id]
    );

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      profiles,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/select-profile
router.post("/select-profile", async (req, res, next) => {
  const { userId, profileId, deviceToken, platform } = req.body;

  if (!userId || !profileId) {
    return res.status(400).json({ error: "userId e profileId são obrigatórios" });
  }

  try {
    // Verify profile belongs to user
    const { rows: profiles } = await pool.query(
      `SELECT id, user_id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin"
       FROM profiles WHERE id = $1 AND user_id = $2`,
      [profileId, userId]
    );

    const profile = profiles[0];
    if (!profile) {
      return res.status(404).json({ error: "Perfil não encontrado" });
    }

    // Generate JWT token
    const tokenPayload = { profileId: profile.id };
    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    // For local simplify, refreshToken is the same
    const refreshToken = accessToken;

    // Register device token — delete any existing row with this token first
    // (token is UNIQUE, so we clear regardless of which profile owned it before)
    if (deviceToken) {
      await pool.query(
        `DELETE FROM device_tokens WHERE token = $1`,
        [deviceToken]
      );
      await pool.query(
        `INSERT INTO device_tokens (profile_id, token, platform, last_seen)
         VALUES ($1, $2, $3, NOW())`,
        [profile.id, deviceToken, platform || "web"]
      );
    }

    let dependents = [];
    if (profile.role === "carer") {
      const { rows } = await pool.query(
        `SELECT id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin"
         FROM profiles
         WHERE user_id = $1 AND role = 'dependent'
         ORDER BY created_at`,
        [profile.user_id]
      );
      dependents = rows;
    }

    res.json({
      accessToken,
      refreshToken,
      profile,
      dependents,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/create-profile
// Creates a profile for a user (used before selecting a profile / having a JWT)
router.post("/create-profile", async (req, res, next) => {
  const { userId, name, role, pin } = req.body;

  if (!userId || !name || !role) {
    return res.status(400).json({ error: "userId, nome e role são obrigatórios" });
  }
  if (!["carer", "dependent"].includes(role)) {
    return res.status(400).json({ error: "role deve ser 'carer' ou 'dependent'" });
  }

  try {
    // Verify user exists
    const { rows: users } = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [userId]
    );
    if (!users[0]) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    let dismiss_pin = null;
    if (pin) {
      dismiss_pin = await bcrypt.hash(String(pin), 12);
    }

    const { rows } = await pool.query(
      `INSERT INTO profiles (user_id, name, role, dismiss_pin)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin", created_at`,
      [userId, name.trim(), role, dismiss_pin]
    );

    res.status(201).json({ profile: rows[0] });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/auth/update-profile
// Updates a profile name and/or PIN using userId (no JWT needed yet)
router.patch("/update-profile", async (req, res, next) => {
  const { userId, profileId, name, pin } = req.body;

  if (!userId || !profileId) {
    return res.status(400).json({ error: "userId e profileId são obrigatórios" });
  }

  try {
    const { rows: check } = await pool.query(
      "SELECT id FROM profiles WHERE id = $1 AND user_id = $2",
      [profileId, userId]
    );
    if (!check[0]) return res.status(404).json({ error: "Perfil não encontrado" });

    const updates = [];
    const values = [];
    let i = 1;

    if (name) {
      updates.push(`name = $${i++}`);
      values.push(name.trim());
    }
    if (pin !== undefined) {
      const hash = pin ? await bcrypt.hash(String(pin), 12) : null;
      updates.push(`dismiss_pin = $${i++}`);
      values.push(hash);
    }

    if (!updates.length) return res.status(400).json({ error: "Nada para atualizar" });

    values.push(profileId);
    const { rows } = await pool.query(
      `UPDATE profiles SET ${updates.join(", ")} WHERE id = $${i}
       RETURNING id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin"`,
      values
    );

    res.json({ profile: rows[0] });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/auth/delete-profile
// Deletes a profile using userId (no JWT needed yet)
router.delete("/delete-profile", async (req, res, next) => {
  const { userId, profileId } = req.body;

  if (!userId || !profileId) {
    return res.status(400).json({ error: "userId e profileId são obrigatórios" });
  }

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM profiles WHERE id = $1 AND user_id = $2",
      [profileId, userId]
    );
    if (!rowCount) return res.status(404).json({ error: "Perfil não encontrado" });

    res.json({ deleted: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/force-logout
// Force disconnect a profile (used by carers to log out dependents)
router.post("/force-logout", async (req, res, next) => {
  const { userId, profileId } = req.body;

  if (!userId || !profileId) {
    return res.status(400).json({ error: "userId e profileId são obrigatórios" });
  }

  try {
    // Check if the profile belongs to the user
    const { rows: check } = await pool.query(
      "SELECT id FROM profiles WHERE id = $1 AND user_id = $2",
      [profileId, userId]
    );
    if (!check[0]) return res.status(404).json({ error: "Perfil não encontrado" });

    // Delete device tokens
    await pool.query("DELETE FROM device_tokens WHERE profile_id = $1", [profileId]);

    // Send WS message to force logout
    sendToProfile(profileId, { type: "FORCE_LOGOUT" });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
