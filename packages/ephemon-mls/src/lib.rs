use std::collections::HashMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

use openmls::prelude::tls_codec::Deserialize as TlsDeserialize;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use openmls_traits::crypto::OpenMlsCrypto;
use openmls_traits::signatures::Signer;
use openmls_traits::types::Ciphersuite;
use wasm_bindgen::prelude::*;

pub const ABI_VERSION: u32 = 5;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

#[unsafe(no_mangle)]
pub extern "C" fn ephemon_mls_abi_version() -> u32 {
    ABI_VERSION
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsFacadeError {
    operation: &'static str,
    detail: String,
}

impl MlsFacadeError {
    fn new(operation: &'static str, detail: impl Into<String>) -> Self {
        Self {
            operation,
            detail: detail.into(),
        }
    }

    fn debug(operation: &'static str, error: impl std::fmt::Debug) -> Self {
        Self::new(operation, format!("{error:?}"))
    }
}

impl Display for MlsFacadeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{} failed: {}", self.operation, self.detail)
    }
}

impl Error for MlsFacadeError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddMemberOutput {
    pub claimed_identity: Vec<u8>,
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitFacts {
    pub sender_identity: Vec<u8>,
    pub sender_is_member: bool,
    pub added: Vec<Vec<u8>>,
    pub removed_leaves: Vec<u32>,
    pub epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessedApplicationMessage {
    pub sender_identity: Vec<u8>,
    pub sender_is_member: bool,
    pub payload: Vec<u8>,
}

pub struct MlsClient {
    identity: Vec<u8>,
    credential: CredentialWithKey,
    signer: SignatureKeyPair,
    provider: OpenMlsRustCrypto,
    group: Option<MlsGroup>,
}

impl MlsClient {
    pub fn new(identity: Vec<u8>) -> Result<Self, MlsFacadeError> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
            .map_err(|error| MlsFacadeError::debug("generate group signing key", error))?;
        signer
            .store(provider.storage())
            .map_err(|error| MlsFacadeError::debug("store group signing key", error))?;
        let credential = credential_for(&identity, &signer);

        Ok(Self {
            identity,
            credential,
            signer,
            provider,
            group: None,
        })
    }

    pub fn identity(&self) -> Vec<u8> {
        self.identity.clone()
    }

    pub fn create_group(&mut self, group_id: &[u8]) -> Result<(), MlsFacadeError> {
        if group_id.is_empty() {
            return Err(MlsFacadeError::new(
                "create group",
                "group id must not be empty",
            ));
        }
        if self.group.is_some() {
            return Err(MlsFacadeError::new(
                "create group",
                "client already has a group",
            ));
        }

        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
            .use_ratchet_tree_extension(true)
            .build();
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &config,
            GroupId::from_slice(group_id),
            self.credential.clone(),
        )
        .map_err(|error| MlsFacadeError::debug("create group", error))?;
        self.group = Some(group);
        Ok(())
    }

    pub fn create_key_package(&self) -> Result<Vec<u8>, MlsFacadeError> {
        let bundle = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(|error| MlsFacadeError::debug("create key package", error))?;
        let message: MlsMessageOut = bundle.key_package().clone().into();
        message
            .to_bytes()
            .map_err(|error| MlsFacadeError::debug("serialize key package", error))
    }

    pub fn stage_add_member(
        &mut self,
        key_package_bytes: &[u8],
    ) -> Result<AddMemberOutput, MlsFacadeError> {
        let key_package_message =
            deserialize_mls_message("deserialize key package", key_package_bytes)?;
        let key_package = match key_package_message.extract() {
            MlsMessageBodyIn::KeyPackage(key_package) => key_package
                .validate(self.provider.crypto(), ProtocolVersion::Mls10)
                .map_err(|error| MlsFacadeError::debug("validate key package", error))?,
            _ => {
                return Err(MlsFacadeError::new(
                    "deserialize key package",
                    "wire message is not a KeyPackage",
                ));
            }
        };
        let claimed_identity = key_package
            .leaf_node()
            .credential()
            .serialized_content()
            .to_vec();
        let provider = &self.provider;
        let signer = &self.signer;
        let group = self
            .group
            .as_mut()
            .ok_or_else(|| MlsFacadeError::new("stage add member", "group is not initialized"))?;
        let (commit, welcome, _) = group
            .add_members(provider, signer, &[key_package])
            .map_err(|error| MlsFacadeError::debug("stage add member", error))?;

        Ok(AddMemberOutput {
            claimed_identity,
            commit: commit
                .to_bytes()
                .map_err(|error| MlsFacadeError::debug("serialize add commit", error))?,
            welcome: welcome
                .to_bytes()
                .map_err(|error| MlsFacadeError::debug("serialize welcome", error))?,
        })
    }

