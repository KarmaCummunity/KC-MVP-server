# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for KC-MVP-server (NestJS)

# 1) Build stage: install deps (including dev) and compile TS → JS
FROM node:20 as builder
WORKDIR /app

ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
# Ensure Nest CLI is available in builder (if postinstall skipped)
RUN npx --yes @nestjs/cli@10.3.2 build -p tsconfig.build.json || npm run build

# Prune dev dependencies to keep only production deps for runtime
# Rebuild native deps for runtime image architecture (argon2)
RUN npm rebuild argon2 --build-from-source || true 
RUN npm prune --omit=dev && npm cache clean --force

# 2) Runtime stage: install only production deps and run compiled app
FROM node:20-slim as runner
WORKDIR /app

ENV NODE_ENV=production
LABEL Name="kc-mvp-server" Version="1.1.0"

# Copy production node_modules and compiled dist from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Assert dist exists at build-time (fail early if not)
RUN test -f ./dist/main.js

# Expose is optional for Railway, but helps locally
EXPOSE 3001

CMD ["node", "dist/main.js"]

