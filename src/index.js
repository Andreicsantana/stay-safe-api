require("dotenv").config();
const http = require("http");

const { createApp } = require("./app");
const { pool } = require("./db/pool");
const { initDb } = require("./db/init");
const { initWs } = require("./ws/server");
const { startEscalationWorker } = require("./services/escalationWorker");

const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = createApp();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

let wss = null;
let stopWorker = null;

async function start() {
  await initDb();
  wss = initWs(server);
  stopWorker = startEscalationWorker();
  server.listen(PORT, () => {
    console.info(`Stay Safe API running on port ${PORT}`);
  });
}

async function shutdown(signal) {
  console.info(`Received ${signal}, shutting down...`);
  if (stopWorker) stopWorker();
  if (wss) {
    wss.close();
  }
  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
