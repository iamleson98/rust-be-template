# datxevui cron container — Cloudflare Container image
#
# Requirements for Cloudflare Containers:
#  - Node.js runtime image
#  - EXPOSE the port the Durable-Object wrapper health-checks
#  - The Worker's DO wrapper polls http://container:$PORT/health
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src/ ./src/

# Cloudflare Containers inject PORT (default 8080).
ENV PORT=8080
EXPOSE 8080

# Sleep + re-exec keeps the entrypoint PID 1 (required by the platform).
CMD ["sh", "-c", "sleep 1 && exec node src/index.js"]
