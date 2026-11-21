const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { pool } = require("./db/pool");
const authRoutes = require("./routes/auth");
const alertRoutes = require("./routes/alerts");
const profileRoutes = require("./routes/profiles");
const userRoutes = require("./routes/users");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  app.use(express.json());

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", ts: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "error" });
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/alerts", alertRoutes);
  app.use("/api/profiles", profileRoutes);
  app.use("/api/users", userRoutes);

  app.use((req, res) => res.status(404).json({ error: "Rota não encontrada" }));

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Erro interno" });
  });

  return app;
}

module.exports = { createApp };
