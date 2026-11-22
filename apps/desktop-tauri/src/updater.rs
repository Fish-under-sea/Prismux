use crate::installer_meta::detect_portable_data_dir;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const SHA256_H0: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// Minimal pure-std streaming SHA-256 hasher (FIPS 180-4, zero external crates).
pub struct Sha256 {
    state: [u32; 8],
    buf: [u8; 64],
    buf_len: usize,
    total_bytes: u64,
}

impl Sha256 {
    pub fn new() -> Self {
        Self { state: SHA256_H0, buf: [0u8; 64], buf_len: 0, total_bytes: 0 }
    }

    fn compress(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            let j = i * 4;
            w[i] = u32::from_be_bytes([block[j], block[j + 1], block[j + 2], block[j + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(SHA256_K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            h = g; g = f; f = e; e = d.wrapping_add(t1);
            d = c; c = b; b = a; a = t1.wrapping_add(t2);
        }
        for (dst, add) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *dst = dst.wrapping_add(add);
        }
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.total_bytes = self.total_bytes.saturating_add(data.len() as u64);
        if self.buf_len > 0 {
            let take = (64 - self.buf_len).min(data.len());
            self.buf[self.buf_len..self.buf_len + take].copy_from_slice(&data[..take]);
            self.buf_len += take;
            data = &data[take..];
            if self.buf_len == 64 {
                let block = self.buf;
                self.compress(&block);
                self.buf_len = 0;
            }
        }
        while data.len() >= 64 {
            let block: [u8; 64] = data[..64].try_into().expect("64-byte slice");
            self.compress(&block);
            data = &data[64..];
        }
        if !data.is_empty() {
            self.buf[..data.len()].copy_from_slice(data);
            self.buf_len = data.len();
        }
    }

    pub fn finalize_hex(mut self) -> String {
        let bit_len = self.total_bytes.wrapping_mul(8);
        self.buf[self.buf_len] = 0x80;
        self.buf_len += 1;
        if self.buf_len > 56 {
            self.buf[self.buf_len..64].fill(0);
            let block = self.buf;
            self.compress(&block);
            self.buf_len = 0;
        }
        self.buf[self.buf_len..56].fill(0);
        self.buf[56..64].copy_from_slice(&bit_len.to_be_bytes());
        let final_block = self.buf;
        self.compress(&final_block);
        let mut out = String::with_capacity(64);
        for word in self.state {
            for byte in word.to_be_bytes() {
                out.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
                out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
            }
        }
        out
    }
}

pub fn sha256_bytes_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize_hex()
}

pub fn sha256_file_hex(path: &Path) -> io::Result<(String, u64)> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total_bytes = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read as u64);
        hasher.update(&buffer[..read]);
    }
    Ok((hasher.finalize_hex(), total_bytes))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterDefaultSourceMeta {
    pub id: String,
    pub label: String,
    pub api_base: String,
    pub web_base: String,
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterBootstrapInfo {
    pub app_name: String,
    pub current_version: String,
    pub portable_mode: bool,
    pub portable_data_dir: Option<String>,
    pub recommended_package_kind: String,
    pub default_route_preference: String,
    pub include_prerelease_default: bool,
    pub custom_gh_proxy_prefix_default: String,
    pub sources: Vec<UpdaterDefaultSourceMeta>,
    pub npm_registry: String,
    pub npm_mirror_registry: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sha256VerificationResult {
    pub verified: bool,
    pub file_path: String,
    pub expected_sha256: String,
    pub actual_sha256: String,
    pub bytes: u64,
}

pub fn build_updater_bootstrap(executable_dir: Option<&Path>) -> UpdaterBootstrapInfo {
    let detected_exe_dir = executable_dir.map(Path::to_path_buf).or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(PathBuf::from))
    });

    let portable_dir = detected_exe_dir
        .as_deref()
        .and_then(detect_portable_data_dir);
    let portable_mode = portable_dir.is_some();

    UpdaterBootstrapInfo {
        app_name: "Prismux".to_string(),
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        portable_mode,
        portable_data_dir: portable_dir.map(|p| p.to_string_lossy().into_owned()),
        recommended_package_kind: if portable_mode {
            "portable-zip".to_string()
        } else {
            "setup-exe".to_string()
        },
        default_route_preference: "auto".to_string(),
        include_prerelease_default: true,
        custom_gh_proxy_prefix_default: String::new(),
        sources: vec![
            UpdaterDefaultSourceMeta {
                id: "github".to_string(),
                label: "GitHub Releases".to_string(),
                api_base: "https://api.github.com".to_string(),
                web_base: "https://github.com".to_string(),
                owner: "Fish-under-sea".to_string(),
                repo: "Prismux".to_string(),
            },
            UpdaterDefaultSourceMeta {
                id: "gitee".to_string(),
                label: "Gitee Releases".to_string(),
                api_base: "https://gitee.com/api/v5".to_string(),
                web_base: "https://gitee.com".to_string(),
                owner: "Fish-under-sea".to_string(),
                repo: "Prismux".to_string(),
            },
        ],
        npm_registry: "https://registry.npmjs.org".to_string(),
        npm_mirror_registry: "https://registry.npmmirror.com".to_string(),
    }
}

