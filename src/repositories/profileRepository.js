const { pool } = require("../db/pool");

async function findProfileById(profileId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, name, role, (dismiss_pin IS NOT NULL) AS "hasPin", created_at
     FROM profiles WHERE id = $1`,
    [profileId]
  );
  return rows[0] || null;
}

async function findCarerProfileIdsByDependentId(dependentProfileId) {
  const { rows } = await pool.query(
    `SELECT p.id AS carer_profile_id
     FROM profiles p
     WHERE p.user_id = (
       SELECT user_id FROM profiles WHERE id = $1
     )
     AND p.role = 'carer'`,
    [dependentProfileId]
  );
  return rows.map((r) => r.carer_profile_id);
}

module.exports = {
  findProfileById,
  findCarerProfileIdsByDependentId,
};
