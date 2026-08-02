import { ConnectionNotice, noticeLabel } from './notice';

export type UiConnectionState = 'connecting' | 'open' | 'degraded' | 'closed';

export type UiTransport = 'direct' | 'relay';

export type NetStatus = 'connected' | 'connecting' | 'unstable' | 'offline';

export function connStatus(
    state: UiConnectionState | undefined,
    transport?: UiTransport,
    notice?: ConnectionNotice,
): { text: string; color: string } {
    if (state === 'open') {
        if (transport === 'relay') return { text: 'connected · relay', color: 'var(--ok)' };
        return { text: 'connected · e2e', color: 'var(--ok)' };
    }
    if (state === 'degraded') {
        if (transport === 'relay') return { text: 'degraded · relay', color: 'var(--warn)' };
        return { text: 'degraded · e2e', color: 'var(--warn)' };
    }
    if (notice !== undefined) return { text: noticeLabel(notice), color: 'var(--warn)' };
    if (state === 'connecting') return { text: 'connecting…', color: 'var(--pri)' };
    return { text: 'offline', color: 'var(--muted)' };
}

export function netStatus(net: NetStatus): { label: string; color: string } {
    switch (net) {
        case 'connected':
            return { label: 'connected', color: 'var(--ok)' };
        case 'unstable':
            return { label: 'unstable', color: 'var(--warn)' };
        case 'offline':
            return { label: 'offline', color: 'var(--unread)' };
        case 'connecting':
        default:
            return { label: 'connecting', color: 'var(--pri)' };
    }
}
