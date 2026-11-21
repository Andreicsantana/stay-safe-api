const router = require("express").Router();
const bcrypt = require("bcrypt");
const { pool } = require("../db/pool");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register", async (req, res, next) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: "Nome, e-mail, telefone e senha são obrigatórios" });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: "E-mail inválido" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres" });
  }

  try {
    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: "Este e-mail já está cadastrado" });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);

    const { rows } = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, created_at`,
      [String(name).trim(), normalizedEmail, String(phone).trim(), passwordHash]
    );

    res.status(201).json({
      user: rows[0],
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