    pub fn create_self_update(&mut self) -> Result<Vec<u8>, MlsFacadeError> {
        let provider = &self.provider;
        let signer = &self.signer;
        let group = self
            .group
            .as_mut()
            .ok_or_else(|| MlsFacadeError::new("create self update", "group is not initialized"))?;
        let bundle = group
            .self_update(provider, signer, LeafNodeParameters::default())
            .map_err(|error| MlsFacadeError::debug("create self update", error))?;
        let commit = bundle
            .into_messages()
            .0
            .to_bytes()
            .map_err(|error| MlsFacadeError::debug("serialize self update", error))?;
        Ok(commit)
    }

    pub fn process_incoming_commit(
        &mut self,
        message_bytes: &[u8],
    ) -> Result<CommitFacts, MlsFacadeError> {
        let message = deserialize_mls_message("deserialize commit", message_bytes)?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|error| MlsFacadeError::debug("extract protocol message", error))?;
        let provider = &self.provider;
        let group = self
            .group
            .as_mut()
            .ok_or_else(|| MlsFacadeError::new("process commit", "group is not initialized"))?;
        let processed = group
            .process_message(provider, protocol_message)
            .map_err(|error| MlsFacadeError::debug("process commit", error))?;
        let sender_is_member = matches!(processed.sender(), Sender::Member(_));
        let sender_identity = processed.credential().serialized_content().to_vec();
        let staged = match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => *staged,
            _ => {
                return Err(MlsFacadeError::new(
                    "process commit",
                    "processed MLS content is not a commit",
                ));
            }
        };
        let added = staged
            .add_proposals()
            .map(|proposal| {
                proposal
                    .add_proposal()
                    .key_package()
                    .leaf_node()
                    .credential()
                    .serialized_content()
                    .to_vec()
            })
            .collect::<Vec<Vec<u8>>>();
        let removed_leaves = staged
            .remove_proposals()
            .map(|proposal| proposal.remove_proposal().removed().u32())
            .collect::<Vec<u32>>();
        group
            .merge_staged_commit(provider, staged)
            .map_err(|error| MlsFacadeError::debug("merge staged commit", error))?;
        Ok(CommitFacts {
            sender_identity,
            sender_is_member,
            added,
            removed_leaves,
            epoch: group.epoch().as_u64(),
        })
    }

    pub fn epoch_authenticator(&self) -> Result<Vec<u8>, MlsFacadeError> {
        Ok(self
            .group
            .as_ref()
            .ok_or_else(|| MlsFacadeError::new("epoch authenticator", "group is not initialized"))?
            .epoch_authenticator()
            .as_slice()
            .to_vec())
    }

    pub fn merge_pending_commit(&mut self) -> Result<(), MlsFacadeError> {
        let provider = &self.provider;
        self.group
            .as_mut()
            .ok_or_else(|| MlsFacadeError::new("merge pending commit", "group is not initialized"))?
            .merge_pending_commit(provider)
            .map_err(|error| MlsFacadeError::debug("merge pending commit", error))
    }

    pub fn join_from_welcome(&mut self, welcome_bytes: &[u8]) -> Result<(), MlsFacadeError> {
        if self.group.is_some() {
            return Err(MlsFacadeError::new(
                "join from welcome",
                "client already has a group",
            ));
        }
        let welcome_message = deserialize_mls_message("deserialize welcome", welcome_bytes)?;
        let welcome = match welcome_message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => {
                return Err(MlsFacadeError::new(
                    "deserialize welcome",
                    "wire message is not a Welcome",
                ));
            }
        };
        let join_config = MlsGroupJoinConfig::builder()
            .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
            .use_ratchet_tree_extension(true)
            .build();
        let staged = StagedWelcome::new_from_welcome(&self.provider, &join_config, welcome, None)
            .map_err(|error| MlsFacadeError::debug("stage welcome", error))?;
        let group = staged
            .into_group(&self.provider)
            .map_err(|error| MlsFacadeError::debug("join from welcome", error))?;
        self.group = Some(group);
        Ok(())
    }

    pub fn create_application_message(
        &mut self,
        payload: &[u8],
    ) -> Result<Vec<u8>, MlsFacadeError> {
        let provider = &self.provider;
        let signer = &self.signer;
        self.group
            .as_mut()
            .ok_or_else(|| {
                MlsFacadeError::new("create application message", "group is not initialized")
            })?
            .create_message(provider, signer, payload)
            .map_err(|error| MlsFacadeError::debug("create application message", error))?
            .to_bytes()
            .map_err(|error| MlsFacadeError::debug("serialize application message", error))
    }

    pub fn process_application_message(
        &mut self,
        message_bytes: &[u8],
    ) -> Result<ProcessedApplicationMessage, MlsFacadeError> {
        let message = deserialize_mls_message("deserialize application message", message_bytes)?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|error| MlsFacadeError::debug("extract protocol message", error))?;
        let provider = &self.provider;
        let processed = self
            .group
            .as_mut()
            .ok_or_else(|| {
                MlsFacadeError::new("process application message", "group is not initialized")
            })?
            .process_message(provider, protocol_message)
            .map_err(|error| MlsFacadeError::debug("process application message", error))?;
        let sender_is_member = matches!(processed.sender(), Sender::Member(_));
        let sender_identity = processed.credential().serialized_content().to_vec();
        let payload = match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(application) => application.into_bytes(),
            _ => {
                return Err(MlsFacadeError::new(
                    "process application message",
                    "processed MLS content is not an application message",
                ));
            }
        };

        Ok(ProcessedApplicationMessage {
            sender_identity,
            sender_is_member,
            payload,
        })
    }

    pub fn group_id(&self) -> Option<Vec<u8>> {
        self.group
            .as_ref()
            .map(|group| group.group_id().as_slice().to_vec())
    }

    pub fn epoch(&self) -> Option<u64> {
        self.group.as_ref().map(|group| group.epoch().as_u64())
    }

    pub fn member_identities(&self) -> Result<Vec<Vec<u8>>, MlsFacadeError> {
        let group = self
            .group
            .as_ref()
            .ok_or_else(|| MlsFacadeError::new("inspect members", "group is not initialized"))?;
        group
            .members()
            .map(|member| Ok(member.credential.serialized_content().to_vec()))
            .collect()
    }

    /// Signs under a label of its own so a signature produced here can never be read as MLS protocol traffic.
    pub fn sign(&self, message: &[u8]) -> Result<Vec<u8>, MlsFacadeError> {
        self.signer
            .sign(&labelled(message))
            .map_err(|error| MlsFacadeError::debug("sign", error))
    }

    pub fn verify(&self, signature_public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
        self.provider
            .crypto()
            .verify_signature(
                CIPHERSUITE.signature_algorithm(),
                &labelled(message),
                signature_public_key,
                signature,
            )
            .is_ok()
    }

    pub fn member_signature_keys(&self) -> Result<Vec<Vec<u8>>, MlsFacadeError> {
        let group = self
            .group
            .as_ref()
            .ok_or_else(|| MlsFacadeError::new("inspect members", "group is not initialized"))?;
        Ok(group
            .members()
            .map(|member| member.signature_key.to_vec())
            .collect())
    }

    pub fn storage_snapshot(&self) -> Result<Vec<u8>, MlsFacadeError> {
        let (keys, key_lengths, values, value_lengths) = self.storage_halves()?;
        let mut snapshot =
            Vec::with_capacity(8 + key_lengths.len() * 8 + keys.len() + values.len());
        snapshot.extend_from_slice(&(key_lengths.len() as u32).to_be_bytes());
        snapshot.extend_from_slice(&(keys.len() as u32).to_be_bytes());
        for length in &key_lengths {
            snapshot.extend_from_slice(&length.to_be_bytes());
        }
        for length in &value_lengths {
            snapshot.extend_from_slice(&length.to_be_bytes());
        }
        snapshot.extend_from_slice(&keys);
        snapshot.extend_from_slice(&values);
        Ok(snapshot)
    }

    fn storage_halves(&self) -> Result<(Vec<u8>, Vec<u32>, Vec<u8>, Vec<u32>), MlsFacadeError> {
        let values =
            self.provider.storage().values.read().map_err(|_| {
                MlsFacadeError::new("read storage entries", "storage lock is poisoned")
            })?;
        let mut entries: Vec<_> = values.iter().collect();
        entries.sort_by(|(left, _), (right, _)| left.cmp(right));
        let mut keys = Vec::new();
        let mut key_lengths = Vec::with_capacity(entries.len());
        let mut blobs = Vec::new();
        let mut blob_lengths = Vec::with_capacity(entries.len());
        for (key, value) in entries {
            key_lengths.push(u32::try_from(key.len()).map_err(|_| {
                MlsFacadeError::new("read storage entries", "storage key is too long")
            })?);
            keys.extend_from_slice(key);
            blob_lengths.push(u32::try_from(value.len()).map_err(|_| {
                MlsFacadeError::new("read storage entries", "storage value is too long")
            })?);
            blobs.extend_from_slice(value);
        }
        Ok((keys, key_lengths, blobs, blob_lengths))
    }

    pub fn signing_public_key(&self) -> Vec<u8> {
        self.signer.public().to_vec()
    }

    pub fn restore(
        identity: Vec<u8>,
        signing_public_key: &[u8],
        group_id: &[u8],
        keys: &[u8],
        key_lengths: &[u32],
        blobs: &[u8],
        blob_lengths: &[u32],
    ) -> Result<Self, MlsFacadeError> {
        if key_lengths.len() != blob_lengths.len() {
            return Err(MlsFacadeError::new(
                "restore",
                "storage halves disagree on entry count",
            ));
        }
        let mut entries = HashMap::with_capacity(key_lengths.len());
        let mut key_offset = 0usize;
        let mut blob_offset = 0usize;
        for (key_length, blob_length) in key_lengths.iter().zip(blob_lengths.iter()) {
            let key_end = usize::try_from(*key_length)
                .ok()
                .and_then(|length| key_offset.checked_add(length))
                .ok_or_else(|| MlsFacadeError::new("restore", "storage halves are truncated"))?;
            let blob_end = usize::try_from(*blob_length)
                .ok()
                .and_then(|length| blob_offset.checked_add(length))
                .ok_or_else(|| MlsFacadeError::new("restore", "storage halves are truncated"))?;
            if key_end > keys.len() || blob_end > blobs.len() {
                return Err(MlsFacadeError::new(
                    "restore",
                    "storage halves are truncated",
                ));
            }
            if entries
                .insert(
                    keys[key_offset..key_end].to_vec(),
                    blobs[blob_offset..blob_end].to_vec(),
                )
                .is_some()
            {
                return Err(MlsFacadeError::new("restore", "duplicate storage key"));
            }
            key_offset = key_end;
            blob_offset = blob_end;
        }
        if key_offset != keys.len() || blob_offset != blobs.len() {
            return Err(MlsFacadeError::new(
                "restore",
                "storage halves carry trailing bytes",
            ));
        }

        let provider = OpenMlsRustCrypto::default();
        {
            let mut values = provider
                .storage()
                .values
                .write()
                .map_err(|_| MlsFacadeError::new("restore", "storage lock is poisoned"))?;
            *values = entries;
        }
        let signer = SignatureKeyPair::read(
            provider.storage(),
            signing_public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .ok_or_else(|| MlsFacadeError::new("restore", "group signing key is missing"))?;
        let credential = credential_for(&identity, &signer);
        let group = if group_id.is_empty() {
            None
        } else {
            Some(
                MlsGroup::load(provider.storage(), &GroupId::from_slice(group_id))
                    .map_err(|error| MlsFacadeError::debug("restore group", error))?
                    .ok_or_else(|| {
                        MlsFacadeError::new("restore group", "group state is missing")
                    })?,
            )
        };
        Ok(Self {
            identity,
            credential,
            signer,
            provider,
            group,
        })
    }
}

