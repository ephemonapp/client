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
import { displayName } from '../../lib/identicon';
import { getSettings } from '../../lib/settingsStore';
import { UiConnectionState } from '../../lib/status';
import { ConversationId } from '../../types/conversation';
import ConnectModal from '../modals/ConnectModal';
import IdleLockModal from '../modals/IdleLockModal';
import Modal from '../modals/Modal';
import PrivacyModal from '../modals/PrivacyModal';
import QrModal from '../modals/QrModal';
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
    | { kind: 'rename'; id: ConversationId; current: string };

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
        if (alreadyExists || window.confirm(`Incoming connection request from:\n${peerKey}\n\nAccept?`)) {
            return Promise.resolve(true);
        }
        console.log('User declined the connection request.');
        return Promise.resolve(false);
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
                        callbacks={callbacksFor(conversation.id)}
                        onBack={onBackToList}
                        onOpenPeerQr={openPeerQr}
                        onOpenRename={openRename}
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
