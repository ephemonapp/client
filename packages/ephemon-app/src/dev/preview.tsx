import LockLanding from '../components/LockScreen/LockLanding';
import '../components/LockScreen/LockScreen.css';
import '../components/Messenger/Chat/Chat.css';
import ChatHeader from '../components/Messenger/Chat/ChatHeader';
import Composer from '../components/Messenger/Chat/Composer';
import ConnectingBanner from '../components/Messenger/Chat/ConnectingBanner';
import MessageList from '../components/Messenger/Chat/MessageList';
import ReactionPicker, { ReactionAnchor } from '../components/Messenger/Chat/ReactionPicker';
import ReplyBar from '../components/Messenger/Chat/ReplyBar';
import '../components/Messenger/Messenger.css';
import { ConversationRowData } from '../components/Messenger/Sidebar/ConversationRow';
import Sidebar from '../components/Messenger/Sidebar/Sidebar';
import SettingsScreen from '../components/Settings/SettingsScreen';
import Modal from '../components/modals/Modal';
import PrivacyModal from '../components/modals/PrivacyModal';
import QrModal from '../components/modals/QrModal';
import RenameModal from '../components/modals/RenameModal';
import ScannerModal from '../components/modals/ScannerModal';
import { getChatStore } from '../lib/chatStore';
import {
    setConnectionState,
    setConnectionTransport,
    setActiveConversation,
    setConversationOrder,
    setUnreadCount,
} from '../lib/connectionStore';
import { trackServerSync, UNSTABLE_AFTER } from '../lib/netStatusStore';
import '../styles.css';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ChatEventRecord } from '../types/chatRecord';
import { toConversationId } from '../types/conversation';
import { toSelfChatRecordId } from '../types/eventId';
import React from 'react';
import { createRoot } from 'react-dom/client';

const ALEX_KEY = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ012345678=';
const MY_CONTACT = 'k8FjZ0rQvN2pXwTy7bLm9cAeR4sD1gHuJ6iOoP3aQwEBd2hpc3Blci1zcnYudm9yb2JhbGVrLmRldg==';
const ALEX_CONTACT = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ0123454Bd2hpc3Blci5hbGV4LXJpdmVyYS5leGFtcGxlLm9yZw==';
const WORK_KEY = 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa987654321=';
const RU_KEY = 'Mn4Kp2Qr8St6Uv0Wx1Yz3Ab5Cd7Ef9Gh2Ij4Kl6Mn8Op0=';
const ALEX_CONVERSATION_ID = toConversationId(1);
const WORK_CONVERSATION_ID = toConversationId(2);
const RU_CONVERSATION_ID = toConversationId(3);

const rows: Array<ConversationRowData> = [
    { id: ALEX_CONVERSATION_ID, kind: 'direct' as const, publicKey: ALEX_KEY, name: 'Alex Rivera' },
    { id: WORK_CONVERSATION_ID, kind: 'direct' as const, publicKey: WORK_KEY, name: undefined },
    { id: RU_CONVERSATION_ID, kind: 'group' as const, publicKey: RU_KEY, name: 'Работа' },
];

const scene = window.location.hash.replace('#', '') || 'chat';
const demoTransport: 'direct' | 'relay' | undefined = scene === 'relay' ? 'relay' : undefined;

setConnectionState(ALEX_CONVERSATION_ID, 'open');
setConnectionTransport(ALEX_CONVERSATION_ID, demoTransport);
setConversationOrder(ALEX_CONVERSATION_ID, Date.parse('2026-07-23T13:58:00'));
setConnectionState(WORK_CONVERSATION_ID, 'connecting');
setUnreadCount(WORK_CONVERSATION_ID, 2);
setConversationOrder(WORK_CONVERSATION_ID, Date.parse('2026-07-23T12:10:00'));
setConnectionState(RU_CONVERSATION_ID, 'closed');
setConversationOrder(RU_CONVERSATION_ID, Date.parse('2026-07-22T19:30:00'));

const t = (hhmm: string) => Date.parse(`2026-07-23T${hhmm}:00`);
const e = (sender: 'you' | 'peer', hhmm: string) => toSelfChatRecordId(sender, 'message', t(hhmm));
const receipt = (
    sender: 'you' | 'peer',
    kind: 'delivered' | 'seen' | 'reaction',
    hhmm: string,
    target: ReturnType<typeof e>,
    value?: string,
): ChatEventRecord => ({
    kind,
    id: toSelfChatRecordId(sender, kind, t(hhmm)),
    sender,
    timestamp: t(hhmm),
    target,
    value,
});

