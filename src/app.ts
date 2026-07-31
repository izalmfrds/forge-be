import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";
import requirementsRouter from "./routes/requirements.js";
import projectKanbanRouter, { cardRouter } from "./routes/kanban.js";
import projectScreensRouter, { screenRouter } from "./routes/screens.js";
import aiRouter from "./routes/ai.js";
import searchRouter from "./routes/search.js";
import exportRouter from "./routes/export.js";
import artifactsRouter from "./routes/artifacts.js";
import orchestrationRouter from "./routes/orchestration.js";
import { authRequired } from "./lib/auth.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

dotenv.config();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "2mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.get("/", (_req, res) => {
  res.json({ name: "Forge API", version: "0.1.0", docs: "/health" });
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, runtime: "node", env: process.env.NODE_ENV || "development" });
});

app.use("/api/auth", authRouter);
app.use("/api", authRequired);
app.use("/api/projects", projectsRouter);
app.use("/api/projects", requirementsRouter);
app.use("/api/projects", projectKanbanRouter);
app.use("/api/projects", projectScreensRouter);
app.use("/api/projects", exportRouter);
app.use("/api/projects", artifactsRouter);
app.use("/api/projects", orchestrationRouter);
app.use("/api/kanban/cards", cardRouter);
app.use("/api/screens", screenRouter);
app.use("/api/ai", aiRouter);
app.use("/api/search", searchRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
