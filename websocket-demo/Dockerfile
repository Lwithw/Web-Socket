FROM oven/bun:1.3.4

WORKDIR /app

# Install dependencies first (leverage layer caching)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Environment defaults (override in runtime)
ENV PORT=3000

EXPOSE 3000

# Run the enhanced server
CMD ["bun", "run", "server.ts"]

