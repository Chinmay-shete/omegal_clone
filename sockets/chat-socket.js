const logger = require("../config/logger");
const { redisClient } = require("../config/redis");

// In-memory fallback state
const localActiveSockets = new Set();
const localQueuedUsers = new Set();
const localQueue = [];
const localQueueTimestamps = new Map();
const localRooms = new Map();

function isRedisReady() {
  return redisClient && redisClient.status === "ready";
}

const store = {
  async addActiveSocket(id) {
    if (isRedisReady()) {
      await redisClient.sadd("linkup:active_sockets", id).catch(() => {});
    }
    localActiveSockets.add(id);
  },
  async removeActiveSocket(id) {
    if (isRedisReady()) {
      await redisClient.srem("linkup:active_sockets", id).catch(() => {});
    }
    localActiveSockets.delete(id);
  },
  async getRoom(id) {
    if (isRedisReady()) {
      try {
        const room = await redisClient.hget("linkup:rooms", id);
        if (room) return room;
      } catch (e) {}
    }
    return localRooms.get(id) || null;
  },
  async setRoom(id, roomname) {
    if (isRedisReady()) {
      await redisClient.hset("linkup:rooms", id, roomname).catch(() => {});
    }
    localRooms.set(id, roomname);
  },
  async delRoom(id) {
    if (isRedisReady()) {
      await redisClient.hdel("linkup:rooms", id).catch(() => {});
    }
    localRooms.delete(id);
  },
  async popQueue() {
    if (isRedisReady()) {
      try {
        const item = await redisClient.rpop("linkup:queue");
        if (item) return item;
      } catch (e) {}
    }
    return localQueue.pop() || null;
  },
  async pushQueue(id) {
    if (isRedisReady()) {
      try {
        await redisClient.sadd("linkup:queued_users", id);
        await redisClient.lpush("linkup:queue", id);
        await redisClient.zadd("linkup:queue_timestamps", Date.now(), id);
      } catch (e) {}
    }
    if (!localQueuedUsers.has(id)) {
      localQueuedUsers.add(id);
      localQueue.unshift(id);
      localQueueTimestamps.set(id, Date.now());
    }
  },
  async removeFromQueue(id) {
    if (isRedisReady()) {
      try {
        await redisClient.lrem("linkup:queue", 0, id);
        await redisClient.srem("linkup:queued_users", id);
        await redisClient.zrem("linkup:queue_timestamps", id);
      } catch (e) {}
    }
    localQueuedUsers.delete(id);
    const idx = localQueue.indexOf(id);
    if (idx !== -1) localQueue.splice(idx, 1);
    localQueueTimestamps.delete(id);
  },
  async isQueued(id) {
    if (isRedisReady()) {
      try {
        const queued = await redisClient.sismember("linkup:queued_users", id);
        if (queued) return true;
      } catch (e) {}
    }
    return localQueuedUsers.has(id);
  },
  async isActive(id) {
    if (isRedisReady()) {
      try {
        const active = await redisClient.sismember("linkup:active_sockets", id);
        if (active) return true;
      } catch (e) {}
    }
    return localActiveSockets.has(id);
  },
  async hasRoom(id) {
    if (isRedisReady()) {
      try {
        const has = await redisClient.hexists("linkup:rooms", id);
        if (has) return true;
      } catch (e) {}
    }
    return localRooms.has(id);
  }
};

async function disbandRoom(io, roomname) {
  if (!roomname) return;
  const ids = roomname.split("-");
  if (ids.length === 2) {
    const [id1, id2] = ids;
    io.in(id1).socketsLeave(roomname);
    io.in(id2).socketsLeave(roomname);
    await store.delRoom(id1);
    await store.delRoom(id2);
    logger.info({ roomname }, "Room disbanded");
  }
}

// Run stale queue cleaner every 30 seconds
setInterval(async () => {
  try {
    const now = Date.now();
    const staleTime = now - 60000;
    if (isRedisReady()) {
      const staleUsers = await redisClient.zrangebyscore("linkup:queue_timestamps", 0, staleTime).catch(() => []);
      for (const userId of staleUsers) {
        await store.removeFromQueue(userId);
      }
    }
    for (const [userId, ts] of localQueueTimestamps.entries()) {
      if (ts <= staleTime) {
        await store.removeFromQueue(userId);
      }
    }
  } catch (err) {
    logger.error({ err }, "Error running stale queue cleaner");
  }
}, 30000);

