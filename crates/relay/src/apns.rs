//! Native iOS delivery reuses the authenticated, durable notification outbox.
use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use openssl::{ecdsa::EcdsaSig, hash::MessageDigest, pkey::PKey, sign::Signer};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Subscription {
    pub native_platform: String,
    pub device_token: String,
    pub relay_origin: String,
    #[serde(default)]
    pub sandbox: bool,
}

pub(super) fn configured() -> bool {
    [
        "REMOTE_CODEX_APNS_KEY_PATH",
        "REMOTE_CODEX_APNS_KEY_ID",
        "REMOTE_CODEX_APNS_TEAM_ID",
        "REMOTE_CODEX_APNS_TOPIC",
    ]
    .iter()
    .all(|key| std::env::var(key).is_ok_and(|v| !v.trim().is_empty()))
}

pub(super) fn validate(sub: &Subscription) -> Result<()> {
    anyhow::ensure!(sub.native_platform == "apns", "Unsupported native platform");
    let origin = reqwest::Url::parse(&sub.relay_origin)?;
    anyhow::ensure!(
        matches!(origin.scheme(), "https" | "http")
            && origin.host_str().is_some()
            && origin.username().is_empty()
            && origin.password().is_none()
            && origin.path() == "/"
            && origin.query().is_none()
            && origin.fragment().is_none(),
        "Invalid relay origin"
    );
    anyhow::ensure!(
        (64..=200).contains(&sub.device_token.len())
            && sub.device_token.len() % 2 == 0
            && sub.device_token.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid APNs token"
    );
    Ok(())
}

fn jwt(pem: &[u8], key_id: &str, team_id: &str, now: i64) -> Result<String> {
    let header = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"alg":"ES256","kid":key_id}))?);
    let claims = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"iss":team_id,"iat":now}))?);
    let signing = format!("{header}.{claims}");
    let key = PKey::private_key_from_pem(pem)?;
    let mut signer = Signer::new(MessageDigest::sha256(), &key)?;
    signer.update(signing.as_bytes())?;
    let der = signer.sign_to_vec()?;
    let signature = EcdsaSig::from_der(&der)?;
    let mut raw = signature.r().to_vec_padded(32)?;
    raw.extend(signature.s().to_vec_padded(32)?);
    Ok(format!("{signing}.{}", URL_SAFE_NO_PAD.encode(raw)))
}

pub(super) async fn deliver(
    http: &reqwest::Client,
    sub: &Subscription,
    payload: &str,
) -> Result<StatusCode> {
    validate(sub)?;
    let pem = std::fs::read(std::env::var("REMOTE_CODEX_APNS_KEY_PATH")?)?;
    let token = jwt(
        &pem,
        &std::env::var("REMOTE_CODEX_APNS_KEY_ID")?,
        &std::env::var("REMOTE_CODEX_APNS_TEAM_ID")?,
        chrono::Utc::now().timestamp(),
    )?;
    let event: Value = serde_json::from_str(payload)?;
    let parts: Vec<&str> = event["url"].as_str().unwrap_or("").split('/').collect();
    anyhow::ensure!(
        parts.len() == 5 && parts[1] == "devices" && parts[3] == "threads",
        "Invalid notification route"
    );
    let host = if sub.sandbox {
        "api.sandbox.push.apple.com"
    } else {
        "api.push.apple.com"
    };
    let reply = http.post(format!("https://{host}/3/device/{}", sub.device_token))
        .version(reqwest::Version::HTTP_2)
        .bearer_auth(token)
        .header("apns-topic", std::env::var("REMOTE_CODEX_APNS_TOPIC")?)
        .header("apns-push-type", "alert")
        .header("apns-priority", "10")
        .header("apns-expiration", (chrono::Utc::now().timestamp() + 86400).to_string())
        .json(&json!({
            "aps":{"alert":{"title":event["title"],"body":event["body"]},"sound":"default","thread-id":format!("{}:{}",parts[2],parts[4])},
            "deviceId":parts[2],"threadId":parts[4],"eventId":event["tag"],"relayOrigin":sub.relay_origin,
        })).send().await?;
    let status = reply.status();
    if status == StatusCode::BAD_REQUEST {
        let reason: Value = reply.json().await.unwrap_or_default();
        if matches!(
            reason["reason"].as_str(),
            Some("BadDeviceToken" | "DeviceTokenNotForTopic")
        ) {
            return Ok(StatusCode::GONE);
        }
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn token_validation_and_signed_provider_jwt() -> Result<()> {
        assert!(validate(&Subscription {
            native_platform: "apns".into(),
            device_token: "ab".repeat(32),
            relay_origin: "https://relay.example.com".into(),
            sandbox: true
        })
        .is_ok());
        assert!(validate(&Subscription {
            native_platform: "apns".into(),
            device_token: "../injection".into(),
            relay_origin: "https://relay.example.com".into(),
            sandbox: false
        })
        .is_err());
        let group = openssl::ec::EcGroup::from_curve_name(openssl::nid::Nid::X9_62_PRIME256V1)?;
        let key = openssl::ec::EcKey::generate(&group)?;
        let value = jwt(&key.private_key_to_pem()?, "KEY", "TEAM", 123)?;
        let parts: Vec<_> = value.split('.').collect();
        let raw = URL_SAFE_NO_PAD.decode(parts[2])?;
        assert_eq!(raw.len(), 64);
        let sig = EcdsaSig::from_private_components(
            openssl::bn::BigNum::from_slice(&raw[..32])?,
            openssl::bn::BigNum::from_slice(&raw[32..])?,
        )?;
        let hash = openssl::sha::sha256(format!("{}.{}", parts[0], parts[1]).as_bytes());
        assert!(sig.verify(&hash, &key)?);
        Ok(())
    }
}
