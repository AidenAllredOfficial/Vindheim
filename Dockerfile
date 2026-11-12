# Vindheim — single container: Node serves the built client and runs the game server.
#   docker build -t vindheim .
#   docker run -p 8787:8787 -v vindheim-data:/app/data vindheim

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data CLIENT_DIR=/app/dist/client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME /app/data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "dist/server/index.js"]
