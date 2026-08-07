//! `backend migration new <NAME>` — scaffold a new migration file.

use anyhow::{Context, Result};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;

const TEMPLATE: &str = r#"use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // TODO: create_table / alter_table here. Example:
        // manager.create_table(
        //     Table::create()
        //         .table(Users::Table)
        //         .if_not_exists()
        //         .col(pk_uuid(Users::Id))
        //         .to_owned(),
        // ).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // TODO: reverse of `up`.
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Id,
}
"#;

const REGISTRY_HEAD: &str = r#"mod MIGRATION_MODULE;

pub use MIGRATION_MODULE::Migration as MIGRATION_NAME_PASCAL;
"#;

const REGISTRY_PUSH: &str = r#"            Box::new(MIGRATION_NAME_PASCAL::Migration),
"#;

/// Convert `snake_case` -> `PascalCase` (e.g. `add_users` -> `AddUsers`).
fn to_pascal(input: &str) -> String {
    input
        .split('_')
        .filter(|s| !s.is_empty())
        .map(|s| {
            let mut chars = s.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>()
                    + chars.as_str().to_lowercase().as_str(),
                None => String::new(),
            }
        })
        .collect()
}

/// Convert `snake_case` -> `YYYYMMDD_HHMMSS_<name>` (sea-orm's expected format).
fn migration_file_name(name: &str) -> String {
    let now = Utc::now();
    format!(
        "m{:04}{:02}{:02}_{:02}{:02}{:02}_{}",
        now.format("%Y"),
        now.format("%m"),
        now.format("%d"),
        now.format("%H"),
        now.format("%M"),
        now.format("%S"),
        name
    )
}

pub fn run(name: &str) -> Result<()> {
    // Validate input.
    if name.is_empty() {
        anyhow::bail!("migration name cannot be empty");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        anyhow::bail!("migration name must be snake_case (alphanumerics + underscore)");
    }

    let module_name = migration_file_name(name);
    let pascal_name = to_pascal(name);
    let _ = pascal_name; // kept for future use in generated code

    // Write the migration file.
    let migrations_dir = PathBuf::from("src/migration");
    let file_path = migrations_dir.join(format!("{module_name}.rs"));
    if file_path.exists() {
        anyhow::bail!("migration file already exists: {}", file_path.display());
    }
    fs::write(&file_path, TEMPLATE)
        .with_context(|| format!("writing {}", file_path.display()))?;
    println!("✓ created {}", file_path.display());

    // Update the migration registry (mod.rs).
    let mod_path = migrations_dir.join("mod.rs");
    let mod_content = fs::read_to_string(&mod_path)
        .with_context(|| format!("reading {}", mod_path.display()))?;

    // 1. Add `mod m_xxx;` near the other module declarations.
    let mod_line = format!("mod {module_name};");
    let mut new_mod = mod_content.clone();
    if !new_mod.contains(&mod_line) {
        // Insert after the last existing `mod m...;` line.
        let mut last_mod_idx = None;
        for (i, line) in new_mod.lines().enumerate() {
            if line.trim_start().starts_with("mod m") {
                last_mod_idx = Some(i);
            }
        }
        match last_mod_idx {
            Some(idx) => {
                let byte_idx = new_mod.lines().take(idx + 1).map(|l| l.len() + 1).sum();
                new_mod.insert_str(byte_idx, &format!("{mod_line}\n"));
            }
            None => {
                // No existing migrations — insert after `pub use sea_orm_migration::prelude::*;`.
                let marker = "pub use sea_orm_migration::prelude::*;";
                if let Some(pos) = new_mod.find(marker) {
                    let pos = pos + marker.len();
                    new_mod.insert_str(pos, &format!("\n{mod_line}\n"));
                } else {
                    new_mod.push_str(&format!("\n{mod_line}\n"));
                }
            }
        }
    }

    // 2. Add `Box::new(<module>::Migration)` to the migrations() vec.
    let push_line = format!("            Box::new({module_name}::Migration),");
    if !new_mod.contains(&push_line) {
        let marker = "            Box::new(m20250101_000005_seed_rbac::Migration),";
        if let Some(pos) = new_mod.find(marker) {
            let pos = pos + marker.len();
            new_mod.insert_str(pos, &format!("\n{push_line}"));
        } else {
            // Fallback — find the closing `]` of the migrations() vec.
            let marker = "        ]\n    }\n}";
            if let Some(pos) = new_mod.find(marker) {
                new_mod.insert_str(pos, &format!("{push_line}\n"));
            }
        }
    }

    fs::write(&mod_path, new_mod)
        .with_context(|| format!("writing {}", mod_path.display()))?;
    println!("✓ registered in {}", mod_path.display());

    // Suppress unused-import warnings in the generated template.
    let _ = (REGISTRY_HEAD, REGISTRY_PUSH);

    println!();
    println!("next steps:");
    println!("  1. Edit {}", file_path.display());
    println!("  2. backend migrate up");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pascal_case_works() {
        assert_eq!(to_pascal("add_users_table"), "AddUsersTable");
        assert_eq!(to_pascal("simple"), "Simple");
        assert_eq!(to_pascal("with_numbers_123"), "WithNumbers123");
    }

    #[test]
    fn migration_file_name_format() {
        let n = migration_file_name("add_users");
        assert!(n.starts_with("m"));
        assert!(n.ends_with("_add_users"));
    }
}
