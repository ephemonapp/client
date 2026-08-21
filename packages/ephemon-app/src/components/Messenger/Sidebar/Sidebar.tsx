import { ConversationId } from '../../../types/conversation';
import { ShieldCheckIcon, PlusIcon } from '../../icons';
import BrandHeader from './BrandHeader';
import ConnectBlock from './ConnectBlock';
import ConversationList from './ConversationList';
import { ConversationRowData } from './ConversationRow';
import './Sidebar.css';
import React from 'react';

type SidebarProps = {
    isMobile: boolean;
    onShowMyQr: () => void;
    myQrOpen: boolean;
    onLock: () => void;
    onConnect: (code: string) => void;
    onScan: () => void;
    connectVisible: boolean;
    showFab: boolean;
    onFab: () => void;
    conversations: Array<ConversationRowData>;
    onSelect: (id: ConversationId) => void;
    onPrivacy: () => void;
    onNewGroup: () => void;
    onBlocked: () => void;
    blockedCount: number;
};

const Sidebar: React.FC<SidebarProps> = ({
    isMobile,
    onShowMyQr,
    myQrOpen,
    onLock,
    onConnect,
    onScan,
    connectVisible,
    showFab,
    onFab,
    conversations,
    onSelect,
    onPrivacy,
    onNewGroup,
    onBlocked,
    blockedCount,
}) => {
    return (
        <div className={`sidebar${isMobile ? ' sidebar--mobile' : ''}`}>
            <BrandHeader
                onShowMyQr={onShowMyQr}
                myQrOpen={myQrOpen}
                onLock={onLock}
            />
            <ConnectBlock
                visible={connectVisible}
                isMobile={isMobile}
                onConnect={onConnect}
                onScan={onScan}
            />
            <div className='sidebar__section sidebar__section-row'>
                Chats
                <span>
                    <button
                        className='sidebar__blocked'
                        onClick={onBlocked}
                    >
                        Blocked{blockedCount > 0 ? ` (${blockedCount})` : ''}
                    </button>
                    <button
                        className='sidebar__new-group'
                        onClick={onNewGroup}
                    >
                        New group
                    </button>
                </span>
            </div>
            <ConversationList
                conversations={conversations}
                onSelect={onSelect}
            />
            <div
                className='sidebar__footer'
                onClick={onPrivacy}
            >
                <ShieldCheckIcon />
                How {process.env.EPHEMON_APP_NAME} protects you
            </div>
            {showFab && (
                <button
                    className='sidebar__fab'
                    title='New chat'
                    onClick={onFab}
                >
                    <PlusIcon />
                </button>
            )}
        </div>
    );
};

export default React.memo(Sidebar);
