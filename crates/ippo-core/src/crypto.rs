use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload, rand_core::RngCore},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, ensure, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

const MAGIC: &[u8] = b"IPPO1";
pub const SALT_BYTES: usize = 16;

pub fn random_salt() -> [u8; SALT_BYTES] {
    let mut salt = [0u8; SALT_BYTES];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Version 1 vault parameters: Argon2id, 64 MiB memory, 3 passes, 1 lane.
/// Changing these constants requires a vault-format migration.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    ensure!(salt.len() == SALT_BYTES, "Invalid vault salt");
    ensure!(password.len() <= 1024, "Passphrase is too long");
    let params = Params::new(64 * 1024, 3, 1, Some(32))
        .map_err(|_| anyhow!("Invalid key derivation parameters"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon.hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| anyhow!("Key derivation failed"))?;
    Ok(key)
}

/// A fresh random nonce for every encryption; AAD binds bytes to a book/resource.
pub fn seal(key: &[u8; 32], plain: &[u8], context: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| anyhow!("Invalid key"))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let encrypted = cipher.encrypt(&nonce, Payload { msg: plain, aad: context })
        .map_err(|_| anyhow!("Encryption failed"))?;
    let mut out = Vec::with_capacity(MAGIC.len() + nonce.len() + encrypted.len());
    out.extend_from_slice(MAGIC); out.extend_from_slice(&nonce); out.extend(encrypted);
    Ok(out)
}

pub fn open(key: &[u8; 32], bytes: &[u8], context: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    ensure!(bytes.len() >= MAGIC.len() + 12 + 16 && bytes.starts_with(MAGIC), "Invalid encrypted data");
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| anyhow!("Invalid key"))?;
    let nonce = Nonce::from_slice(&bytes[MAGIC.len()..MAGIC.len() + 12]);
    let plain = cipher.decrypt(nonce, Payload { msg: &bytes[MAGIC.len() + 12..], aad: context })
        .map_err(|_| anyhow!("Authentication failed: incorrect key or damaged data"))?;
    Ok(Zeroizing::new(plain))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn round_trip_and_nonce_uniqueness() {
        let key = [7u8; 32];
        let a = seal(&key, b"comic page", b"book/page-1").unwrap();
        let b = seal(&key, b"comic page", b"book/page-1").unwrap();
        assert_ne!(a, b);
        assert_eq!(open(&key, &a, b"book/page-1").unwrap().as_slice(), b"comic page");
    }
    #[test] fn rejects_tampering_and_resource_swaps() {
        let key = [7u8; 32];
        let mut a = seal(&key, b"comic page", b"book/page-1").unwrap();
        assert!(open(&key, &a, b"book/page-2").is_err());
        let n = a.len(); a[n - 1] ^= 1;
        assert!(open(&key, &a, b"book/page-1").is_err());
        assert!(open(&[8u8; 32], &a, b"book/page-1").is_err());
    }
    #[test] fn rejects_truncated_ciphertext() {
        assert!(open(&[0; 32], b"IPPO1", b"").is_err());
    }
}
