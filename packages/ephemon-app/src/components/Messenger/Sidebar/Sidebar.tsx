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
    onLock: () => void;
    onConnect: (code: string) => void;
    onScan: () => void;
    connectVisible: boolean;
    showFab: boolean;
    onFab: () => void;
    conversations: Array<ConversationRowData>;
    onSelect: (id: number) => void;
    onPrivacy: () => void;
};

const Sidebar: React.FC<SidebarProps> = ({
    isMobile,
    onShowMyQr,
    onLock,
    onConnect,
    onScan,
    connectVisible,
    showFab,
    onFab,
    conversations,
    onSelect,
    onPrivacy,
}) => {
    return (
        <div className={`sidebar${isMobile ? ' sidebar--mobile' : ''}`}>
            <BrandHeader
                onShowMyQr={onShowMyQr}
                onLock={onLock}
            />
            <ConnectBlock
                visible={connectVisible}
                isMobile={isMobile}
                onConnect={onConnect}
                onScan={onScan}
            />
            <div className='sidebar__section'>Chats</div>
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
