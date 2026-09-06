//! RFC 9180 HPKE protects request contents from the relay. Short-lived recipient
//! keys are signed by a persistent device identity, which the browser pins.
mod streams;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, bail, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use hpke::{
    aead::AesGcm256, kdf::HkdfSha256, kem::DhP256HkdfSha256 as Kem, Deserializable,
    Kem as KemTrait, OpModeR, Serializable,
};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use rand::{rngs::OsRng, RngCore};
use remote_codex_runtime::Supervisor;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use uuid::Uuid;

const INFO: &[u8] = b"remote-codex/relay/v1";
const LIMIT: usize = 64 * 1024 * 1024;
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn random() -> [u8; 32] {
    let mut data = [0u8; 32];
    OsRng.fill_bytes(&mut data);
    data
}
type PrivateKey = <Kem as KemTrait>::PrivateKey;
struct Recipient {
    secret: PrivateKey,
    public: String,
    expires: i64,
}
pub(crate) struct Transport {
    identity: SigningKey,
    pub(super) streams: streams::Streams,
    keys: Mutex<HashMap<String, Recipient>>,
    seen: Mutex<HashMap<String, i64>>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
static TRANSPORTS: OnceLock<Mutex<HashMap<PathBuf, Arc<Transport>>>> = OnceLock::new();
pub(crate) fn transport(state: &Supervisor) -> Result<Arc<Transport>> {
    let path = state
        .config
        .database_url
        .with_extension("transport-identity");
    let mut transports = TRANSPORTS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| anyhow!("transport lock failed"))?;
    if let Some(value) = transports.get(&path) {
        return Ok(value.clone());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let identity = if path.exists() {
        SigningKey::from_slice(&B64.decode(std::fs::read_to_string(&path)?.trim())?)?
    } else {
        let key = SigningKey::random(&mut OsRng);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path)?;
        file.write_all(B64.encode(key.to_bytes()).as_bytes())?;
        file.sync_all()?;
        key
    };
    let value = Arc::new(Transport {
        identity,
        streams: streams::Streams::default(),
        keys: Mutex::default(),
        seen: Mutex::default(),
        sessions: Mutex::default(),
    });
    transports.insert(path, value.clone());
    Ok(value)
}
pub(crate) fn fingerprint(database: &std::path::Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let identity =
        SigningKey::from_slice(&B64.decode(
            std::fs::read_to_string(database.with_extension("transport-identity"))?.trim(),
        )?)?;
    Ok(B64.encode(Sha256::digest(
        identity.verifying_key().to_encoded_point(false).as_bytes(),
    )))
}
impl Transport {
    pub fn has_key(&self, id: &str) -> bool {
        self.keys
            .lock()
            .is_ok_and(|keys| keys.get(id).is_some_and(|key| key.expires + 60_000 > now()))
    }
    pub fn descriptor(&self, challenge: &str) -> Result<Value> {
        let mut keys = self.keys.lock().map_err(|_| anyhow!("key lock failed"))?;
        self.streams.expire();
        let time = now();
        keys.retain(|_, k| k.expires + 60_000 > time);
        if !keys.values().any(|k| k.expires > time + 60_000) {
            let (secret, public) = Kem::derive_keypair(&random());
            keys.insert(
                Uuid::new_v4().to_string(),
                Recipient {
                    secret,
                    public: B64.encode(public.to_bytes()),
                    expires: time + 3_600_000,
                },
            );
        }
        let (id, key) = keys
            .iter()
            .max_by_key(|(_, k)| k.expires)
            .ok_or_else(|| anyhow!("key unavailable"))?;
        let identity = B64.encode(
            self.identity
                .verifying_key()
                .to_encoded_point(false)
                .as_bytes(),
        );
        let signed = format!(
            "rcd-key-v1\n{challenge}\n{id}\n{}\n{time}\n{}",
            key.expires, key.public
        );
        let signature: Signature = self.identity.sign(signed.as_bytes());
        Ok(
            json!({"version":1,"challenge":challenge,"suite":"DHKEM-P256-HKDF-SHA256/AES-256-GCM","keyId":id,"publicKey":key.public,"identityKey":identity,"expiresAt":key.expires,"serverTime":time,"signature":B64.encode(signature.to_bytes())}),
        )
    }
    pub fn open(&self, payload: &Value) -> Result<OpenedRequest> {
        let headers = &payload["headers"];
        let key_id = headers["x-rcd-key"]
            .as_str()
            .ok_or_else(|| anyhow!("missing encryption key"))?;
        let request_id = headers["x-rcd-request"]
            .as_str()
            .ok_or_else(|| anyhow!("missing request id"))?;
        if request_id.len() > 100 {
            bail!("invalid request id");
        }
        let (_, timestamp) = request_id
            .rsplit_once('.')
            .ok_or_else(|| anyhow!("missing request time"))?;
        let timestamp: i64 = timestamp.parse()?;
        if now().abs_diff(timestamp) > 120_000 {
            bail!("encrypted request expired");
        }
        let method = payload["method"].as_str().unwrap_or("GET");
        let path = payload["path"].as_str().unwrap_or("");
        let route = headers["x-rcd-resource"].as_str().unwrap_or("");
        let aad = format!("rcd-http-v1\n{key_id}\n{request_id}\n{method}\n{path}\n{route}");
        let enc = <Kem as KemTrait>::EncappedKey::from_bytes(
            &B64.decode(headers["x-rcd-enc"].as_str().unwrap_or(""))?,
        )?;
        let mut context = {
            let keys = self.keys.lock().map_err(|_| anyhow!("key lock failed"))?;
            let key = keys
                .get(key_id)
                .filter(|k| k.expires + 60_000 > now())
                .ok_or_else(|| anyhow!("encryption key expired; reconnect"))?;
            hpke::setup_receiver::<AesGcm256, HkdfSha256, Kem>(
                &OpModeR::Base,
                &key.secret,
                &enc,
                INFO,
            )?
        };
        let ciphertext = if let Some(sealed) = headers["x-rcd-sealed"].as_str() {
            B64.decode(sealed)?
        } else {
            super::tunnel::decode_relay_request_body(payload)
                .map_err(|e| anyhow!(e))?
                .unwrap_or_default()
        };
        if ciphertext.len() > LIMIT {
            bail!("encrypted request too large");
        }
        let clear = context.open(&ciphertext, aad.as_bytes())?;
        let (metadata, body) = unpack(&clear)?;
        if !route.is_empty() {
            let resource: Value = serde_json::from_str(route)?;
            let body: Value = serde_json::from_slice(body)?;
            if resource["workspaceId"] != body["workspaceId"] {
                bail!("resource metadata does not match the encrypted request");
            }
        }
        {
            let mut seen = self
                .seen
                .lock()
                .map_err(|_| anyhow!("replay lock failed"))?;
            seen.retain(|_, at| *at + 180_000 > now());
            if seen.contains_key(request_id) {
                bail!("encrypted request replay rejected");
            }
            if seen.len() >= 16_384 {
                bail!("too many encrypted requests");
            }
            seen.insert(request_id.to_string(), now());
        }
        let mut response_key = [0u8; 32];
        let mut client_key = [0u8; 32];
        let mut server_key = [0u8; 32];
        context.export(b"remote-codex/http-response/v1", &mut response_key)?;
        context.export(b"remote-codex/ws-client/v1", &mut client_key)?;
        context.export(b"remote-codex/ws-server/v1", &mut server_key)?;
        let mut request = payload.clone();
        let query = metadata["query"].as_str().unwrap_or("");
        if !query.is_empty() && (!query.starts_with('?') || query.contains('#')) {
            bail!("invalid encrypted query");
        }
        request["path"] = json!(format!("{path}{query}"));
        request["headers"] = metadata["headers"].clone();
        request["body"] = Value::String(base64::engine::general_purpose::STANDARD.encode(body));
        request["bodyEncoding"] = json!("base64");
        Ok(OpenedRequest {
            request,
            response_key,
            client_key,
            server_key,
            aad,
        })
    }
    pub fn remove_session(&self, id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(id);
        }
    }
    pub fn session(&self, id: &str) -> Option<Arc<Session>> {
        let mut sessions = self.sessions.lock().ok()?;
        sessions.retain(|_, s| s.expires > now());
        sessions.get(id).cloned()
    }
    pub fn create_session(&self, request: &OpenedRequest) -> Result<Value> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("session lock failed"))?;
        sessions.retain(|_, s| s.expires > now());
        if sessions.len() >= 128 {
            bail!("too many encrypted sessions");
        }
        let id = Uuid::new_v4().to_string();
        let expires = now() + 3_600_000;
        sessions.insert(
            id.clone(),
            Arc::new(Session {
                id: id.clone(),
                expires,
                receive_key: request.client_key,
                send_key: request.server_key,
                send_sequence: Mutex::new(0),
                receive_sequence: Mutex::new(0),
            }),
        );
        Ok(json!({"channelId":id,"expiresAt":expires}))
    }
}
pub(crate) struct OpenedRequest {
    pub request: Value,
    response_key: [u8; 32],
    client_key: [u8; 32],
    server_key: [u8; 32],
    aad: String,
}
impl OpenedRequest {
    pub fn response(&self, response: Value) -> Result<Value> {
        let status = response["statusCode"].as_u64().unwrap_or(200);
        let body = if response["bodyEncoding"] == "base64" {
            base64::engine::general_purpose::STANDARD
                .decode(response["body"].as_str().unwrap_or(""))?
        } else {
            response["body"].as_str().unwrap_or("").as_bytes().to_vec()
        };
        let clear = pack(
            &json!({"headers":response["headers"],"status":status,"streamNext":response["streamNext"]}),
            &body,
        )?;
        // Each HPKE context has a unique exporter key and exactly one response.
        let cipher = Aes256Gcm::new_from_slice(&self.response_key)
            .map_err(|_| anyhow!("invalid response key"))?;
        let aad = format!("{}\nresponse", self.aad);
        let sealed = cipher
            .encrypt(
                Nonce::from_slice(&[0u8; 12]),
                Payload {
                    msg: &clear,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("response encryption failed"))?;
        Ok(
            json!({"statusCode":200,"headers":{"content-type":"application/octet-stream","x-rcd-encrypted":"1","cache-control":"no-store"},"body":base64::engine::general_purpose::STANDARD.encode(sealed),"bodyEncoding":"base64"}),
        )
    }
}
fn pack(metadata: &Value, body: &[u8]) -> Result<Vec<u8>> {
    let meta = serde_json::to_vec(metadata)?;
    if meta.len() > 64 * 1024 || body.len() > LIMIT {
        bail!("encrypted packet too large");
    }
    let mut out = Vec::with_capacity(4 + meta.len() + body.len());
    out.extend_from_slice(&(meta.len() as u32).to_be_bytes());
    out.extend_from_slice(&meta);
    out.extend_from_slice(body);
    Ok(out)
}
fn unpack(clear: &[u8]) -> Result<(Value, &[u8])> {
    if clear.len() < 4 {
        bail!("invalid encrypted packet");
    }
    let n = u32::from_be_bytes(clear[..4].try_into()?) as usize;
    if n > 64 * 1024 || n + 4 > clear.len() {
        bail!("invalid packet metadata");
    }
    Ok((serde_json::from_slice(&clear[4..4 + n])?, &clear[4 + n..]))
}
pub(crate) struct Session {
    id: String,
    expires: i64,
    receive_key: [u8; 32],
    send_key: [u8; 32],
    send_sequence: Mutex<u64>,
    receive_sequence: Mutex<u64>,
}
fn ws_aad(id: &str, seq: u64, message: &Value) -> String {
    format!(
        "rcd-ws-v1\n{id}\n{seq}\n{}\n{}\n{}",
        message["type"].as_str().unwrap_or(""),
        message["threadId"].as_str().unwrap_or(""),
        message["shellId"].as_str().unwrap_or("")
    )
}
fn nonce(sequence: u64) -> [u8; 12] {
    let mut iv = [0u8; 12];
    iv[4..].copy_from_slice(&sequence.to_be_bytes());
    iv
}
impl Session {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn seal(&self, message: &Value) -> Result<Value> {
        if self.expires <= now() {
            bail!("encrypted channel expired");
        }
        let mut seq = self
            .send_sequence
            .lock()
            .map_err(|_| anyhow!("sequence lock failed"))?;
        let ciphertext = Aes256Gcm::new_from_slice(&self.send_key)
            .map_err(|_| anyhow!("invalid key"))?
            .encrypt(
                Nonce::from_slice(&nonce(*seq)),
                Payload {
                    msg: &serde_json::to_vec(message)?,
                    aad: ws_aad(&self.id, *seq, message).as_bytes(),
                },
            )
            .map_err(|_| anyhow!("event encryption failed"))?;
        let result = json!({"type":message["type"],"threadId":message["threadId"],"shellId":message["shellId"],"encrypted":{"version":1,"channelId":self.id,"sequence":*seq,"body":B64.encode(ciphertext)}});
        *seq = seq
            .checked_add(1)
            .ok_or_else(|| anyhow!("sequence exhausted"))?;
        Ok(result)
    }
    pub fn open(&self, message: &Value) -> Result<Value> {
        if self.expires <= now() {
            bail!("encrypted channel expired");
        }
        let mut seq = self
            .receive_sequence
            .lock()
            .map_err(|_| anyhow!("sequence lock failed"))?;
        let e = &message["encrypted"];
        if e["version"] != 1 || e["channelId"] != self.id || e["sequence"].as_u64() != Some(*seq) {
            bail!("encrypted event replay or wrong channel");
        }
        let body = B64.decode(e["body"].as_str().unwrap_or(""))?;
        if body.len() > 4 * 1024 * 1024 {
            bail!("event too large");
        }
        let clear = Aes256Gcm::new_from_slice(&self.receive_key)
            .map_err(|_| anyhow!("invalid key"))?
            .decrypt(
                Nonce::from_slice(&nonce(*seq)),
                Payload {
                    msg: &body,
                    aad: ws_aad(&self.id, *seq, message).as_bytes(),
                },
            )
            .map_err(|_| anyhow!("event authentication failed"))?;
        let clear: Value = serde_json::from_slice(&clear)?;
        if ws_aad(&self.id, *seq, &clear) != ws_aad(&self.id, *seq, message) {
            bail!("event routing mismatch");
        }
        *seq = seq
            .checked_add(1)
            .ok_or_else(|| anyhow!("sequence exhausted"))?;
        Ok(clear)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Transport {
        Transport {
            identity: SigningKey::random(&mut OsRng),
            streams: streams::Streams::default(),
            keys: Mutex::default(),
            seen: Mutex::default(),
            sessions: Mutex::default(),
        }
    }
    fn request(device: &Transport, method: &str, path: &str, body: &[u8], resource: &str) -> Value {
        let descriptor = device.descriptor("").unwrap();
        let public = <Kem as KemTrait>::PublicKey::from_bytes(
            &B64.decode(descriptor["publicKey"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        use rand09::SeedableRng;
        let mut rng = rand09::rngs::StdRng::from_seed(random());
        let (enc, mut sender) = hpke::setup_sender::<AesGcm256, HkdfSha256, Kem, _>(
            &hpke::OpModeS::Base,
            &public,
            INFO,
            &mut rng,
        )
        .unwrap();
        let id = format!("{}.{}", Uuid::new_v4(), now());
        let key = descriptor["keyId"].as_str().unwrap();
        let aad = format!("rcd-http-v1\n{key}\n{id}\n{method}\n{path}\n{resource}");
        let clear = pack(
            &json!({"headers":{"content-type":"application/json"}}),
            body,
        )
        .unwrap();
        let sealed = sender.seal(&clear, aad.as_bytes()).unwrap();
        json!({"method":method,"path":path,"headers":{"x-rcd-key":key,"x-rcd-request":id,"x-rcd-enc":B64.encode(enc.to_bytes()),"x-rcd-sealed":B64.encode(sealed),"x-rcd-resource":resource}})
    }
    #[test]
    fn request_authentication_replay_and_resource_binding() {
        let device = device();
        let request = request(
            &device,
            "POST",
            "/api/threads/start",
            br#"{"workspaceId":"owned"}"#,
            r#"{"workspaceId":"owned"}"#,
        );
        let mut tampered = request.clone();
        tampered["path"] = json!("/api/threads/import");
        assert!(device.open(&tampered).is_err());
        let opened = device.open(&request).unwrap();
        assert!(device.open(&request).is_err());
        assert_eq!(
            super::super::tunnel::decode_relay_request_body(&opened.request)
                .unwrap()
                .unwrap(),
            br#"{"workspaceId":"owned"}"#
        );
        let mismatch = self::request(
            &device,
            "POST",
            "/api/threads/start",
            br#"{"workspaceId":"other"}"#,
            r#"{"workspaceId":"owned"}"#,
        );
        assert!(device.open(&mismatch).is_err());
        let response = opened
            .response(json!({"statusCode":204,"headers":{},"body":""}))
            .unwrap();
        assert_eq!(response["statusCode"], 200);
        assert!(!response["body"].as_str().unwrap().is_empty());
    }
    #[test]
    fn socket_direction_routing_and_replay_are_authenticated() {
        let key = random();
        let other = random();
        let server = Session {
            id: "channel".into(),
            expires: now() + 60_000,
            receive_key: key,
            send_key: other,
            send_sequence: Mutex::new(0),
            receive_sequence: Mutex::new(0),
        };
        let client = Session {
            id: "channel".into(),
            expires: now() + 60_000,
            receive_key: other,
            send_key: key,
            send_sequence: Mutex::new(0),
            receive_sequence: Mutex::new(0),
        };
        let clear = json!({"type":"shell.input","threadId":"t","shellId":"s","data":"secret"});
        let message = client.seal(&clear).unwrap();
        assert!(!message.to_string().contains("secret"));
        let mut wrong = message.clone();
        wrong["shellId"] = json!("another");
        assert!(server.open(&wrong).is_err());
        assert_eq!(server.open(&message).unwrap(), clear);
        assert!(server.open(&message).is_err());
        let response = server
            .seal(&json!({"type":"shell.output","data":"reply"}))
            .unwrap();
        assert!(server.open(&response).is_err());
        assert_eq!(client.open(&response).unwrap()["data"], "reply");
    }
    #[test]
    fn descriptor_signature_binds_browser_freshness_challenge() {
        use p256::ecdsa::signature::Verifier;
        let device = device();
        let descriptor = device.descriptor("fresh-browser-challenge").unwrap();
        let signed = format!(
            "rcd-key-v1\nfresh-browser-challenge\n{}\n{}\n{}\n{}",
            descriptor["keyId"].as_str().unwrap(),
            descriptor["expiresAt"],
            descriptor["serverTime"],
            descriptor["publicKey"].as_str().unwrap()
        );
        let signature = Signature::from_slice(
            &B64.decode(descriptor["signature"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let verifier = device.identity.verifying_key();
        assert!(verifier.verify(signed.as_bytes(), &signature).is_ok());
        assert!(verifier
            .verify(
                signed
                    .replace("fresh-browser-challenge", "another-challenge")
                    .as_bytes(),
                &signature
            )
            .is_err());
    }
    #[test]
    fn key_rotation_keeps_identity_but_rejects_expired_recipient_keys() {
        let device = device();
        let old = device.descriptor("").unwrap();
        let request = request(&device, "GET", "/api/workspaces", b"", "");
        for key in device.keys.lock().unwrap().values_mut() {
            key.expires = now() - 61_000;
        }
        let new = device.descriptor("").unwrap();
        assert_eq!(old["identityKey"], new["identityKey"]);
        assert_ne!(old["keyId"], new["keyId"]);
        assert!(device.open(&request).is_err());
    }
}
