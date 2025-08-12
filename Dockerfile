# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for KC-MVP-server (NestJS)

# 1) Build stage: install deps (including dev) and compile TS → JS
FROM node:20
WORKDIR /app

ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# 2) Runtime stage: install only production deps and run compiled app
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production
LABEL Name="kc-mvp-server" Version="1.1.0"

# Install only production dependencies for smaller image
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled dist from the first stage (index 0)
COPY --from=0 /app/dist ./dist

# Expose is optional for Railway, but helps locally
EXPOSE 3001

CMD ["node", "dist/main.js"]