fn credential_for(identity: &[u8], signer: &SignatureKeyPair) -> CredentialWithKey {
    CredentialWithKey {
        credential: BasicCredential::new(identity.to_vec()).into(),
        signature_key: signer.to_public_vec().into(),
    }
}

fn deserialize_mls_message(
    operation: &'static str,
    bytes: &[u8],
) -> Result<MlsMessageIn, MlsFacadeError> {
    MlsMessageIn::tls_deserialize_exact(bytes.to_vec())
        .map_err(|error| MlsFacadeError::debug(operation, error))
}

const SIGNATURE_LABEL: &[u8] = b"ephemon application event v1";

fn labelled(message: &[u8]) -> Vec<u8> {
    let mut labelled = Vec::with_capacity(SIGNATURE_LABEL.len() + 8 + message.len());
    labelled.extend_from_slice(SIGNATURE_LABEL);
    labelled.extend_from_slice(&(message.len() as u64).to_be_bytes());
    labelled.extend_from_slice(message);
    labelled
}

fn flatten(items: &[Vec<u8>]) -> (Vec<u8>, Vec<u32>) {
    let mut bytes = Vec::new();
    let mut lengths = Vec::with_capacity(items.len());
    for item in items {
        lengths.push(item.len() as u32);
        bytes.extend_from_slice(item);
    }
    (bytes, lengths)
}

