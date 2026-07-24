const rateLimit = require("express-rate-limit");
const { RateLimiterRedis, RateLimiterMemory } = require("rate-limiter-flexible");
const { redisClient } = require("../config/redis");
const logger = require("../config/logger");

// HTTP Rate Limiter (express-rate-limit)
const httpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, message: "Too many requests from this IP, please try again after 15 minutes" },
});

// Socket.IO Connection Rate Limiters
const connLimiterRedis = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "ratelimit_conn",
  points: 10,
  duration: 60,
  blockDuration: 300,
});

const connLimiterMemory = new RateLimiterMemory({
  points: 10,
  duration: 60,
  blockDuration: 300,
});

// Socket.IO Message/Event Rate Limiters
const evtLimiterRedis = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "ratelimit_event",
  points: 5,
  duration: 1,
});

const evtLimiterMemory = new RateLimiterMemory({
  points: 5,
  duration: 1,
});

const socketConnectionRateLimiter = async (socket, next) => {
  const ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
  try {
    if (redisClient.status === "ready") {
      await connLimiterRedis.consume(ip);
    } else {
      await connLimiterMemory.consume(ip);
    }
    next();
  } catch (rejRes) {
    if (rejRes instanceof Error) {
      logger.warn({ ip, err: rejRes.message }, "Rate limiter encountered an error, allowing connection");
      return next();
    }
    logger.warn({ ip }, "Socket connection rate limit exceeded");
    const err = new Error("Too many connections. Please wait 5 minutes.");
    err.data = { status: 429, retryAfter: Math.round((rejRes.msBeforeNext || 0) / 1000) };
    next(err);
  }
};

const socketEventRateLimiter = (socket, next) => {
  socket.use(async (packet, nextMiddle) => {
    const eventName = packet[0];
    if (["message", "joinroom", "nextStranger", "startVideoCall"].includes(eventName)) {
      try {
        if (redisClient.status === "ready") {
          await evtLimiterRedis.consume(socket.id);
        } else {
          await evtLimiterMemory.consume(socket.id);
        }
        nextMiddle();
      } catch (rejRes) {
        if (rejRes instanceof Error) {
          return nextMiddle();
        }
        logger.warn({ socketId: socket.id, eventName }, "Socket event rate limit exceeded");
        socket.emit("error_msg", "Rate limit exceeded. Please slow down.");
        nextMiddle(new Error("Rate limit exceeded"));
      }
    } else {
      nextMiddle();
    }
  });
  next();
};

module.exports = {
  httpLimiter,
  socketConnectionRateLimiter,
  socketEventRateLimiter,
};
