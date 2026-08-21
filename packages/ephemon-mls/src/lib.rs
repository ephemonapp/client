use std::collections::HashMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

use openmls::prelude::tls_codec::Deserialize as TlsDeserialize;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use openmls_traits::types::Ciphersuite;
use wasm_bindgen::prelude::*;

pub const ABI_VERSION: u32 = 3;

const CHECKPOINT_MAGIC: &[u8; 8] = b"EPHMLSCP";
const CHECKPOINT_VERSION: u16 = 1;
const MAX_CHECKPOINT_BYTES: usize = 64 * 1024 * 1024;
const MAX_CHECKPOINT_ENTRIES: usize = 16_384;
const MAX_CHECKPOINT_FIELD_BYTES: usize = 16 * 1024 * 1024;
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
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitOutcome {
    pub sender_member_number: u32,
    pub epoch: u64,
    pub added: Vec<u32>,
    pub removed: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessedApplicationMessage {
    pub sender_member_number: u32,
    pub payload: Vec<u8>,
}

pub struct MlsClient {
    member_number: u32,
    credential: CredentialWithKey,
    signer: SignatureKeyPair,
    provider: OpenMlsRustCrypto,
    group: Option<MlsGroup>,
}

impl MlsClient {
    pub fn new(member_number: u32) -> Result<Self, MlsFacadeError> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
            .map_err(|error| MlsFacadeError::debug("generate group signing key", error))?;
        signer
            .store(provider.storage())
            .map_err(|error| MlsFacadeError::debug("store group signing key", error))?;
        let credential = credential_for(member_number, &signer);

        Ok(Self {
            member_number,
            credential,
            signer,
            provider,
            group: None,
        })
    }

    pub fn member_number(&self) -> u32 {
        self.member_number
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
        authorized_committers: &[u32],
    ) -> Result<CommitOutcome, MlsFacadeError> {
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
        let sender_member_number = member_number_from_credential(processed.credential())?;
        let staged = match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => *staged,
            _ => {
                return Err(MlsFacadeError::new(
                    "process commit",
                    "processed MLS content is not a commit",
                ));
            }
        };
        if !authorized_committers.contains(&sender_member_number) {
            return Err(MlsFacadeError::new(
                "authorize commit",
                "committer is not authorized by the conversation policy",
            ));
        }
        let added = staged
            .add_proposals()
            .map(|proposal| {
                member_number_from_credential(
                    proposal
                        .add_proposal()
                        .key_package()
                        .leaf_node()
                        .credential(),
                )
            })
            .collect::<Result<Vec<u32>, MlsFacadeError>>()?;
        let removed = staged
            .remove_proposals()
            .map(|proposal| proposal.remove_proposal().removed().u32())
            .collect::<Vec<u32>>();
        group
            .merge_staged_commit(provider, staged)
            .map_err(|error| MlsFacadeError::debug("merge staged commit", error))?;
        Ok(CommitOutcome {
            sender_member_number,
            epoch: group.epoch().as_u64(),
            added,
            removed,
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
        let staged = StagedWelcome::new_from_welcome(
            &self.provider,
            &MlsGroupJoinConfig::default(),
            welcome,
            None,
        )
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
        let sender_member_number = member_number_from_credential(processed.credential())?;
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
            sender_member_number,
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

    pub fn member_numbers(&self) -> Result<Vec<u32>, MlsFacadeError> {
        let group = self
            .group
            .as_ref()
            .ok_or_else(|| MlsFacadeError::new("inspect members", "group is not initialized"))?;
        group
            .members()
            .map(|member| member_number_from_credential(&member.credential))
            .collect()
    }

    pub fn export_checkpoint(&self) -> Result<Vec<u8>, MlsFacadeError> {
        let values =
            self.provider.storage().values.read().map_err(|_| {
                MlsFacadeError::new("export checkpoint", "storage lock is poisoned")
            })?;
        if values.len() > MAX_CHECKPOINT_ENTRIES {
            return Err(MlsFacadeError::new(
                "export checkpoint",
                "storage entry limit exceeded",
            ));
        }
        let mut entries: Vec<_> = values.iter().collect();
        entries.sort_by(|(left, _), (right, _)| left.cmp(right));

        let mut checkpoint = Vec::new();
        checkpoint.extend_from_slice(CHECKPOINT_MAGIC);
        checkpoint.extend_from_slice(&CHECKPOINT_VERSION.to_be_bytes());
        checkpoint.extend_from_slice(&self.member_number.to_be_bytes());
        write_field(&mut checkpoint, self.signer.public(), "signing public key")?;
        write_field(
            &mut checkpoint,
            self.group_id().as_deref().unwrap_or_default(),
            "group id",
        )?;
        write_u32(&mut checkpoint, entries.len(), "storage entry count")?;
        for (key, value) in entries {
            write_field(&mut checkpoint, key, "storage key")?;
            write_field(&mut checkpoint, value, "storage value")?;
        }
        if checkpoint.len() > MAX_CHECKPOINT_BYTES {
            return Err(MlsFacadeError::new(
                "export checkpoint",
                "checkpoint byte limit exceeded",
            ));
        }
        Ok(checkpoint)
    }

    pub fn import_checkpoint(checkpoint: &[u8]) -> Result<Self, MlsFacadeError> {
        if checkpoint.len() > MAX_CHECKPOINT_BYTES {
            return Err(MlsFacadeError::new(
                "import checkpoint",
                "checkpoint byte limit exceeded",
            ));
        }
        let mut reader = CheckpointReader::new(checkpoint);
        if reader.take(CHECKPOINT_MAGIC.len())? != CHECKPOINT_MAGIC {
            return Err(MlsFacadeError::new(
                "import checkpoint",
                "checkpoint magic does not match",
            ));
        }
        let version = reader.read_u16()?;
        if version != CHECKPOINT_VERSION {
            return Err(MlsFacadeError::new(
                "import checkpoint",
                format!("unsupported checkpoint version {version}"),
            ));
        }
        let member_number = reader.read_u32()?;
        let signing_public_key = reader.read_field()?.to_vec();
        let group_id = reader.read_field()?.to_vec();
        let entry_count = reader.read_u32()? as usize;
        if entry_count > MAX_CHECKPOINT_ENTRIES {
            return Err(MlsFacadeError::new(
                "import checkpoint",
                "storage entry limit exceeded",
            ));
        }
        let mut entries = HashMap::with_capacity(entry_count);
        for _ in 0..entry_count {
            let key = reader.read_field()?.to_vec();
            let value = reader.read_field()?.to_vec();
            if entries.insert(key, value).is_some() {
                return Err(MlsFacadeError::new(
                    "import checkpoint",
                    "duplicate storage key",
                ));
            }
        }
        reader.finish()?;

        let provider = OpenMlsRustCrypto::default();
        {
            let mut values = provider.storage().values.write().map_err(|_| {
                MlsFacadeError::new("import checkpoint", "storage lock is poisoned")
            })?;
            *values = entries;
        }
        let signer = SignatureKeyPair::read(
            provider.storage(),
            &signing_public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .ok_or_else(|| MlsFacadeError::new("import checkpoint", "group signing key is missing"))?;
        let credential = credential_for(member_number, &signer);
        let group = if group_id.is_empty() {
            None
        } else {
            MlsGroup::load(provider.storage(), &GroupId::from_slice(&group_id))
                .map_err(|error| MlsFacadeError::debug("load group checkpoint", error))?
                .ok_or_else(|| {
                    MlsFacadeError::new("load group checkpoint", "group state is missing")
                })?
                .into()
        };

        Ok(Self {
            member_number,
            credential,
            signer,
            provider,
            group,
        })
    }
}

fn credential_for(member_number: u32, signer: &SignatureKeyPair) -> CredentialWithKey {
    CredentialWithKey {
        credential: BasicCredential::new(member_number.to_be_bytes().to_vec()).into(),
        signature_key: signer.to_public_vec().into(),
    }
}

fn member_number_from_credential(credential: &Credential) -> Result<u32, MlsFacadeError> {
    let bytes = credential.serialized_content();
    let encoded: [u8; 4] = bytes.try_into().map_err(|_| {
        MlsFacadeError::new(
            "decode member number",
            "BasicCredential identity must contain exactly four bytes",
        )
    })?;
    Ok(u32::from_be_bytes(encoded))
}

fn deserialize_mls_message(
    operation: &'static str,
    bytes: &[u8],
) -> Result<MlsMessageIn, MlsFacadeError> {
    MlsMessageIn::tls_deserialize_exact(bytes.to_vec())
        .map_err(|error| MlsFacadeError::debug(operation, error))
}

fn write_u32(
    output: &mut Vec<u8>,
    value: usize,
    field: &'static str,
) -> Result<(), MlsFacadeError> {
    let value = u32::try_from(value)
        .map_err(|_| MlsFacadeError::new("export checkpoint", format!("{field} is too large")))?;
    output.extend_from_slice(&value.to_be_bytes());
    Ok(())
}

fn write_field(
    output: &mut Vec<u8>,
    value: &[u8],
    field: &'static str,
) -> Result<(), MlsFacadeError> {
    if value.len() > MAX_CHECKPOINT_FIELD_BYTES {
        return Err(MlsFacadeError::new(
            "export checkpoint",
            format!("{field} exceeds its byte limit"),
        ));
    }
    write_u32(output, value.len(), field)?;
    output.extend_from_slice(value);
    Ok(())
}

struct CheckpointReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> CheckpointReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], MlsFacadeError> {
        let end = self.offset.checked_add(length).ok_or_else(|| {
            MlsFacadeError::new("import checkpoint", "checkpoint length overflow")
        })?;
        if end > self.bytes.len() {
            return Err(MlsFacadeError::new(
                "import checkpoint",
                "checkpoint is truncated",
            ));
        }
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    fn read_u16(&mut self) -> Result<u16, MlsFacadeError> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| MlsFacadeError::new("import checkpoint", "invalid u16"))?;
        Ok(u16::from_be_bytes(bytes))
    }

    fn read_u32(&mut self) -> Result<u32, MlsFacadeError> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| MlsFacadeError::new("import checkpoint", "invalid u32"))?;
        Ok(u32::from_be_bytes(bytes))
    }

    fn read_field(&mut self) -> Result<&'a [u8], MlsFacadeError> {
        let length = self.read_u32()? as usize;
        if length > MAX_CHECKPOINT_FIELD_BYTES {
            return Err(MlsFacadeError::new(
                "import checkpoint",
                "checkpoint field exceeds its byte limit",
            ));
        }
        self.take(length)
    }

    fn finish(self) -> Result<(), MlsFacadeError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(MlsFacadeError::new(
                "import checkpoint",
                "checkpoint contains trailing bytes",
            ))
        }
    }
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
    pub fn new(member_number: u32) -> Result<WasmMlsClient, JsError> {
        Ok(Self {
            inner: MlsClient::new(member_number).map_err(as_js_error)?,
        })
    }

    #[wasm_bindgen(js_name = importCheckpoint)]
    pub fn import_checkpoint(checkpoint: &[u8]) -> Result<WasmMlsClient, JsError> {
        Ok(Self {
            inner: MlsClient::import_checkpoint(checkpoint).map_err(as_js_error)?,
        })
    }

    #[wasm_bindgen(getter, js_name = memberNumber)]
    pub fn member_number(&self) -> u32 {
        self.inner.member_number()
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
    pub fn process_incoming_commit(
        &mut self,
        message: &[u8],
        authorized_committers: Vec<u32>,
    ) -> Result<WasmCommitOutcome, JsError> {
        Ok(WasmCommitOutcome {
            inner: self
                .inner
                .process_incoming_commit(message, &authorized_committers)
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

    #[wasm_bindgen(js_name = exportCheckpoint)]
    pub fn export_checkpoint(&self) -> Result<Vec<u8>, JsError> {
        self.inner.export_checkpoint().map_err(as_js_error)
    }

    pub fn epoch(&self) -> Result<u64, JsError> {
        self.inner
            .epoch()
            .ok_or_else(|| JsError::new("inspect epoch failed: group is not initialized"))
    }

    #[wasm_bindgen(js_name = memberNumbers)]
    pub fn member_numbers(&self) -> Result<Vec<u32>, JsError> {
        self.inner.member_numbers().map_err(as_js_error)
    }
}

#[wasm_bindgen(js_name = EphemonMlsAddMemberOutput)]
pub struct WasmAddMemberOutput {
    inner: AddMemberOutput,
}

#[wasm_bindgen(js_class = EphemonMlsAddMemberOutput)]
impl WasmAddMemberOutput {
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.inner.commit.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn welcome(&self) -> Vec<u8> {
        self.inner.welcome.clone()
    }
}

#[wasm_bindgen(js_name = EphemonMlsCommitOutcome)]
pub struct WasmCommitOutcome {
    inner: CommitOutcome,
}

#[wasm_bindgen(js_class = EphemonMlsCommitOutcome)]
impl WasmCommitOutcome {
    #[wasm_bindgen(getter, js_name = senderMemberNumber)]
    pub fn sender_member_number(&self) -> u32 {
        self.inner.sender_member_number
    }

    #[wasm_bindgen(getter)]
    pub fn epoch(&self) -> u64 {
        self.inner.epoch
    }

    #[wasm_bindgen(getter)]
    pub fn added(&self) -> Vec<u32> {
        self.inner.added.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn removed(&self) -> Vec<u32> {
        self.inner.removed.clone()
    }
}

#[wasm_bindgen(js_name = EphemonMlsProcessedApplicationMessage)]
pub struct WasmProcessedApplicationMessage {
    inner: ProcessedApplicationMessage,
}

#[wasm_bindgen(js_class = EphemonMlsProcessedApplicationMessage)]
impl WasmProcessedApplicationMessage {
    #[wasm_bindgen(getter, js_name = senderMemberNumber)]
    pub fn sender_member_number(&self) -> u32 {
        self.inner.sender_member_number
    }

    #[wasm_bindgen(getter)]
    pub fn payload(&self) -> Vec<u8> {
        self.inner.payload.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined_pair() -> (MlsClient, MlsClient, AddMemberOutput) {
        let mut alice = MlsClient::new(0).expect("Alice client");
        let mut bob = MlsClient::new(1).expect("Bob client");
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
    fn refuses_a_commit_from_a_member_the_policy_does_not_authorize() {
        let (mut alice, mut bob, _) = joined_pair();
        let commit = bob.create_self_update().expect("Bob self update");
        bob.merge_pending_commit()
            .expect("Bob merges its own commit");

        let refused = alice.process_incoming_commit(&commit, &[0]);
        assert!(refused.is_err(), "an unauthorized commit must not merge");
        assert_eq!(
            alice.epoch(),
            Some(1),
            "a refused commit must not advance the epoch"
        );
    }

    #[test]
    fn merges_a_commit_from_an_authorized_member_and_moves_the_epoch_head() {
        let (mut alice, mut bob, _) = joined_pair();
        let before = alice.epoch_authenticator().expect("Alice head before");
        let commit = bob.create_self_update().expect("Bob self update");
        bob.merge_pending_commit()
            .expect("Bob merges its own commit");

        let outcome = alice
            .process_incoming_commit(&commit, &[0, 1])
            .expect("authorized commit merges");
        assert_eq!(outcome.sender_member_number, 1);
        assert_eq!(outcome.epoch, 2);
        assert!(outcome.added.is_empty());
        assert!(outcome.removed.is_empty());
        assert_eq!(alice.epoch(), Some(2));
        assert_eq!(bob.epoch(), Some(2));

        let after = alice.epoch_authenticator().expect("Alice head after");
        assert_ne!(before, after, "a merged commit must move the epoch head");
        assert_eq!(
            after,
            bob.epoch_authenticator().expect("Bob head after"),
            "both members must agree on the epoch head"
        );

        let encrypted = bob
            .create_application_message(b"after the epoch change")
            .expect("Bob MLS message");
        let processed = alice
            .process_application_message(&encrypted)
            .expect("Alice processes the new epoch message");
        assert_eq!(processed.sender_member_number, 1);
        assert_eq!(processed.payload, b"after the epoch change");
    }

    #[test]
    fn exchanges_authenticated_application_messages_between_two_members() {
        let (mut alice, mut bob, add) = joined_pair();

        assert!(!add.commit.is_empty());
        assert!(!add.welcome.is_empty());
        assert_eq!(
            deserialize_mls_message("test commit", &add.commit)
                .expect("deserialize commit")
                .wire_format(),
            WireFormat::PrivateMessage
        );
        assert_eq!(alice.epoch(), Some(1));
        assert_eq!(bob.epoch(), Some(1));
        assert_eq!(alice.member_numbers().expect("Alice roster"), vec![0, 1]);
        assert_eq!(bob.member_numbers().expect("Bob roster"), vec![0, 1]);

        let encrypted = alice
            .create_application_message(b"hello from member zero")
            .expect("Alice MLS message");
        assert_eq!(
            deserialize_mls_message("test application message", &encrypted)
                .expect("deserialize application message")
                .wire_format(),
            WireFormat::PrivateMessage
        );
        assert!(
            !encrypted
                .windows(b"hello from member zero".len())
                .any(|window| window == b"hello from member zero")
        );
        assert!(
            !encrypted
                .windows(alice.signer.public().len())
                .any(|window| window == alice.signer.public())
        );
        let processed = bob
            .process_application_message(&encrypted)
            .expect("Bob processes Alice message");
        assert_eq!(processed.sender_member_number, 0);
        assert_eq!(processed.payload, b"hello from member zero");

        let reply = bob
            .create_application_message(b"hello from member one")
            .expect("Bob MLS message");
        let processed = alice
            .process_application_message(&reply)
            .expect("Alice processes Bob message");
        assert_eq!(processed.sender_member_number, 1);
        assert_eq!(processed.payload, b"hello from member one");
    }

    #[test]
    fn restores_both_clients_and_continues_the_same_group() {
        let (mut alice, mut bob, _) = joined_pair();
        let before_restart = alice
            .create_application_message(b"before restart")
            .expect("pre-restart message");
        bob.process_application_message(&before_restart)
            .expect("pre-restart process");

        let alice_checkpoint = alice.export_checkpoint().expect("Alice checkpoint");
        let bob_checkpoint = bob.export_checkpoint().expect("Bob checkpoint");
        let mut alice = MlsClient::import_checkpoint(&alice_checkpoint).expect("restore Alice");
        let mut bob = MlsClient::import_checkpoint(&bob_checkpoint).expect("restore Bob");

        assert_eq!(alice.epoch(), Some(1));
        assert_eq!(bob.epoch(), Some(1));
        let after_restart = bob
            .create_application_message(b"after restart")
            .expect("post-restart message");
        let processed = alice
            .process_application_message(&after_restart)
            .expect("post-restart process");
        assert_eq!(processed.sender_member_number, 1);
        assert_eq!(processed.payload, b"after restart");
    }

    #[test]
    fn rejects_truncated_and_trailing_checkpoint_data() {
        let (alice, _, _) = joined_pair();
        let checkpoint = alice.export_checkpoint().expect("checkpoint");
        assert!(MlsClient::import_checkpoint(&checkpoint[..checkpoint.len() - 1]).is_err());

        let mut trailing = checkpoint;
        trailing.push(0);
        assert!(MlsClient::import_checkpoint(&trailing).is_err());
    }
}