fn as_js_error(error: MlsFacadeError) -> JsError {
    JsError::new(&error.to_string())
}

#[wasm_bindgen(js_name = EphemonMlsClient)]
pub struct WasmMlsClient {
    inner: MlsClient,
}

#[wasm_bindgen(js_class = EphemonMlsClient)]
impl WasmMlsClient {
    #[wasm_bindgen(constructor)]
    pub fn new(identity: Vec<u8>) -> Result<WasmMlsClient, JsError> {
        Ok(Self {
            inner: MlsClient::new(identity).map_err(as_js_error)?,
        })
    }

    #[wasm_bindgen]
    pub fn restore(
        identity: Vec<u8>,
        signing_public_key: &[u8],
        group_id: &[u8],
        keys: &[u8],
        key_lengths: Vec<u32>,
        blobs: &[u8],
        blob_lengths: Vec<u32>,
    ) -> Result<WasmMlsClient, JsError> {
        Ok(Self {
            inner: MlsClient::restore(
                identity,
                signing_public_key,
                group_id,
                keys,
                &key_lengths,
                blobs,
                &blob_lengths,
            )
            .map_err(as_js_error)?,
        })
    }

    #[wasm_bindgen(getter)]
    pub fn identity(&self) -> Vec<u8> {
        self.inner.identity()
    }

    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(&mut self, group_id: &[u8]) -> Result<(), JsError> {
        self.inner.create_group(group_id).map_err(as_js_error)
    }

