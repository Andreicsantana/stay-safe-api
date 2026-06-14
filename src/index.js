require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { initDb } = require("./db/init");
const { initWs } = require("./ws/server");

const authRoutes = require("./routes/auth");
const alertRoutes = require("./routes/alerts");
const profileRoutes = require("./routes/profiles");
const userRoutes = require("./routes/users");

const app = express();
const server = http.createServer(app);

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

// Rate limit global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/users", userRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: "Rota não encontrada" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Erro interno" });
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initDb();
  initWs(server);
  server.listen(PORT, () => {
    console.info(`Stay Safe API running on port ${PORT}`);
  });
}

start().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});