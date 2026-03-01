FROM node:22-alpine AS base

WORKDIR /app

RUN apk add --no-cache git

COPY package.json ./
COPY tsconfig.base.json ./
COPY vitest.config.ts ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json

RUN npm install

COPY . .

RUN npm run db:generate -w @center/db

ENV NODE_ENV=production

EXPOSE 3000
