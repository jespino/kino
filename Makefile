# Kino tasks. Run `make` (or `make help`) to list them.
#
# Most targets work on one script, chosen with FILE:
#   make render FILE=examples/go-slices.kino
#   make png FILE=examples/go-slices.kino AT=3.5s
# THEME overrides the script's theme (neon, dark, light, sketch, comic):
#   make render THEME=sketch
# Extra CLI flags go in ARGS:
#   make render ARGS="--fps 60 --jobs 4"

FILE  ?= examples/columnar-compression.kino
NAME  := $(basename $(notdir $(FILE)))
OUT   ?= out/$(NAME).mp4
AT    ?= 0s
ARGS  ?=
THEME ?=
KINO_ARGS = $(if $(THEME),--theme $(THEME)) $(ARGS)

EXAMPLES := $(wildcard examples/*.kino)
DEPS     := node_modules/.package-lock.json

.DEFAULT_GOAL := help
.PHONY: help deps run install uninstall dev build serve app app-dev app-package typecheck test check sheet render render-silent pdf png svg \
        render-all tts-setup tts clean clean-cache distclean

help: ## Show this help
	@echo "Usage: make <target> [FILE=path.kino] [OUT=out/x.mp4] [AT=2.5s] [THEME=sketch] [ARGS=...]"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{ printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }'
	@echo
	@echo "FILE defaults to $(FILE)"

$(DEPS): package.json package-lock.json
	npm install
	@touch $@

deps: $(DEPS) ## Install npm dependencies

run: ## Build Kino Studio and start it from the repo (PROJECT=folder or script opens one)
	scripts/studio.sh build
	./bin/kino $(PROJECT)

install: ## Build Kino Studio and install it for your user (menu entry + `kino` command)
	scripts/studio.sh install

uninstall: ## Remove what `make install` installed
	scripts/studio.sh uninstall

# ---- studio ----
# The studio is a desktop app (Wails 3): preview, timeline and an agent terminal
# around a project folder (a .kino script plus its assets). PROJECT opens one.

PROJECT  ?=
GO_TAGS  ?= gtk3
DIST_STUB = @mkdir -p frontend/dist && [ -n "$$(ls frontend/dist)" ] || echo '<!doctype html>' > frontend/dist/index.html

app: $(DEPS) ## Build the desktop app into bin/kino (run: bin/kino [project])
	wails3 task build

app-dev: $(DEPS) ## Run the desktop app with hot reload
	wails3 task dev

app-package: $(DEPS) ## Package the desktop app for this OS
	wails3 task package

dev: $(DEPS) ## The studio in a browser: kino serve (Go backend) + Vite with hot reload
	$(DIST_STUB)
	@trap 'kill 0' EXIT; go run -tags $(GO_TAGS) . serve $(PROJECT) & npm run dev

build: $(DEPS) ## Build the studio UI into frontend/dist/
	npm run build

serve: build ## Serve the built studio at http://127.0.0.1:34116 (kino serve)
	go run -tags $(GO_TAGS) . serve $(PROJECT)

# ---- quality ----

typecheck: $(DEPS) ## Type-check the TypeScript sources
	npm run typecheck

test: $(DEPS) ## Compile and render every example, DSL checks, and the Go tests
	npm test
	$(DIST_STUB)
	go test -tags $(GO_TAGS) ./...

check: $(DEPS) ## Validate FILE: errors with line numbers, step timeline, narration status
	npm run check -- $(FILE) $(KINO_ARGS)

sheet: $(DEPS) ## Contact sheet of FILE (end of every step) into out/NAME-sheet.png
	@mkdir -p out
	npm run check -- $(FILE) --sheet out/$(NAME)-sheet.png $(KINO_ARGS)

# ---- rendering ----

render: $(DEPS) ## Render FILE to OUT (.mp4/.webm/.gif) with narration if the TTS server runs
	@mkdir -p $(dir $(OUT))
	npm run render -- $(FILE) -o $(OUT) $(KINO_ARGS)

render-silent: $(DEPS) ## Render FILE to OUT without narration
	@mkdir -p $(dir $(OUT))
	npm run render -- $(FILE) -o $(OUT) --no-audio $(KINO_ARGS)

pdf: $(DEPS) ## Slides of FILE as out/NAME.pdf (a page per step and sub-step)
	@mkdir -p out
	npm run render -- $(FILE) -o out/$(NAME).pdf $(KINO_ARGS)

png: $(DEPS) ## Render one frame of FILE at time AT into out/NAME-AT.png
	@mkdir -p out
	npm run render -- $(FILE) --png out/$(NAME)-$(AT).png --at $(AT) $(KINO_ARGS)

svg: $(DEPS) ## Render one frame of FILE at time AT into out/NAME-AT.svg
	@mkdir -p out
	npm run render -- $(FILE) --svg out/$(NAME)-$(AT).svg --at $(AT) $(KINO_ARGS)

render-all: $(DEPS) ## Render every example to out/<name>.mp4 (without narration)
	@mkdir -p out
	@for f in $(EXAMPLES); do \
		n=$$(basename $$f .kino); \
		echo "==> $$n"; \
		npm run --silent render -- $$f -o out/$$n.mp4 --no-audio $(KINO_ARGS) || exit 1; \
	done

# ---- narration ----

tts-setup: ## One-time setup of the TTS server (tts/.venv, torch, Kitten TTS 2)
	npm run tts:setup

tts: ## Start the TTS server on http://127.0.0.1:8808
	npm run tts

# ---- cleanup ----

clean: ## Remove rendered output (out/), the studio build and the app binary (bin/)
	rm -rf out dist frontend/dist bin .task

clean-cache: ## Remove cached narration clips (they are regenerated on demand)
	rm -rf .kino-cache

distclean: clean ## Also remove node_modules and the TTS virtualenv
	rm -rf node_modules tts/.venv tts/.bootstrap
