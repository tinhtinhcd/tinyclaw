FROM node:20-bookworm-slim

WORKDIR /app

# Install backend dependencies with lockfile for deterministic builds.
COPY package.json package-lock.json ./
RUN npm ci

# Install TinyOffice dependencies (no lockfile in current repo).
COPY tinyoffice/package.json ./tinyoffice/package.json
RUN cd tinyoffice && npm install

# Copy source code after dependencies for better Docker layer caching.
COPY . .

# Build backend TypeScript output consumed by `npm run queue`.
RUN npm run build:main

COPY docker-start.sh /usr/local/bin/docker-start.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-start.sh \
    && chmod +x /usr/local/bin/docker-start.sh

EXPOSE 3777 3000

CMD ["/usr/local/bin/docker-start.sh"]
