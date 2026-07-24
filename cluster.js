require("dotenv").config();
const cluster = require("cluster");
const http = require("http");
const os = require("os");
const logger = require("./config/logger");

// Only enable multi-process clustering if Redis URL is configured OR explicit cluster flag is set.
// Without Redis, multi-worker clustering isolates in-memory queues per worker process, preventing cross-device matching.
const isClusterMode = process.env.REDIS_URL || process.env.CLUSTER_ENABLED === "true";

if (isClusterMode && cluster.isPrimary) {
  const { setupMaster } = require("@socket.io/sticky");
  const { setupPrimary } = require("@socket.io/cluster-adapter");
  const PORT = process.env.PORT || 3000;
  const server = http.createServer();

  setupMaster(server, {
    loadBalancingMethod: "least-connection",
  });

  setupPrimary();

  server.listen(PORT, () => {
    logger.info(`Master cluster process ${process.pid} listening on port ${PORT}`);
  });

  const numCPUs = Math.min(os.cpus().length, 4);
  logger.info(`Forking ${numCPUs} worker processes (Cluster Mode)...`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    logger.error(`Worker process ${worker.process.pid} exited with code ${code} (${signal}). Forking replacement...`);
    cluster.fork();
  });
} else if (isClusterMode) {
  logger.info(`Worker process ${process.pid} started`);
  const { io } = require("./server");
  const { setupWorker } = require("@socket.io/sticky");
  setupWorker(io);
} else {
  // Single-process mode (Default for environments without Redis like Render free tier):
  // Guarantees all connected clients (Mac, Phone, etc.) share the exact same matching queue.
  logger.info(`Starting server in single-process mode for unified queue matching (process ${process.pid})...`);
  const { server } = require("./server");
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}
