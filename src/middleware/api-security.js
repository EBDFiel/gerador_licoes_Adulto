"use strict";

function allowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(configured.length ? configured : [
    "https://ebdfiel.com.br",
    "https://www.ebdfiel.com.br",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5500"
  ]);
}

function buildCorsOptions() {
  const origins = allowedOrigins();
  return {
    origin(origin, callback) {
      // Requisições sem Origin incluem health checks e chamadas servidor-servidor.
      if (!origin || origins.has(origin)) return callback(null, true);
      return callback(new Error("Origem não autorizada pelo CORS."));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-EBD-Admin-Token"],
    maxAge: 86400
  };
}

function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  const buckets = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of buckets.entries()) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(windowMs, 60_000));
  cleanup.unref?.();

  return function rateLimit(req, res, next) {
    const key = String(req.ip || req.socket?.remoteAddress || "unknown");
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      return res.status(429).json({ ok: false, error: "Muitas solicitações. Aguarde um minuto e tente novamente." });
    }
    next();
  };
}

function optionalAdminToken(req, res, next) {
  const expected = String(process.env.ADMIN_API_TOKEN || "").trim();
  if (!expected) return next();

  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const headerToken = String(req.headers["x-ebd-admin-token"] || "").trim();
  if (bearer === expected || headerToken === expected) return next();

  return res.status(401).json({ ok: false, error: "Autorização administrativa inválida." });
}

module.exports = { buildCorsOptions, createRateLimiter, optionalAdminToken };
