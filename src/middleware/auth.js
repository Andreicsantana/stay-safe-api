const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.profileId) {
      return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
    }
    const { rows } = await pool.query(
      `SELECT p.id, p.user_id, p.name, p.role, (p.dismiss_pin IS NOT NULL) AS "hasPin", u.email
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [payload.profileId]
    );
    if (!rows[0]) return res.status(401).json({ error: "Perfil não encontrado" });
    req.profile = rows[0];
    req.userId = rows[0].user_id;
    next();
  } catch {
    return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  }
}

async function accountAuthMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.userId) {
      req.userId = payload.userId;
      return next();
    }
    if (payload.profileId) {
      const { rows } = await pool.query(
        "SELECT user_id FROM profiles WHERE id = $1",
        [payload.profileId]
      );
      if (!rows[0]) return res.status(401).json({ error: "Perfil não encontrado" });
      req.userId = rows[0].user_id;
      return next();
    }
    return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  } catch {
    return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.profile || !roles.includes(req.profile.role)) {
      return res.status(403).json({ error: "Acesso negado" });
    }
    next();
  };
}

module.exports = { authMiddleware, accountAuthMiddleware, requireRole };
