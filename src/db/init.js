const { pool } = require("./pool");

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('carer', 'dependent')),
        dismiss_pin TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        carer_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        dependent_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(carer_profile_id, dependent_profile_id)
      );

      CREATE TABLE IF NOT EXISTS device_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        platform TEXT DEFAULT 'web',
        last_seen TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(profile_id, token)
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dependent_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','notified','acknowledged','resolved_carer','resolved_dependent','escalated','cancelled')),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        address TEXT,
        emitted_at TIMESTAMPTZ DEFAULT NOW(),
        acknowledged_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        escalated_at TIMESTAMPTZ,
        resolved_by TEXT,
        notes TEXT
      );

      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS address TEXT;

      CREATE INDEX IF NOT EXISTS idx_alerts_dependent ON alerts(dependent_profile_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
      CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_carer ON relationships(carer_profile_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_dependent ON relationships(dependent_profile_id);
    `);
    console.info("Database initialized");
  } finally {
    client.release();
  }
}

module.exports = { initDb };