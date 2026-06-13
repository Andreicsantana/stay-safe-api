require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("./pool");

async function seed() {
  console.log("Seeding database...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create default user
    const email = "maria@example.com";
    const password = "senha123";
    const name = "Maria da Silva";

    const { rows: existingUsers } = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    let userId;
    if (existingUsers.length === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      const { rows } = await client.query(
        "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
        [name, email, passwordHash]
      );
      userId = rows[0].id;
      console.log(`User ${email} created.`);
    } else {
      userId = existingUsers[0].id;
      console.log(`User ${email} already exists.`);
    }

    // 2. Create carer profile
    const carerName = "Maria (Cuidadora)";
    const { rows: existingCarers } = await client.query(
      "SELECT id FROM profiles WHERE user_id = $1 AND role = 'carer'",
      [userId]
    );

    let carerId;
    if (existingCarers.length === 0) {
      const { rows } = await client.query(
        "INSERT INTO profiles (user_id, name, role) VALUES ($1, $2, 'carer') RETURNING id",
        [userId, carerName]
      );
      carerId = rows[0].id;
      console.log(`Carer profile ${carerName} created.`);
    } else {
      carerId = existingCarers[0].id;
      console.log(`Carer profile ${carerName} already exists.`);
    }

    // 3. Create dependent profile
    const depName = "João (Dependente)";
    const pin = "1234";
    const { rows: existingDeps } = await client.query(
      "SELECT id FROM profiles WHERE user_id = $1 AND role = 'dependent'",
      [userId]
    );

    let dependentId;
    if (existingDeps.length === 0) {
      const pinHash = await bcrypt.hash(pin, 12);
      const { rows } = await client.query(
        "INSERT INTO profiles (user_id, name, role, dismiss_pin) VALUES ($1, $2, 'dependent', $3) RETURNING id",
        [userId, depName, pinHash]
      );
      dependentId = rows[0].id;
      console.log(`Dependent profile ${depName} created.`);
    } else {
      dependentId = existingDeps[0].id;
      console.log(`Dependent profile ${depName} already exists.`);
    }

    // 4. Create relationship
    await client.query(
      `INSERT INTO relationships (carer_profile_id, dependent_profile_id)
       VALUES ($1, $2)
       ON CONFLICT (carer_profile_id, dependent_profile_id) DO NOTHING`,
      [carerId, dependentId]
    );
    console.log("Relationship between Carer and Dependent verified/created.");

    await client.query("COMMIT");
    console.log("Seeding complete successfully!");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error seeding database:", e);
  } finally {
    client.release();
  }
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