const messages: Array<ChatEventRecord> = [
    {
        kind: 'message',
        id: e('peer', '13:42'),
        sender: 'peer',
        timestamp: t('13:42'),
        text: 'Hey! Did the fresh key come through on your side?',
    },
    {
        kind: 'message',
        id: e('you', '13:43'),
        sender: 'you',
        timestamp: t('13:43'),
        text: 'Yep — handshake looks clean.',
    },
    {
        kind: 'message',
        id: e('peer', '13:45'),
        sender: 'peer',
        timestamp: t('13:45'),
        text: 'Nice. Sending the sealed note now 🔐',
        reply_to: {
            id: e('you', '13:43'),
            sender: 'you',
            text: 'Yep — handshake looks clean.',
        },
    },
    {
        kind: 'message',
        id: e('you', '13:47'),
        sender: 'you',
        timestamp: t('13:47'),
        text: 'Got it. This is unlinkable end to end, right?',
    },
    {
        kind: 'message',
        id: e('you', '13:58'),
        sender: 'you',
        timestamp: t('13:58'),
        text: 'One sec…',
    },
    receipt('peer', 'delivered', '13:43', e('you', '13:43')),
    receipt('peer', 'seen', '13:44', e('you', '13:43')),
    receipt('you', 'reaction', '13:46', e('peer', '13:45'), '👍'),
    receipt('peer', 'delivered', '13:47', e('you', '13:47')),
];

setActiveConversation(ALEX_CONVERSATION_ID);

const chatStore = getChatStore(ALEX_CONVERSATION_ID);
chatStore.hydrate(messages);
chatStore.setTyping(true);

const noop = () => {};

trackServerSync({
    get serverTime() {
        return Date.now();
    },
    onServerSync: (listener) => {
        listener(Date.now());
        setInterval(() => listener(Date.now()), UNSTABLE_AFTER / 2);
    },
});

const SettingsScene: React.FC = () => (
    <div className='lock'>
        <LockLanding />
        <div className='lock__form lock__form--settings'>
            <SettingsScreen onSaved={noop} />
        </div>
    </div>
);

const Scene: React.FC = () => {
    const [anchor, setAnchor] = React.useState<ReactionAnchor | null>(
        scene === 'reactions' ? { msgId: messages[3].id, x: 560, y: 560, origin: 'center bottom' } : null,
    );

    const sidebar = (
        <Sidebar
            isMobile={false}
            onShowMyQr={noop}
            myQrOpen={false}
            onLock={noop}
            onConnect={noop}
            onScan={noop}
            connectVisible={true}
            showFab={false}
            onFab={noop}
            conversations={rows}
            onSelect={noop}
            onPrivacy={noop}
            onNewGroup={noop}
            onBlocked={noop}
            blockedCount={0}
        />
    );

    const chat = (
        <div className='chat'>
            <ChatHeader
                conversationId={ALEX_CONVERSATION_ID}
                name='Alex Rivera'
                publicKey={ALEX_KEY}
                isMobile={false}
                onBack={noop}
                onReconnect={noop}
                onRename={noop}
                onAddMember={noop}
                onShowPeerQr={noop}
                onClear={noop}
                onDelete={noop}
                group={false}
                onMemberName={noop}
            />
            <MessageList
                store={chatStore}
                onSeen={noop}
                onRetry={noop}
                onReply={noop}
                onReact={(msgId, event) => {
                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                    setAnchor({
                        msgId,
                        x: Math.round(rect.left - 100),
                        y: Math.round(rect.top - 158),
                        origin: 'center bottom',
                    });
                }}
                onDoubleReact={noop}
            />
            <div className='chat__footer'>
                {scene === 'connecting' && <ConnectingBanner progress={62} />}
                {scene === 'reply' && (
                    <ReplyBar
                        text='Nice. Sending the sealed note now 🔐'
                        sender='peer'
                        onCancel={noop}
                        onJump={noop}
                    />
                )}
                <Composer
                    placeholder='Message Alex Rivera…'
                    onSend={noop}
                    onTyping={noop}
                />
            </div>
            {anchor && (
                <ReactionPicker
                    anchor={anchor}
                    onPick={() => setAnchor(null)}
                    onClose={() => setAnchor(null)}
                />
            )}
        </div>
    );

    return (
        <div className='messenger'>
            {sidebar}
            <div
                className='messenger__chat-area'
                style={{ display: 'flex' }}
            >
                {chat}
            </div>
            {scene === 'qr-my' && (
                <Modal onClose={noop}>
                    <QrModal
                        title={`Your ${process.env.EPHEMON_APP_NAME} code`}
                        subtitle='Others scan this to start a chat with you'
                        keyText={MY_CONTACT}
                    />
                </Modal>
            )}
            {scene === 'qr-peer' && (
                <Modal onClose={noop}>
                    <QrModal
                        title="Alex Rivera's code"
                        subtitle='Share this so others can add this contact'
                        keyText={ALEX_CONTACT}
                    />
                </Modal>
            )}
            {scene === 'scanner' && (
                <Modal onClose={noop}>
                    <ScannerModal onConnect={noop} />
                </Modal>
            )}
            {scene === 'privacy' && (
                <Modal onClose={noop}>
                    <PrivacyModal onClose={noop} />
                </Modal>
            )}
            {scene === 'rename' && (
                <Modal onClose={noop}>
                    <RenameModal
                        current='Alex Rivera'
                        onCancel={noop}
                        onSave={noop}
                    />
                </Modal>
            )}
        </div>
    );
};

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(
        <ThemeProvider>{scene === 'settings' ? <SettingsScene /> : <Scene />}</ThemeProvider>,
    );
    window.addEventListener('hashchange', () => window.location.reload());
}
