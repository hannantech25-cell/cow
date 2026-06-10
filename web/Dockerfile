FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

# API_URL is consumed by next.config.js rewrites at build time
ARG API_URL=http://api:3000
ENV API_URL=${API_URL}

COPY . .
RUN npm run build

# ── Production image ──────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# next start is not needed — standalone bundles its own server
COPY --from=builder /app/public           ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
