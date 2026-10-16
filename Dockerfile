FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates openssl curl \
 && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && chmod +x /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*
# yt-dlp needs a JavaScript runtime for YouTube; it finds deno automatically.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
ENV NODE_ENV=production
# db push keeps the schema in sync without a migrations folder; switch to `prisma migrate deploy` once you add migrations.
CMD ["sh", "-c", "yt-dlp -U >/dev/null 2>&1; npx prisma db push --skip-generate && node dist/main.js"]
