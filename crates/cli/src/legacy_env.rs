//! Accept the pre-rename `REMOTE_CODEX_*` environment.
//!
//! Windows Device Managers, installed service units, Incus guests and relay
//! hosts keep setting the old names, so the process adopts them as
//! `POCKYMOE_*` before anything reads its environment and drops the old
//! keys, leaving one name per setting for every filter and child process. A
//! value already set under the new name wins. DSH credential references stay:
//! they name variables inside DSH's own configuration.

use std::ffi::OsString;

const LEGACY: &str = "REMOTE_CODEX_";
const CURRENT: &str = "POCKYMOE_";

/// Must run before any other thread starts.
pub fn adopt() {
    let legacy: Vec<(String, OsString)> = std::env::vars_os()
        .filter_map(|(key, value)| Some((key.into_string().ok()?, value)))
        .filter(|(key, _)| key.starts_with(LEGACY) && !is_dsh_credential_ref(key))
        .collect();
    for (key, value) in legacy {
        let current = format!("{CURRENT}{}", &key[LEGACY.len()..]);
        if std::env::var_os(&current).is_none() {
            std::env::set_var(&current, value);
        }
        std::env::remove_var(&key);
    }
}

fn is_dsh_credential_ref(key: &str) -> bool {
    key.strip_prefix("REMOTE_CODEX_DSH_")
        .is_some_and(|rest| !matches!(rest, "NATIVE" | "WEB_APP"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adopts_legacy_names_without_overriding_current_ones() {
        std::env::set_var("REMOTE_CODEX_ADOPT_TEST_ONLY_LEGACY", "old");
        std::env::set_var("REMOTE_CODEX_ADOPT_TEST_BOTH", "old");
        std::env::set_var("POCKYMOE_ADOPT_TEST_BOTH", "new");
        std::env::set_var("REMOTE_CODEX_DSH_ADOPT_TEST_PROFILE", "ref");
        std::env::set_var("REMOTE_CODEX_DSH_NATIVE", "0");
        adopt();
        assert_eq!(
            std::env::var("POCKYMOE_ADOPT_TEST_ONLY_LEGACY").as_deref(),
            Ok("old")
        );
        assert_eq!(
            std::env::var("POCKYMOE_ADOPT_TEST_BOTH").as_deref(),
            Ok("new")
        );
        assert!(std::env::var_os("REMOTE_CODEX_ADOPT_TEST_ONLY_LEGACY").is_none());
        assert!(std::env::var_os("REMOTE_CODEX_ADOPT_TEST_BOTH").is_none());
        assert_eq!(
            std::env::var("REMOTE_CODEX_DSH_ADOPT_TEST_PROFILE").as_deref(),
            Ok("ref")
        );
        assert!(std::env::var_os("POCKYMOE_DSH_ADOPT_TEST_PROFILE").is_none());
        assert_eq!(std::env::var("POCKYMOE_DSH_NATIVE").as_deref(), Ok("0"));
    }
}
