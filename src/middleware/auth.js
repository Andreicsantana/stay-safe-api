const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Attach profile + user info to request
    const { rows } = await pool.query(
      `SELECT p.id, p.user_id, p.name, p.role, u.email
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [payload.profileId]
    );
    if (!rows[0]) return res.status(401).json({ error: "Perfil não encontrado" });
    req.profile = rows[0];
    req.userId = rows[0].user_id;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
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

module.exports = { authMiddleware, requireRole };