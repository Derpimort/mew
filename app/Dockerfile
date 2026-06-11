# syntax=docker/dockerfile:1
# MEW — local-first SPA. One config-free image: the BYO Anthropic key and
# Google client ID are entered at runtime in Settings and live in the browser,
# so the same image deploys anywhere. Stages:
#   deps    — pnpm install (store cached across builds)
#   build   — tests + typecheck + vite build (skip with --build-arg SKIP_CHECKS=1)
#   dev     — hot-reload server for `app debug` / compose override
#   runtime — static files on unprivileged nginx (default target)

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG SKIP_CHECKS=0
RUN if [ "$SKIP_CHECKS" != "1" ]; then pnpm test && pnpm typecheck; fi
RUN pnpm build

FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="MEW" \
      org.opencontainers.image.description="My Entire Week — an AI companion that runs your week with you" \
      org.opencontainers.image.source="https://github.com/AISquare-Studio/mew"
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
