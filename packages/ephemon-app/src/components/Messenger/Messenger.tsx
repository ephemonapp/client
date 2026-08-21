import { useConnectionCallbacksCache } from '../../hooks/useConnectionCallbacksCache';
import { useEphemon } from '../../hooks/useEphemon';
import { useIdleLock } from '../../hooks/useIdleLock';
import { useMediaQuery, MOBILE_QUERY } from '../../hooks/useMediaQuery';
import { PasswordState } from '../../hooks/usePasswordCheck';
import { useSearchParams } from '../../hooks/useSearchParams';
import {
    getActiveConversation,
    setActiveConversation,
    setConnectionNotice,
    setConnectionState,
    setConnectionTransport,
    subscribeActiveConversation,
} from '../../lib/connectionStore';
import { contactCode, readContact } from '../../lib/contact';
import { diagnose } from '../../lib/diagnose';
import { displayName, shortKey } from '../../lib/identicon';
import { getSettings } from '../../lib/settingsStore';
import { UiConnectionState } from '../../lib/status';
import { ConversationId } from '../../types/conversation';
import { showNotification } from '../../utils/functions';
import BlockedModal from '../modals/BlockedModal';
import ConnectModal from '../modals/ConnectModal';
import ContactPickerModal, { PickableContact } from '../modals/ContactPickerModal';
import IdleLockModal from '../modals/IdleLockModal';
import IncomingDialModal from '../modals/IncomingDialModal';
import Modal from '../modals/Modal';
import PrivacyModal from '../modals/PrivacyModal';
import QrModal from '../modals/QrModal';
import ReceiptListModal, { ReceiptListEntry } from '../modals/ReceiptListModal';
import RenameModal from '../modals/RenameModal';
import ScannerModal from '../modals/ScannerModal';
import UpdateModal from '../modals/UpdateModal';
import './Chat/Chat.css';
import ChatPane from './Chat/ChatPane';
import EmptyStateSlot from './Chat/EmptyStateSlot';
import './Messenger.css';
import { ConversationRowData } from './Sidebar/ConversationRow';
import Sidebar from './Sidebar/Sidebar';
import { Connection, ConnectionError, ConnectionState, ConnectionTransport } from '@ephemon/core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ModalState =
    | null
    | { kind: 'qr'; own: boolean; title: string; subtitle: string; keyText: string }
    | { kind: 'scanner' }
    | { kind: 'privacy' }
    | { kind: 'rename'; id: ConversationId; current: string }
    | { kind: 'addMember'; id: ConversationId }
    | { kind: 'newGroup' }
    | { kind: 'memberName'; id: ConversationId; current: string }
    | { kind: 'incomingDial'; publicKey: string; decide: (accepted: boolean, block: boolean) => void }
    | { kind: 'blocked' }
    | { kind: 'receipts'; entries: ReadonlyArray<ReceiptListEntry> };

type MessengerProps = {
    passwordState: PasswordState;
    onPermissionDefault: () => Promise<void>;
    onPermissionGranted: () => Promise<void>;
    onPermissionDenied: () => Promise<void>;
    onPublicKey: (publicKey: string | undefined) => void;
};

function normalizeState(state: ConnectionState): UiConnectionState {
    if (state === ConnectionState.Open) return 'open';
    if (state === ConnectionState.Degraded) return 'degraded';
    if (state === ConnectionState.Connecting) return 'connecting';
    return 'closed';
}