pub fn verify_installer_sha256_file(
    file_path: &Path,
    expected_sha256: &str,
) -> Result<Sha256VerificationResult, String> {
    let normalized_expected = expected_sha256.trim().to_ascii_lowercase();
    if normalized_expected.len() != 64 || !normalized_expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("预期 SHA-256 必须为 64 位十六进制摘要".to_string());
    }

    let (actual_sha256, bytes) = sha256_file_hex(file_path)
        .map_err(|err| format!("读取安装包并计算 SHA-256 失败: {err}"))?;

    Ok(Sha256VerificationResult {
        verified: actual_sha256 == normalized_expected,
        file_path: file_path.to_string_lossy().into_owned(),
        expected_sha256: normalized_expected,
        actual_sha256,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "prismux-tauri-updater-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn sha256_matches_standard_nist_vectors() {
        assert_eq!(
            sha256_bytes_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_bytes_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_bytes_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn updater_bootstrap_detects_portable_mode_and_dual_sources() {
        let root = make_temp_dir("bootstrap");
        let setup_info = build_updater_bootstrap(Some(&root));
        assert_eq!(setup_info.app_name, "Prismux");
        assert_eq!(setup_info.current_version, env!("CARGO_PKG_VERSION"));
        assert!(!setup_info.portable_mode);
        assert_eq!(setup_info.recommended_package_kind, "setup-exe");
        assert_eq!(setup_info.default_route_preference, "auto");
        assert!(setup_info.include_prerelease_default);
        assert!(setup_info.custom_gh_proxy_prefix_default.is_empty());
        assert_eq!(setup_info.sources.len(), 2);
        assert_eq!(setup_info.sources[0].id, "github");
        assert_eq!(setup_info.sources[1].id, "gitee");

        let data_dir = root.join("data");
        fs::create_dir_all(&data_dir).unwrap();
        let portable_info = build_updater_bootstrap(Some(&root));
        assert!(portable_info.portable_mode);
        assert_eq!(portable_info.recommended_package_kind, "portable-zip");
        assert_eq!(
            portable_info.portable_data_dir.as_deref(),
            Some(data_dir.to_string_lossy().as_ref())
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn verify_installer_sha256_validates_match_and_detects_tamper() {
        let root = make_temp_dir("verify");
        let file_path = root.join("Prismux-Setup-test.exe");
        let payload = b"prismux-installer-binary-stream-check";
        fs::write(&file_path, payload).unwrap();

        let expected = sha256_bytes_hex(payload);
        let ok_res = verify_installer_sha256_file(&file_path, &expected.to_ascii_uppercase())
            .expect("valid verification result");
        assert!(ok_res.verified);
        assert_eq!(ok_res.actual_sha256, expected);
        assert_eq!(ok_res.bytes, payload.len() as u64);

        let mut tampered = payload.to_vec();
        tampered[4] ^= 0x01;
        fs::write(&file_path, &tampered).unwrap();
        let fail_res = verify_installer_sha256_file(&file_path, &expected)
            .expect("mismatch result still returns structured report");
        assert!(!fail_res.verified);
        assert_ne!(fail_res.actual_sha256, expected);

        assert!(verify_installer_sha256_file(&file_path, "not-sha256").is_err());
        assert!(verify_installer_sha256_file(&root.join("missing.exe"), &expected).is_err());

        let _ = fs::remove_dir_all(&root);
    }
}
