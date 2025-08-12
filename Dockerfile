# Multi-stage Dockerfile for KC-MVP-server (NestJS)

# 1) Build stage: install deps (including dev) and compile TS → JS
FROM node:20-bullseye AS builder
WORKDIR /app

ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# 2) Runtime stage: install only production deps and run compiled app
FROM node:20-bullseye-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies for smaller image
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled dist from builder
COPY --from=builder /app/dist ./dist

# Expose is optional for Railway, but helps locally
EXPOSE 3001

CMD ["node", "dist/main.js"]

# Backend Dockerfile (NestJS)
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Runtime image
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=build /app/dist ./dist

EXPOSE 3001
CMD ["node", "dist/main.js"]


