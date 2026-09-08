# SeaORM Migration & Entity Generation Commands
# Run all commands from the project root.

# Database URL is read from .env file by default

# Force sea-orm-cli version 2.0
SEA_ORM_CLI := sea-orm-cli
SEA_ORM_VERSION := 2.0.0

# GNU Make sets OS to Windows_NT on Windows. Keep platform-specific shell
# syntax in one place so the targets themselves remain portable.
ifeq ($(OS),Windows_NT)
EXE_EXT := .exe
else
EXE_EXT :=
endif

DEBUG_BINARY := target/debug/backend$(EXE_EXT)
RELEASE_BINARY := target/release/backend$(EXE_EXT)
PRODUCTION_BINARY := target/production/backend$(EXE_EXT)

## --- Migrations ---

# Create a new migration file
# Usage: make migrate-generate NAME=create_users_table
migrate-generate: install-sea-orm-cli
	$(SEA_ORM_CLI) migrate generate $(NAME) -d migrator

# Apply all pending migrations
migrate-up: install-sea-orm-cli
	$(SEA_ORM_CLI) migrate up -d migrator --database-url sqlite:app.db?mode=rwc

# Rollback the last migration
migrate-down: install-sea-orm-cli
	$(SEA_ORM_CLI) migrate down -d migrator --database-url sqlite:app.db?mode=rwc

# Check migration status
migrate-status: install-sea-orm-cli
	$(SEA_ORM_CLI) migrate status -d migrator --database-url sqlite:app.db

# Reset database (drop all, then re-apply from scratch).
# Direct migrator invocation: sea-orm-cli's `migrate fresh` forwards no
# flags, so the migrator's destructive-fresh confirmation could never be
# answered non-interactively. `--yes` makes the target scriptable.
migrate-reset:
	cargo run -p migrator -- fresh --yes

## --- Entity Generation ---

# Smart guard: Check if sea-orm-cli exists and matches the specific version.
# If not, install it. The check uses the native shell on each platform.
ifeq ($(OS),Windows_NT)
install-sea-orm-cli:
	@where $(SEA_ORM_CLI) >nul 2>&1 && $(SEA_ORM_CLI) --version | findstr /C:"$(SEA_ORM_VERSION)" >nul 2>&1 || (echo sea-orm-cli v$(SEA_ORM_VERSION) is missing or incorrect version. Installing... && cargo install sea-orm-cli --version $(SEA_ORM_VERSION) --locked --force)
else
install-sea-orm-cli:
	@if ! command -v $(SEA_ORM_CLI) > /dev/null || ! $(SEA_ORM_CLI) --version | grep -q "$(SEA_ORM_VERSION)"; then \
		echo "sea-orm-cli v$(SEA_ORM_VERSION) is missing or incorrect version. Installing..."; \
		cargo install sea-orm-cli --version $(SEA_ORM_VERSION) --locked --force; \
	else \
		echo "sea-orm-cli v$(SEA_ORM_VERSION) is ready."; \
	fi
endif

# Generate entities from the database into src/entity
# NOTE: This overwrites mod.rs — if you have extra entity files not yet in the DB,
#       re-add their `pub mod` lines to mod.rs after running this.
generate-entities: install-sea-orm-cli
	$(SEA_ORM_CLI) generate entity --database-url sqlite:app.db?mode=rwc -o src/entity --with-serde both --with-prelude none

.PHONY: migrate-generate migrate-up migrate-down migrate-status migrate-reset generate-entities install-sea-orm-cli

## --- M2 Pro Build Commands ---

# Fast development build (optimized for compile speed)
build-dev:
	cargo build

# Production release build with maximum optimization
# WARNING: First build may take 15-30 minutes due to LTO
build-release:
	cargo build --release

# Balanced production build (faster than full LTO)
build-production:
	cargo build --profile production

# Fast incremental release build (second+ times)
build-release-incremental:
	cargo build --release

# Run with optimization (debug symbols)
run-dev: build-dev
	cargo run

# Run optimized release binary
run-release: build-release
	cargo run --release

# Run the balanced production build (faster to compile, near-identical runtime)
run-production: build-production
	cargo run --profile production

# Check if build will succeed without full compilation
check:
	cargo check --release

# Clean build artifacts
clean:
	cargo clean

# Show binary size
ifeq ($(OS),Windows_NT)
SIZE_RELEASE_COMMAND := powershell -NoProfile -Command "(Get-Item '$(RELEASE_BINARY)').Length"
else
SIZE_RELEASE_COMMAND := wc -c < "$(RELEASE_BINARY)"
endif

size-release: build-release
	@$(SIZE_RELEASE_COMMAND)

# Benchmark build time (release)
ifeq ($(OS),Windows_NT)
TIME_BUILD_COMMAND := powershell -NoProfile -Command "$$elapsed = Measure-Command { cargo build --release }; $$elapsed"
else
TIME_BUILD_COMMAND := time cargo build --release
endif

time-build:
	@echo "Timing release build..."
	@$(TIME_BUILD_COMMAND)

.PHONY: build-dev build-release build-production build-release-incremental run-dev run-release check clean size-release time-build