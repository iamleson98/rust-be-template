//! `backend key generate|hash` — generate secrets and hashes.

use crate::auth::password::PasswordHasher;

use crate::cli::parser::KeyAction;

pub fn run(action: KeyAction) -> anyhow::Result<()> {
    match action {
        KeyAction::Generate { bytes } => {
            use rand::RngCore;
            if bytes < 16 {
                anyhow::bail!("refusing to generate a secret shorter than 16 bytes");
            }
            let mut buf = vec![0u8; bytes as usize];
            rand::thread_rng().fill_bytes(&mut buf);
            let hex = hex::encode(&buf);
            println!("{}", hex);
            println!();
            eprintln!("→ {bytes}-byte secret (hex, {hex_len} chars)", bytes = bytes, hex_len = hex.len());
            eprintln!("→ add to .env as:  JWT_SECRET={hex}");
        }
        KeyAction::Hash { password } => {
            let hasher = PasswordHasher::new();
            let hash = hasher
                .hash(&password)
                .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))?;
            println!("{}", hash);
        }
    }
    Ok(())
}
