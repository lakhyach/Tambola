# Tambola - production image (long-running single instance).
#
# The app needs a continuously running Node process: persistent Socket.IO
# connections, per-room auto-call schedulers, in-memory live projections, and a
# PostgreSQL advisory lock that deliberately allows only ONE instance. That is
# incompatible with serverless platforms (see server/RUNBOOK.md section 11), so
# this image is meant for a container service / VM / Container-Apps style host
# that keeps the process warm and runs exactly one replica.
#
# Build:   docker build -t tambola .
# Run:     docker run -p 4000:4000 --env-file .env tambola
# (env vars are described in DEPLOYMENT.md and .env.example; never bake secrets
#  into the image - supply them at runtime.)

# ---- Stage 1: build the React client into client/dist -----------------------
FROM node:22-alpine AS client-build
WORKDIR /build
# Lockfiles first so the dependency layer caches independently of source.
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: runtime ----------------------------------------------------------------
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
# Only production dependencies are needed to run the server (express, socket.io,
# pg, cors, dotenv). The test runner and Playwright are dev-only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Server source.
COPY server/ ./server/
# The server resolves the built client at ../client/dist relative to server/.
COPY --from=client-build /build/dist ./client/dist
# Migration SQL and the owner/backup CLIs live under server/ and scripts/; the
# server applies migrations itself on boot, scripts/ is for operator tooling.
COPY scripts/ ./scripts/
# Pinned Supabase root/intermediate CA so DATABASE_URL can use the safest TLS
# mode (?sslmode=verify-full&sslrootcert=/app/deploy/supabase-root-ca.pem). It is
# a public certificate, not a secret. Re-download from the Supabase dashboard if
# Supabase ever rotates it.
COPY deploy/supabase-root-ca.pem ./deploy/supabase-root-ca.pem
EXPOSE 4000
# Container-level liveness/readiness probe. /readyz fails closed if the DB, a
# migration, or the single-instance lease is unavailable, which is exactly the
# signal an orchestrator should act on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `npm start` runs `node --env-file-if-exists=.env server/index.js`; in a
# container the env comes from the platform, and the if-exists flag makes the
# missing .env a no-op rather than a failure.
CMD ["npm", "start"]
