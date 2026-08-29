# SeaORM Migration & Entity Generation Commands
# Run all commands from the backend/ directory

# Database URL is read from .env file by default

# Force sea-orm-cli version 2.0
SEA_ORM_CLI = sea-orm-cli
SEA_ORM_VERSION = 2.0.0

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
	$(SEA_ORM_CLI) migrate down -d migrator

# Check migration status
migrate-status: install-sea-orm-cli
	$(SEA_ORM_CLI) migrate status -d migrator

# Reset database (rollback all, then apply all)
migrate-reset: install-sea-orm-cli
	$(SEA_ORM_CLI) migrate fresh -d migrator

## --- Entity Generation ---

# Smart guard: Check if sea-orm-cli exists AND matches the specific version. 
# If not, install it.
install-sea-orm-cli:
	@if ! command -v $(SEA_ORM_CLI) > /dev/null || ! $(SEA_ORM_CLI) --version | grep -q "$(SEA_ORM_VERSION)"; then \
		echo "sea-orm-cli v$(SEA_ORM_VERSION) is missing or incorrect version. Installing..."; \
		cargo install sea-orm-cli --version $(SEA_ORM_VERSION) --force; \
	else \
		echo "sea-orm-cli v$(SEA_ORM_VERSION) is ready."; \
	fi

# Generate entities from the database into src/entity
# NOTE: This overwrites mod.rs — if you have extra entity files not yet in the DB,
#       re-add their `pub mod` lines to mod.rs after running this.
generate-entities: install-sea-orm-cli
	$(SEA_ORM_CLI) generate entity --database-url sqlite:app.db -o src/entity --with-serde both --with-prelude none

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
	./target/debug/pdf-layout-backend

# Run optimized release binary
run-release: build-release
	./target/release/pdf-layout-backend

# Run the balanced production build (faster to compile, near-identical runtime)
run-production: build-production
	./target/production/pdf-layout-backend

# Check if build will succeed without full compilation
check:
	cargo check --release

# Clean build artifacts
clean:
	cargo clean

# Show binary size
size-release: build-release
	ls -lh target/release/pdf-layout-backend

# Benchmark build time (release)
time-build:
	@echo "Timing release build..."
	@time cargo build --release

.PHONY: build-dev build-release build-production build-release-incremental run-dev run-release check clean size-release time-build