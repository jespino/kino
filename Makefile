# Kino tasks. Run `make` (or `make help`) to list them.
#
# Most targets work on one script, chosen with FILE:
#   make render FILE=examples/go-slices.kino
#   make png FILE=examples/go-slices.kino AT=3.5s
# THEME overrides the script's theme (neon, dark, light, sketch):
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
.PHONY: help install dev build preview typecheck test check sheet render render-silent png svg \
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

install: $(DEPS) ## Install npm dependencies

# ---- studio ----

dev: $(DEPS) ## Start the studio (editor, live preview, Present mode, MP4 export)
	npm run dev

build: $(DEPS) ## Build the static studio into dist/ (no narration server)
	npm run build

preview: build ## Serve the built studio from dist/
	npx vite preview web --outDir ../dist

# ---- quality ----

typecheck: $(DEPS) ## Type-check the TypeScript sources
	npm run typecheck

test: $(DEPS) ## Compile and render every example, plus DSL checks
	npm test

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

clean: ## Remove rendered output (out/) and the studio build (dist/)
	rm -rf out dist

clean-cache: ## Remove cached narration clips (they are regenerated on demand)
	rm -rf .kino-cache

distclean: clean ## Also remove node_modules and the TTS virtualenv
	rm -rf node_modules tts/.venv tts/.bootstrap
