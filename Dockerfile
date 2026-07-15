FROM node:22-bookworm-slim AS deps

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY server ./server

RUN pnpm typecheck
RUN pnpm build
RUN node --check server/index.js \
  && node --check server/openrouter.js \
  && node --check server/mock-generator.js \
  && node --check server/placement.js \
  && node --check server/overlay.js \
  && node --check server/pool-catalog.js \
  && node --check server/prompt.js \
  && node --check server/validator.js \
  && node --check server/mask.js \
  && node --check server/image-metadata.js

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5177
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY server ./server

RUN mkdir -p data/uploads data/generated \
  && chown -R node:node /app/data

USER node
EXPOSE 5177

CMD ["node", "server/index.js"]
