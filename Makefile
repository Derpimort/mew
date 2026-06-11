# MEW — one entry point for the dev loop, local or dockerized.
#
# Local (needs node 22 + pnpm):   make dev / test / build / shoot
# Docker (needs docker compose):  make up / debug / logs / refresh
#
# On an aisquare-ec2-dev box the `app` helper drives the same compose files
# with its built-ins (app refresh / debug / logs …) — this Makefile is not
# required there. To let `app` drive these targets instead, set
# makefile_mode = "repo" and map the divergent name:
#   helper_commands = { build = "image" }   # app build → make image
.DEFAULT_GOAL := help

COMPOSE_FILE       ?= docker-compose.yml
DEBUG_COMPOSE_FILE ?= docker-compose.debug.yml
COMPOSE             = docker compose -f $(COMPOSE_FILE)
COMPOSE_DEBUG       = docker compose -f $(COMPOSE_FILE) -f $(DEBUG_COMPOSE_FILE)
PNPM                = pnpm -C app
SVC                ?=

.PHONY: help install dev test typecheck check build preview shoot \
        image up down refresh debug restart logs ps status shell check-docker clean

help: ## show this help
	@awk 'BEGIN {FS = ":.*## "; printf "\nMEW · make targets\n\n"} \
	  /^[a-zA-Z_ -]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2} \
	  /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)}' $(MAKEFILE_LIST)
	@echo

##@ Local (node 22 + pnpm)
install: ## install dependencies
	$(PNPM) install

dev: ## vite dev server with HMR (http://localhost:5173)
	$(PNPM) dev

test: ## run the domain + adapter test suite
	$(PNPM) test

typecheck: ## strict tsc over the whole app
	$(PNPM) typecheck

check: test typecheck ## tests + types — the pre-commit gate

build: check ## production bundle → app/dist
	$(PNPM) build

preview: ## serve the production bundle (http://localhost:5199)
	$(PNPM) exec vite preview --port 5199

shoot: ## Playwright screenshots of the built app → app/shots (needs preview running)
	$(PNPM) shoot

##@ Docker / compose (same files the `app` helper uses on the box)
image: ## build the production image (tests + typecheck run inside the build)
	$(COMPOSE) build

up: ## start the stack detached (MEW_PORT, default 3000)
	$(COMPOSE) up -d

down: ## stop the stack
	$(COMPOSE) down

refresh: ## git pull + rebuild + restart — the everyday deploy
	git pull --ff-only
	$(COMPOSE) up -d --build

debug: ## hot-reload build in the foreground (MEW_DEV_PORT, default 5173)
	$(COMPOSE_DEBUG) up --build

restart: ## restart all, or one service: make restart SVC=mew
	$(COMPOSE) restart $(SVC)

logs: ## tail logs (all, or one: make logs SVC=mew)
	$(COMPOSE) logs -f --tail=200 $(SVC)

ps status: ## show running services
	$(COMPOSE) ps

shell: ## shell into a service (default mew)
	$(COMPOSE) exec $(or $(SVC),mew) sh

check-docker: ## run tests + typecheck inside the dev image (no local node needed)
	$(COMPOSE_DEBUG) run --rm --build mew sh -c "pnpm test && pnpm typecheck"

##@ Housekeeping
clean: ## remove build artifacts and screenshots
	rm -rf app/dist app/shots app/node_modules/.tmp
