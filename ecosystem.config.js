// pm2 process definitions for the http://<IP>:<PORT> deployment (`pm2 start ecosystem.config.js`).
// Reads the root .env for the deployment-specific bits (ports) — everything else (Mongo URI, JWT
// secrets, Google service account credentials, ...) stays in each app's own .env, loaded by that
// app itself at startup (apps/backend/src/index.ts's `import "dotenv/config"`), same as local dev.
// pm2's injected PORT below takes priority over anything set in apps/backend/.env, since dotenv
// never overwrites an already-set environment variable.
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

module.exports = {
  apps: [
    {
      name: "campfire-backend",
      cwd: path.join(__dirname, "apps/backend"),
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: process.env.BACKEND_PORT || 50001,
      },
    },
    {
      name: "campfire-frontend",
      cwd: path.join(__dirname, "apps/frontend"),
      script: "serve.mjs",
      env: {
        NODE_ENV: "production",
        PORT: process.env.FRONTEND_PORT || 50000,
      },
    },
  ],
};