    #[wasm_bindgen(js_name = createKeyPackage)]
    pub fn create_key_package(&self) -> Result<Vec<u8>, JsError> {
        self.inner.create_key_package().map_err(as_js_error)
    }

    #[wasm_bindgen(js_name = createSelfUpdate)]
    pub fn create_self_update(&mut self) -> Result<Vec<u8>, JsError> {
        self.inner.create_self_update().map_err(as_js_error)
    }

    #[wasm_bindgen(js_name = processIncomingCommit)]
    pub fn process_incoming_commit(&mut self, message: &[u8]) -> Result<WasmCommitFacts, JsError> {
        Ok(WasmCommitFacts {
            inner: self
                .inner
                .process_incoming_commit(message)
                .map_err(as_js_error)?,
        })
    }

    #[wasm_bindgen(js_name = epochAuthenticator)]
    pub fn epoch_authenticator(&self) -> Result<Vec<u8>, JsError> {
        self.inner.epoch_authenticator().map_err(as_js_error)
    }

    #[wasm_bindgen(js_name = stageAddMember)]
    pub fn stage_add_member(&mut self, key_package: &[u8]) -> Result<WasmAddMemberOutput, JsError> {
        Ok(WasmAddMemberOutput {
            inner: self
                .inner
                .stage_add_member(key_package)
                .map_err(as_js_error)?,
        })
    }

    #[wasm_bindgen(js_name = mergePendingCommit)]
    pub fn merge_pending_commit(&mut self) -> Result<(), JsError> {
        self.inner.merge_pending_commit().map_err(as_js_error)
    }

    #[wasm_bindgen(js_name = joinFromWelcome)]
    pub fn join_from_welcome(&mut self, welcome: &[u8]) -> Result<(), JsError> {
        self.inner.join_from_welcome(welcome).map_err(as_js_error)
    }

    #[wasm_bindgen(js_name = createApplicationMessage)]
    pub fn create_application_message(&mut self, payload: &[u8]) -> Result<Vec<u8>, JsError> {
        self.inner
            .create_application_message(payload)
            .map_err(as_js_error)
    }

