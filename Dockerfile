# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
# package-lock.json instead of pnpm-lock.yaml
COPY package.json package-lock.json ./

# No pnpm installation needed - npm comes with Node

# npm ci is the production-safe equivalent of pnpm install --frozen-lockfile
# It strictly installs from package-lock.json and fails if there's a mismatch
RUN npm ci

COPY . .

RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./

# --omit=dev is npm's equivalent of pnpm install --prod
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 zentrion && \
    adduser -u 1001 -G zentrion -s /bin/sh -D zentrion

RUN chown -R zentrion:zentrion /app

USER zentrion

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/main.js"]