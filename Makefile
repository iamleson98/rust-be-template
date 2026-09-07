# SeaORM Migration & Entity Generation Commands
# Run all commands from the backend/ directory

# Database URL is read from environment or defaults to app.db
DATABASE_URL ?= sqlite:app.db?mode=rwc
ENTITY_DB_URL ?= sqlite:app.db

# Detect OS and set platform-specific commands and executable extensions
ifeq ($(OS),Windows_NT)
    EXECUTABLE_EXT := .exe
    PATH_SEP := \\
    RM_CMD := powershell -Command "if (Test-Path target) { Remove-Item -Recurse -Force target }"
    CHECK_SEA_ORM := powershell -Command "if (-not (cargo install --list | Select-String -Pattern 'sea-orm-cli v2\.0\.0')) { echo 'sea-orm-cli v2.0.0 is missing or incorrect version. Installing...'; cargo install sea-orm-cli --version 2.0.0 --force } else { echo 'sea-orm-cli v2.0.0 is ready.' }"
else
    EXECUTABLE_EXT :=
    PATH_SEP := /
    RM_CMD := cargo clean
    CHECK_SEA_ORM := @cargo install --list | grep -q "sea-orm-cli v2.0.0" || ( \
		echo "sea-orm-cli v2.0.0 is missing or incorrect version. Installing..." && \
		cargo install sea-orm-cli --version 2.0.0 --force \
	)
endif

DEV_BINARY := target$(PATH_SEP)debug$(PATH_SEP)pdf-layout-backend$(EXECUTABLE_EXT)
RELEASE_BINARY := target$(PATH_SEP)release$(PATH_SEP)pdf-layout-backend$(EXECUTABLE_EXT)
PROD_BINARY := target$(PATH_SEP)production$(PATH_SEP)pdf-layout-backend$(EXECUTABLE_EXT)

## --- Tooling Installation ---

# Smart guard: Check if sea-orm-cli v2.0.0 exists across Windows/macOS/Linux
install-sea-orm-cli:
	@$(CHECK_SEA_ORM)

## --- Migrations ---

# Create a new migration file
# Usage: make migrate-generate NAME=create_users_table
migrate-generate: install-sea-orm-cli
	sea-orm-cli migrate generate $(NAME) -d migrator

# Apply all pending migrations
migrate-up: install-sea-orm-cli
	sea-orm-cli migrate up -d migrator --database-url "$(DATABASE_URL)"

# Rollback the last migration
migrate-down: install-sea-orm-cli
	sea-orm-cli migrate down -d migrator

# Check migration status
migrate-status: install-sea-orm-cli
	sea-orm-cli migrate status -d migrator

# Reset database (rollback all, then apply all)
migrate-reset: install-sea-orm-cli
	sea-orm-cli migrate fresh -d migrator

## --- Entity Generation ---

# Generate entities from the database into src/entity
# NOTE: This overwrites mod.rs — if you have extra entity files not yet in the DB,
#       re-add their `pub mod` lines to mod.rs after running this.
generate-entities: install-sea-orm-cli
	sea-orm-cli generate entity --database-url "$(ENTITY_DB_URL)" -o src/entity --with-serde both --with-prelude none

## --- Build & Execution Commands ---

# Fast development build (optimized for compile speed)
build-dev:
	cargo build

# Production release build with maximum optimization
build-release:
	cargo build --release

# Balanced production build
build-production:
	cargo build --profile production

# Fast incremental release build
build-release-incremental:
	cargo build --release

# Run with optimization (debug symbols)
run-dev: build-dev
	.$(PATH_SEP)$(DEV_BINARY)

# Run optimized release binary
run-release: build-release
	.$(PATH_SEP)$(RELEASE_BINARY)

# Run the balanced production build
run-production: build-production
	.$(PATH_SEP)$(PROD_BINARY)

# Check if build will succeed without full compilation
check:
	cargo check --release

# Clean build artifacts safely on all platforms
clean:
	$(RM_CMD)

# Show binary size / build metadata
size-release: build-release
	@cargo metadata --format-version 1 >/dev/null

# Benchmark build time (cross-platform HTML timing report via Cargo)
time-build:
	cargo build --release --timings

.PHONY: migrate-generate migrate-up migrate-down migrate-status migrate-reset \
        generate-entities install-sea-orm-cli build-dev build-release \
        build-production build-release-incremental run-dev run-release \
        run-production check clean size-release time-build