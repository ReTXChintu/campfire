// pm2 process definitions for the https://<IP>:<PORT> deployment (`pm2 start ecosystem.config.js`).
// Reads the root .env for the deployment-specific bits (ports, TLS cert paths) — everything else
// (Mongo URI, JWT secrets, Google OAuth credentials, ...) stays in each app's own .env, loaded by
// that app itself at startup (apps/backend/src/index.ts's `import "dotenv/config"`), same as local
// dev. pm2's injected PORT/SSL_CERT_PATH/SSL_KEY_PATH below take priority over anything set in
// apps/backend/.env, since dotenv never overwrites an already-set environment variable.
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

function resolveFromRoot(relativeOrAbsolute, fallback) {
  return path.resolve(__dirname, relativeOrAbsolute || fallback);
}

const sslCertPath = resolveFromRoot(process.env.SSL_CERT_PATH, "./certs/cert.pem");
const sslKeyPath = resolveFromRoot(process.env.SSL_KEY_PATH, "./certs/key.pem");

module.exports = {
  apps: [
    {
      name: "campfire-backend",
      cwd: path.join(__dirname, "apps/backend"),
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: process.env.BACKEND_PORT || 50001,
        SSL_CERT_PATH: sslCertPath,
        SSL_KEY_PATH: sslKeyPath,
      },
    },
    {
      name: "campfire-frontend",
      cwd: path.join(__dirname, "apps/frontend"),
      script: "serve.mjs",
      env: {
        NODE_ENV: "production",
        PORT: process.env.FRONTEND_PORT || 50000,
        SSL_CERT_PATH: sslCertPath,
        SSL_KEY_PATH: sslKeyPath,
      },
    },
  ],
};
