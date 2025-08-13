# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for KC-MVP-server (NestJS)

# 1) Build stage: install deps (including dev) and compile TS → JS
FROM node:20 as builder
WORKDIR /app

ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci --include=dev

COPY . .

# Clean any build cache and build the application
RUN rm -f *.tsbuildinfo

# Build using TypeScript directly (more reliable than nest build)
RUN npx tsc -p tsconfig.build.json

# Verify build succeeded
RUN test -f ./dist/main.js

# 2) Production deps stage: install only production deps
FROM node:20 as deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Rebuild native deps for runtime image architecture (argon2)
RUN npm rebuild argon2 --build-from-source || true 

# 3) Runtime stage: run compiled app
FROM node:20-slim as runner
WORKDIR /app

ENV NODE_ENV=production
LABEL Name="kc-mvp-server" Version="1.1.0"

# Copy production node_modules from deps stage and compiled dist from builder stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# Copy SQL schema files that aren't included in TypeScript build
COPY --from=builder /app/src/database/schema.sql ./dist/database/

# Final assertion that dist exists
RUN test -f ./dist/main.js

# Expose is optional for Railway, but helps locally
EXPOSE 3001

CMD ["node", "dist/main.js"]