    #[wasm_bindgen(js_name = processApplicationMessage)]
    pub fn process_application_message(
        &mut self,
        message: &[u8],
    ) -> Result<WasmProcessedApplicationMessage, JsError> {
        Ok(WasmProcessedApplicationMessage {
            inner: self
                .inner
                .process_application_message(message)
                .map_err(as_js_error)?,
        })
    }

    fn flat_members(&self) -> Result<(Vec<u8>, Vec<u32>), JsError> {
        Ok(flatten(
            &self.inner.member_identities().map_err(as_js_error)?,
        ))
    }

    fn flat_signature_keys(&self) -> Result<(Vec<u8>, Vec<u32>), JsError> {
        Ok(flatten(
            &self.inner.member_signature_keys().map_err(as_js_error)?,
        ))
    }

    #[wasm_bindgen(js_name = memberSignatureKeys)]
    pub fn member_signature_keys(&self) -> Result<Vec<u8>, JsError> {
        Ok(self.flat_signature_keys()?.0)
    }

    #[wasm_bindgen(js_name = memberSignatureKeyLengths)]
    pub fn member_signature_key_lengths(&self) -> Result<Vec<u32>, JsError> {
        Ok(self.flat_signature_keys()?.1)
    }

    pub fn sign(&self, message: &[u8]) -> Result<Vec<u8>, JsError> {
        self.inner.sign(message).map_err(as_js_error)
    }

    pub fn verify(&self, signature_public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
        self.inner.verify(signature_public_key, message, signature)
    }

    #[wasm_bindgen(js_name = storageSnapshot)]
    pub fn storage_snapshot(&self) -> Result<Vec<u8>, JsError> {
        self.inner.storage_snapshot().map_err(as_js_error)
    }

    #[wasm_bindgen(getter, js_name = signingPublicKey)]
    pub fn signing_public_key(&self) -> Vec<u8> {
        self.inner.signing_public_key()
    }

    #[wasm_bindgen(getter, js_name = groupId)]
    pub fn group_id_bytes(&self) -> Vec<u8> {
        self.inner.group_id().unwrap_or_default()
    }

    pub fn epoch(&self) -> Result<u64, JsError> {
        self.inner
            .epoch()
            .ok_or_else(|| JsError::new("inspect epoch failed: group is not initialized"))
    }

    #[wasm_bindgen(js_name = memberIdentities)]
    pub fn member_identities(&self) -> Result<Vec<u8>, JsError> {
        Ok(self.flat_members()?.0)
    }

    #[wasm_bindgen(js_name = memberIdentityLengths)]
    pub fn member_identity_lengths(&self) -> Result<Vec<u32>, JsError> {
        Ok(self.flat_members()?.1)
    }
}

#[wasm_bindgen(js_name = EphemonMlsAddMemberOutput)]
pub struct WasmAddMemberOutput {
    inner: AddMemberOutput,
}

#[wasm_bindgen(js_class = EphemonMlsAddMemberOutput)]
impl WasmAddMemberOutput {
    #[wasm_bindgen(getter, js_name = claimedIdentity)]
    pub fn claimed_identity(&self) -> Vec<u8> {
        self.inner.claimed_identity.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.inner.commit.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn welcome(&self) -> Vec<u8> {
        self.inner.welcome.clone()
    }
}

#[wasm_bindgen(js_name = EphemonMlsCommitFacts)]
pub struct WasmCommitFacts {
    inner: CommitFacts,
}

#[wasm_bindgen(js_class = EphemonMlsCommitFacts)]
impl WasmCommitFacts {
    #[wasm_bindgen(getter, js_name = senderIdentity)]
    pub fn sender_identity(&self) -> Vec<u8> {
        self.inner.sender_identity.clone()
    }

    #[wasm_bindgen(getter, js_name = senderIsMember)]
    pub fn sender_is_member(&self) -> bool {
        self.inner.sender_is_member
    }

    #[wasm_bindgen(getter)]
    pub fn added(&self) -> Vec<u8> {
        self.inner.added.concat()
    }

    #[wasm_bindgen(getter, js_name = addedLengths)]
    pub fn added_lengths(&self) -> Vec<u32> {
        self.inner
            .added
            .iter()
            .map(|item| item.len() as u32)
            .collect()
    }

