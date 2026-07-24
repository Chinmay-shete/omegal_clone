require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const compression = require("compression");
const pinoHttp = require("pino-http");

const logger = require("./config/logger");
const { pubClient, subClient } = require("./config/redis");
const { httpLimiter, socketConnectionRateLimiter, socketEventRateLimiter } = require("./middleware/rateLimiter");
const homeRouter = require("./routes/home-routes");
const healthRouter = require("./routes/health");

const server = http.createServer(app);

// Configure Socket.IO
const io = socketIo(server, {
  pingTimeout: 60000,   // 60 seconds
  pingInterval: 25000,  // 25 seconds
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS === "*") {
        return callback(null, true);
      }
      const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim());
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Conditionally attach Redis Adapter if Redis is connected
if (pubClient.status === "ready") {
  try {
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("Redis adapter attached to Socket.IO");
  } catch (err) {
    logger.error({ err }, "Failed to attach Redis adapter");
  }
} else {
  pubClient.once("ready", () => {
    try {
      io.adapter(createAdapter(pubClient, subClient));
      logger.info("Redis adapter attached to Socket.IO on ready event");
    } catch (err) {
      logger.error({ err }, "Failed to attach Redis adapter on ready event");
    }
  });
}

// Socket.IO Rate Limiters
io.use(socketConnectionRateLimiter);
io.use(socketEventRateLimiter);

// Share IO instance via req.app for health check
app.set("io", io);

// Attach Socket.IO handlers
require("./sockets/chat-socket")(io);

// Structured HTTP logging
app.use(pinoHttp({ logger }));

// Response compression
app.use(compression({ level: 6 }));

// Request parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets with 7d caching
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "7d",
    etag: true,
  })
);

// EJS Setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// General HTTP rate limiting
app.use(httpLimiter);

// Routes
app.use("/health", healthRouter);
app.use("/", homeRouter);

// Graceful Shutdown Logic
function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info("HTTP server closed.");

    try {
      await Promise.all([
        pubClient.quit(),
        subClient.quit(),
      ]);
      logger.info("Redis connections closed.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during Redis connection close");
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

module.exports = { server, app, io };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}