const Messenger: React.FC<MessengerProps> = ({
    passwordState,
    onPermissionDefault,
    onPermissionGranted,
    onPermissionDenied,
    onPublicKey,
}) => {
    const isMobile = useMediaQuery(MOBILE_QUERY);

    const [pane, setPane] = useState<'list' | 'chat'>('list');
    const [showConnectMobile, setShowConnectMobile] = useState(false);
    const [modal, setModal] = useState<ModalState>(null);
    const [updateDismissed, setUpdateDismissed] = useState(false);

    const focusOnDial = useCallback(() => Promise.resolve(true), []);
    const requestDial = useCallback((peerKey: string, alreadyExists: boolean) => {
        if (alreadyExists) return Promise.resolve(true);
        if (document.hidden || !document.hasFocus()) {
            showNotification('Incoming connection', { body: shortKey(peerKey) });
        }
        return new Promise<boolean>((resolve) => {
            setModal({
                kind: 'incomingDial',
                publicKey: peerKey,
                decide: (accepted: boolean, block: boolean) => {
                    setModal(null);
                    if (block) conversationsRef.current.blocked.block(peerKey);
                    resolve(accepted);
                },
            });
        });
    }, []);
    const onIncomingConnection = useCallback(() => {
        setPane('chat');
        setShowConnectMobile(false);
    }, []);
    const onConnectionStateChanged = useCallback(
        (conversationId: ConversationId, _connection: Connection, _from: ConnectionState, to: ConnectionState) => {
            setConnectionState(conversationId, normalizeState(to));
        },
        [],
    );
    const onConnectionTransportChanged = useCallback(
        (conversationId: ConversationId, _connection: Connection, transport: ConnectionTransport) => {
            setConnectionTransport(conversationId, transport);
        },
        [],
    );
    const onConnectionError = useCallback(
        (conversationId: ConversationId, _connection: Connection, error: ConnectionError) => {
            diagnose(error.issue, error.serverUrl)
                .then((code) => setConnectionNotice(conversationId, { code, serverUrl: error.serverUrl }))
                .catch(() => setConnectionNotice(conversationId, { code: error.issue, serverUrl: error.serverUrl }));
        },
        [],
    );

    const [publicKey, metadata, conversations] = useEphemon(
        passwordState,
        onPermissionDefault,
        onPermissionGranted,
        onPermissionDenied,
        focusOnDial,
        requestDial,
        onIncomingConnection,
        onConnectionStateChanged,
        onConnectionTransportChanged,
        onConnectionError,
    );

    const needUpdate = metadata.needUpdate;

    useEffect(() => {
        onPublicKey(publicKey ?? undefined);
    }, [publicKey, onPublicKey]);

    const callbacksFor = useConnectionCallbacksCache(conversations.callbacks);

    const conversationsRef = useRef(conversations);
    conversationsRef.current = conversations;
    const publicKeyRef = useRef(publicKey);
    publicKeyRef.current = publicKey;

    const [debugSelfConnectValue] = useSearchParams('__debug_self_connect');
    const {
        create: createConnection,
        callbacks: {
            lifecycle: { open: openConnection },
        },
    } = conversations;
    useEffect(() => {
        if (publicKey && debugSelfConnectValue === 'true') {
            const id = createConnection(publicKey);
            if (id !== undefined) openConnection(id).catch(console.error);
        }
    }, [publicKey, createConnection, openConnection, debugSelfConnectValue]);

    const rows: Array<ConversationRowData> = conversations.available;
    const ids = useMemo(
        () => conversations.available.map((conversation) => conversation.id),
        [conversations.available],
    );

    useEffect(() => {
        if (!isMobile) return;
        const check = () => {
            if (getActiveConversation() === undefined) setPane('list');
        };
        check();
        return subscribeActiveConversation(check);
    }, [isMobile]);

    const showList = !isMobile || pane === 'list';
    const showChat = !isMobile || pane === 'chat';

    const doConnect = useCallback((rawCode: string) => {
        const contact = readContact(rawCode);
        if (!contact) return;
        const { create, callbacks } = conversationsRef.current;
        const id = create(contact.publicKey, contact.serverUrl);
        if (id !== undefined) {
            setConnectionNotice(id, undefined);
            callbacks.lifecycle.open(id).catch(() => {});
        }
        setModal(null);
        setShowConnectMobile(false);
        setPane('chat');
    }, []);

    const ownGroupName = useCallback((id: ConversationId): string | undefined => {
        const conversation = conversationsRef.current.available.find((candidate) => candidate.id === id);
        if (conversation?.kind !== 'group') return undefined;
        return conversation.mlsBootstrap?.roster?.find((member) => member.publicKey === publicKeyRef.current)?.name;
    }, []);

    const openMemberName = useCallback(
        (id: ConversationId) => setModal({ kind: 'memberName', id, current: ownGroupName(id) ?? '' }),
        [ownGroupName],
    );

    const onSaveMemberName = useCallback(
        (name: string) => {
            if (modal?.kind !== 'memberName') return;
            const trimmed = name.trim();
            if (trimmed.length === 0) return;
            conversationsRef.current.callbacks.view.setMemberName(modal.id, trimmed);
            setModal(null);
        },
        [modal],
    );

    const onIntroduce = useCallback((id: ConversationId, name: string) => {
        const trimmed = name.trim();
        if (trimmed.length === 0) return;
        conversationsRef.current.callbacks.view.setMemberName(id, trimmed);
    }, []);

    const onSelect = useCallback(
        (id: ConversationId) => {
            setActiveConversation(id);
            if (isMobile) setPane('chat');
        },
        [isMobile],
    );

    const onLock = useCallback(() => window.location.reload(), []);

    const [debugIdleMs] = useSearchParams('__debug_idle_ms');
    const idleLimit = debugIdleMs ? Number(debugIdleMs) : undefined;
    const { remaining: idleRemaining, extend: stayUnlocked } = useIdleLock(
        true,
        onLock,
        Number.isFinite(idleLimit) ? idleLimit : undefined,
    );
    const onScan = useCallback(() => setModal({ kind: 'scanner' }), []);
    const onPrivacy = useCallback(() => setModal({ kind: 'privacy' }), []);
    const onBlocked = useCallback(() => setModal({ kind: 'blocked' }), []);
    const onReceipts = useCallback(
        (entries: ReadonlyArray<ReceiptListEntry>) => setModal({ kind: 'receipts', entries }),
        [],
    );
    const onUnblock = useCallback((publicKey: string) => conversationsRef.current.blocked.unblock(publicKey), []);
    const onFab = useCallback(() => setShowConnectMobile(true), []);
    const onCloseConnectMobile = useCallback(() => setShowConnectMobile(false), []);
    const onDismissUpdate = useCallback(() => setUpdateDismissed(true), []);
    const onApplyUpdate = useCallback(() => window.location.reload(), []);
    const closeModal = useCallback(() => setModal(null), []);
    const onBackToList = useCallback(() => setPane('list'), []);

    const openMyQr = useCallback(() => {
        setModal({
            kind: 'qr',
            own: true,
            title: `Your ${process.env.EPHEMON_APP_NAME} code`,
            subtitle: 'Others scan this to start a chat with you',
            keyText: publicKey ? contactCode(publicKey, getSettings().serverUrl) : '',
        });
    }, [publicKey]);

    const openPeerQr = useCallback((peerKey: string, name: string | undefined) => {
        const known = conversationsRef.current.available.find((candidate) => candidate.publicKey === peerKey);
        setModal({
            kind: 'qr',
            own: false,
            title: `${displayName(name, peerKey)}'s code`,
            subtitle: 'Share this so others can add this contact',
            keyText: contactCode(peerKey, known?.serverUrl ?? getSettings().serverUrl),
        });
    }, []);

    const openRename = useCallback((id: ConversationId, current: string) => {
        setModal({ kind: 'rename', id, current });
    }, []);

    const openAddMember = useCallback((id: ConversationId) => {
        setModal({ kind: 'addMember', id });
    }, []);

    const openNewGroup = useCallback(() => setModal({ kind: 'newGroup' }), []);

    const rosterKeysOf = useCallback((id: ConversationId): Array<string> => {
        const conversation = conversationsRef.current.available.find((candidate) => candidate.id === id);
        return (conversation?.mlsBootstrap?.roster ?? []).map((member) => member.publicKey);
    }, []);

    const contactsExcept = useCallback((excluded: ReadonlyArray<string>): Array<PickableContact> => {
        return conversationsRef.current.available
            .filter(
                (conversation) =>
                    conversation.kind === 'direct' &&
                    conversation.publicKey !== publicKeyRef.current &&
                    !excluded.includes(conversation.publicKey),
            )
            .map((conversation) => ({ publicKey: conversation.publicKey, name: conversation.name }));
    }, []);

    const contactsOf = useCallback(
        (keys: ReadonlyArray<string>): Array<{ publicKey: string; serverUrl?: string }> =>
            keys.map((key) => ({
                publicKey: key,
                serverUrl: conversationsRef.current.available.find(
                    (conversation) => conversation.kind === 'direct' && conversation.publicKey === key,
                )?.serverUrl,
            })),
        [],
    );

    const groupNameOf = useCallback(
        (keys: ReadonlyArray<string>): string =>
            keys
                .map((key) => {
                    const known = conversationsRef.current.available.find(
                        (conversation) => conversation.kind === 'direct' && conversation.publicKey === key,
                    );
                    return displayName(known?.name, key);
                })
                .join(', '),
        [],
    );

    const onCreateGroup = useCallback(
        (keys: ReadonlyArray<string>, ownName: string) => {
            setModal(null);
            conversationsRef.current.createGroup(contactsOf(keys), groupNameOf(keys), ownName).catch(() => {});
            if (isMobile) setPane('chat');
        },
        [contactsOf, groupNameOf, isMobile],
    );

    const onAddMember = useCallback(
        (id: ConversationId, keys: ReadonlyArray<string>) => {
            setModal(null);
            const lifecycle = conversationsRef.current.callbacks.lifecycle;
            for (const member of contactsOf(keys)) {
                lifecycle.addMember(id, member.publicKey, member.serverUrl).catch(() => {});
            }
        },
        [contactsOf],
    );

    const onDeleteConversation = useCallback((id: ConversationId) => {
        conversationsRef.current.callbacks.lifecycle.delete(id).catch(() => {});
        setPane('list');
    }, []);

    const onScanFromConnectModal = useCallback(() => {
        setShowConnectMobile(false);
        setModal({ kind: 'scanner' });
    }, []);

    const onSaveRename = useCallback(
        (name: string) => {
            if (modal?.kind !== 'rename') return;
            conversationsRef.current.callbacks.view.setName(modal.id, name || undefined);
            setModal(null);
        },
        [modal],
    );

    if (publicKey === undefined || publicKey === null) {
        return null;
    }

    return (
        <div className={`messenger${isMobile ? ' messenger--mobile' : ''}`}>
            {showList && (
                <Sidebar
                    isMobile={isMobile}
                    onShowMyQr={openMyQr}
                    myQrOpen={modal?.kind === 'qr' && modal.own}
                    onLock={onLock}
                    onConnect={doConnect}
                    onScan={onScan}
                    connectVisible={!isMobile}
                    showFab={isMobile && pane === 'list' && !showConnectMobile}
                    onFab={onFab}
                    conversations={rows}
                    onSelect={onSelect}
                    onPrivacy={onPrivacy}
                    onNewGroup={openNewGroup}
                    onBlocked={onBlocked}
                    blockedCount={conversations.blocked.list.length}
                />
            )}

            <div
                className='messenger__chat-area'
                style={{ display: showChat ? 'flex' : 'none' }}
            >
                {conversations.available.map((conversation) => (
                    <ChatPane
                        key={conversation.id}
                        id={conversation.id}
                        columnVisible={showChat}
                        isMobile={isMobile}
                        name={conversation.name}
                        publicKey={conversation.publicKey}
                        group={conversation.kind === 'group'}
                        memberName={ownGroupName(conversation.id)}
                        members={conversation.mlsBootstrap?.roster}
                        ownMemberNumber={conversation.mlsBootstrap?.ownMemberNumber}
                        onOpenReceipts={onReceipts}
                        onOpenMemberName={openMemberName}
                        onIntroduce={onIntroduce}
                        callbacks={callbacksFor(conversation.id)}
                        readOnly={!metadata.writer}
                        onBack={onBackToList}
                        onOpenPeerQr={openPeerQr}
                        onOpenRename={openRename}
                        onOpenAddMember={openAddMember}
                        onDelete={onDeleteConversation}
                    />
                ))}
                <EmptyStateSlot ids={ids} />
            </div>

            {modal && (
                <Modal onClose={closeModal}>
                    {modal.kind === 'qr' && (
                        <QrModal
                            title={modal.title}
                            subtitle={modal.subtitle}
                            keyText={modal.keyText}
                        />
                    )}
                    {modal.kind === 'scanner' && <ScannerModal onConnect={doConnect} />}
                    {modal.kind === 'privacy' && <PrivacyModal onClose={closeModal} />}
                    {modal.kind === 'addMember' && (
                        <ContactPickerModal
                            title='Add member'
                            subtitle='The group owner adds a member; everyone else receives the commit.'
                            confirmLabel='Add'
                            contacts={contactsExcept(rosterKeysOf(modal.id))}
                            onCancel={closeModal}
                            onConfirm={(keys) => onAddMember(modal.id, keys)}
                        />
                    )}
                    {modal.kind === 'newGroup' && (
                        <ContactPickerModal
                            title='New group'
                            subtitle='Pick the contacts to start a group with.'
                            confirmLabel='Create'
                            contacts={contactsExcept([])}
                            namePlaceholder='Your name in this group'
                            onCancel={closeModal}
                            onConfirm={onCreateGroup}
                        />
                    )}
                    {modal.kind === 'incomingDial' && (
                        <IncomingDialModal
                            publicKey={modal.publicKey}
                            onAccept={() => modal.decide(true, false)}
                            onDecline={() => modal.decide(false, false)}
                            onBlock={() => modal.decide(false, true)}
                        />
                    )}
                    {modal.kind === 'receipts' && <ReceiptListModal entries={modal.entries} />}
                    {modal.kind === 'blocked' && (
                        <BlockedModal
                            entries={conversations.blocked.list}
                            onUnblock={onUnblock}
                        />
                    )}
                    {modal.kind === 'memberName' && (
                        <RenameModal
                            current={modal.current}
                            onCancel={closeModal}
                            onSave={onSaveMemberName}
                        />
                    )}
                    {modal.kind === 'rename' && (
                        <RenameModal
                            current={modal.current}
                            onCancel={closeModal}
                            onSave={onSaveRename}
                        />
                    )}
                </Modal>
            )}

            {isMobile && showConnectMobile && (
                <Modal onClose={onCloseConnectMobile}>
                    <ConnectModal
                        onConnect={doConnect}
                        onScan={onScanFromConnectModal}
                    />
                </Modal>
            )}

            {needUpdate && !updateDismissed && (
                <Modal onClose={onDismissUpdate}>
                    <UpdateModal onUpdate={onApplyUpdate} />
                </Modal>
            )}

            {idleRemaining !== undefined && (
                <Modal onClose={stayUnlocked}>
                    <IdleLockModal
                        remaining={idleRemaining}
                        onStay={stayUnlocked}
                    />
                </Modal>
            )}
        </div>
    );
};

export default React.memo(Messenger);