module.exports = function (io) {
  io.on("connection", async function (socket) {
    logger.info({ socketId: socket.id }, "User connected");
    await store.addActiveSocket(socket.id);

    socket.on("joinroom", async function () {
      try {
        const room = await store.getRoom(socket.id);
        if (room) {
          io.in(socket.id).socketsLeave(room);
          await store.delRoom(socket.id);
        }
        await matchUser(socket);
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error in joinroom");
      }
    });

    socket.on("nextStranger", async function () {
      try {
        const room = await store.getRoom(socket.id);
        if (room) {
          socket.broadcast.to(room).emit("partnerDisconnected");
          await disbandRoom(io, room);
        } else {
          await store.removeFromQueue(socket.id);
        }
        await matchUser(socket);
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error in nextStranger");
      }
    });

    socket.on("signalingMessage", async (data) => {
      try {
        const room = await store.getRoom(socket.id);
        if (room && room === data.room) {
          socket.broadcast.to(data.room).emit("signalingMessage", data.message);
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error in signalingMessage");
      }
    });

    socket.on("message", async function (data) {
      try {
        const room = await store.getRoom(socket.id);
        if (data && room && room === data.room) {
          if (typeof data.message === "string" && data.message.trim().length > 0) {
            if (data.message.length > 1000) {
              socket.emit("error_msg", "Message cannot exceed 1000 characters.");
              return;
            }
            socket.broadcast.to(data.room).emit("message", data.message);
          }
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error in message");
      }
    });

    socket.on("startVideoCall", async function ({ room }) {
      try {
        const userRoom = await store.getRoom(socket.id);
        if (userRoom && userRoom === room) {
          socket.broadcast.to(room).emit("incomingCall");
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error in startVideoCall");
      }
    });

    socket.on("rejectCall", async function ({ room }) {
      try {
        const userRoom = await store.getRoom(socket.id);
        if (userRoom && userRoom === room) {
          socket.broadcast.to(room).emit("callRejected");
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error in rejectCall");
      }
    });

    socket.on("acceptCall", async function ({ room }) {
      try {
        const userRoom = await store.getRoom(socket.id);
        if (userRoom && userRoom === room) {
          socket.broadcast.to(room).emit("callAccepted");
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error in acceptCall");
      }
    });

    socket.on("disconnect", async function () {
      try {
        logger.info({ socketId: socket.id }, "User disconnected");
        await store.removeActiveSocket(socket.id);
        await store.removeFromQueue(socket.id);

        const room = await store.getRoom(socket.id);
        if (room) {
          socket.broadcast.to(room).emit("partnerDisconnected");
          await disbandRoom(io, room);
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, "Error on disconnect");
      }
    });

    async function matchUser(s) {
      let matched = false;
      let attempts = 0;

      while (!matched && attempts < 10) {
        attempts++;
        const partnerId = await store.popQueue();
        if (!partnerId) {
          break;
        }

        if (partnerId === s.id) {
          continue;
        }

        const [isActive, hasRoom] = await Promise.all([
          store.isActive(partnerId),
          store.hasRoom(partnerId)
        ]);

        if (isActive && !hasRoom) {
          matched = true;
          const roomname = `${s.id}-${partnerId}`;

          await store.setRoom(s.id, roomname);
          await store.setRoom(partnerId, roomname);

          await store.removeFromQueue(s.id);
          await store.removeFromQueue(partnerId);

          io.in(s.id).socketsJoin(roomname);
          io.in(partnerId).socketsJoin(roomname);

          logger.info({ roomname, user1: s.id, user2: partnerId }, "Users matched successfully");
          io.to(roomname).emit("joined", roomname);
          return;
        } else {
          await store.removeFromQueue(partnerId);
        }
      }

      const alreadyQueued = await store.isQueued(s.id);
      if (!alreadyQueued) {
        await store.pushQueue(s.id);
        logger.info({ socketId: s.id }, "User added to queue");
      }
    }
  });
};