    #[wasm_bindgen(getter, js_name = removedLeaves)]
    pub fn removed_leaves(&self) -> Vec<u32> {
        self.inner.removed_leaves.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn epoch(&self) -> u64 {
        self.inner.epoch
    }
}

#[wasm_bindgen(js_name = EphemonMlsProcessedApplicationMessage)]
pub struct WasmProcessedApplicationMessage {
    inner: ProcessedApplicationMessage,
}

#[wasm_bindgen(js_class = EphemonMlsProcessedApplicationMessage)]
impl WasmProcessedApplicationMessage {
    #[wasm_bindgen(getter, js_name = senderIdentity)]
    pub fn sender_identity(&self) -> Vec<u8> {
        self.inner.sender_identity.clone()
    }

    #[wasm_bindgen(getter, js_name = senderIsMember)]
    pub fn sender_is_member(&self) -> bool {
        self.inner.sender_is_member
    }

    #[wasm_bindgen(getter)]
    pub fn payload(&self) -> Vec<u8> {
        self.inner.payload.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALICE: &[u8] = b"alice";
    const BOB: &[u8] = b"bob";

    fn joined_pair() -> (MlsClient, MlsClient, AddMemberOutput) {
        let mut alice = MlsClient::new(ALICE.to_vec()).expect("Alice client");
        let mut bob = MlsClient::new(BOB.to_vec()).expect("Bob client");
        alice.create_group(b"ephemon-test-group").expect("group");
        let bob_key_package = bob.create_key_package().expect("Bob key package");
        let add = alice
            .stage_add_member(&bob_key_package)
            .expect("stage Bob add");
        alice.merge_pending_commit().expect("merge add commit");
        bob.join_from_welcome(&add.welcome).expect("Bob joins");
        (alice, bob, add)
    }

    #[test]
    fn exposes_the_current_abi_version() {
        assert_eq!(ephemon_mls_abi_version(), ABI_VERSION);
    }

    #[test]
    fn reports_what_a_key_package_claims_without_judging_it() {
        let mut alice = MlsClient::new(ALICE.to_vec()).expect("Alice client");
        let bob = MlsClient::new(BOB.to_vec()).expect("Bob client");
        alice.create_group(b"ephemon-test-group").expect("group");
        let key_package = bob.create_key_package().expect("Bob key package");

        let add = alice.stage_add_member(&key_package).expect("stage add");

        assert_eq!(add.claimed_identity, BOB.to_vec());
    }

    #[test]
    fn reports_the_sender_of_a_commit_and_moves_the_epoch_head() {
        let (mut alice, mut bob, _) = joined_pair();
        let before = alice.epoch_authenticator().expect("Alice head before");
        let commit = bob.create_self_update().expect("Bob self update");
        bob.merge_pending_commit()
            .expect("Bob merges its own commit");

        let facts = alice
            .process_incoming_commit(&commit)
            .expect("process commit");

        assert_eq!(facts.sender_identity, BOB.to_vec());
        assert!(facts.sender_is_member);
        assert!(facts.added.is_empty());
        assert!(facts.removed_leaves.is_empty());
        assert_eq!(facts.epoch, 2);
        assert_ne!(
            before,
            alice.epoch_authenticator().expect("Alice head after"),
            "a merged commit must move the epoch head"
        );
    }

    #[test]
    fn reports_the_roster_as_identities() {
        let (alice, bob, _) = joined_pair();

        assert_eq!(
            alice.member_identities().expect("Alice roster"),
            vec![ALICE.to_vec(), BOB.to_vec()]
        );
        assert_eq!(
            bob.member_identities().expect("Bob roster"),
            vec![ALICE.to_vec(), BOB.to_vec()]
        );
    }

    #[test]
    fn a_signature_verifies_for_the_author_and_for_nobody_else() {
        let (alice, bob, _) = joined_pair();
        let keys = alice.member_signature_keys().expect("roster keys");
        let identities = alice.member_identities().expect("roster identities");
        let alice_key = &keys[identities
            .iter()
            .position(|id| id == &ALICE.to_vec())
            .expect("Alice")];
        let bob_key = &keys[identities
            .iter()
            .position(|id| id == &BOB.to_vec())
            .expect("Bob")];

        let signature = alice.sign(b"an authored event").expect("signature");

        assert!(bob.verify(alice_key, b"an authored event", &signature));
        assert!(!bob.verify(bob_key, b"an authored event", &signature));
        assert!(!bob.verify(alice_key, b"a different event", &signature));
    }

    #[test]
    fn a_signature_does_not_verify_without_the_label() {
        let (alice, bob, _) = joined_pair();
        let keys = alice.member_signature_keys().expect("roster keys");
        let identities = alice.member_identities().expect("roster identities");
        let alice_key = &keys[identities
            .iter()
            .position(|id| id == &ALICE.to_vec())
            .expect("Alice")];

        let signature = alice.sign(b"an authored event").expect("signature");

        assert!(
            !bob.provider
                .crypto()
                .verify_signature(
                    CIPHERSUITE.signature_algorithm(),
                    b"an authored event",
                    alice_key,
                    &signature,
                )
                .is_ok()
        );
    }

    #[test]
    fn a_rekey_keeps_the_signature_key_that_authored_events_are_verified_against() {
        let (mut alice, mut bob, _) = joined_pair();
        let identities = alice.member_identities().expect("identities");
        let alice_index = identities
            .iter()
            .position(|id| id == &ALICE.to_vec())
            .expect("Alice");
        let before = bob.member_signature_keys().expect("keys before")[alice_index].clone();
        let signature = alice.sign(b"authored before the rekey").expect("signature");
        assert!(bob.verify(&before, b"authored before the rekey", &signature));

        let commit = alice.create_self_update().expect("self update");
        alice.merge_pending_commit().expect("merge");
        bob.process_incoming_commit(&commit).expect("process");
        bob.merge_pending_commit().expect("merge on Bob");

        let after = bob.member_signature_keys().expect("keys after")[alice_index].clone();
        assert_eq!(
            before, after,
            "a rekey must not orphan signatures made under the previous key"
        );
    }

    #[test]
    fn reports_the_sender_of_an_application_message() {
        let (mut alice, mut bob, _) = joined_pair();
        let message = bob
            .create_application_message(b"from bob")
            .expect("Bob message");

        let processed = alice
            .process_application_message(&message)
            .expect("Alice reads it");

        assert_eq!(processed.sender_identity, BOB.to_vec());
        assert!(processed.sender_is_member);
        assert_eq!(processed.payload, b"from bob".to_vec());
    }

    #[test]
    fn restores_a_group_from_the_parts_it_hands_out() {
        let (alice, _, _) = joined_pair();
        let snapshot = alice.storage_snapshot().expect("snapshot");
        let count = u32::from_be_bytes(snapshot[0..4].try_into().unwrap()) as usize;
        let key_bytes = u32::from_be_bytes(snapshot[4..8].try_into().unwrap()) as usize;
        let read_lengths = |offset: usize| -> Vec<u32> {
            (0..count)
                .map(|index| {
                    let at = offset + index * 4;
                    u32::from_be_bytes(snapshot[at..at + 4].try_into().unwrap())
                })
                .collect()
        };
        let key_lengths = read_lengths(8);
        let blob_lengths = read_lengths(8 + count * 4);
        let blobs_at = 8 + count * 8;
        let keys = snapshot[blobs_at..blobs_at + key_bytes].to_vec();
        let blobs = snapshot[blobs_at + key_bytes..].to_vec();
        let signing_public_key = alice.signing_public_key();
        let group_id = alice.group_id().expect("group id");

        let restored = MlsClient::restore(
            ALICE.to_vec(),
            &signing_public_key,
            &group_id,
            &keys,
            &key_lengths,
            &blobs,
            &blob_lengths,
        )
        .expect("restore");

        assert_eq!(restored.identity(), ALICE.to_vec());
        assert_eq!(restored.epoch(), alice.epoch());
        assert_eq!(
            restored.member_identities().expect("roster"),
            alice.member_identities().expect("roster")
        );
    }

    #[test]
    fn refuses_entries_that_repeat_a_storage_key() {
        let keys = b"same-keysame-key";
        let blobs = b"valuevalue";

        assert!(
            MlsClient::restore(ALICE.to_vec(), b"key", b"", keys, &[8, 8], blobs, &[5, 5]).is_err()
        );
    }

    #[test]
    fn refuses_halves_that_disagree() {
        assert!(
            MlsClient::restore(ALICE.to_vec(), b"key", b"", b"key", &[3], b"value", &[5, 1])
                .is_err()
        );
        assert!(
            MlsClient::restore(ALICE.to_vec(), b"key", b"", b"key", &[9], b"value", &[5]).is_err()
        );
    }
}
