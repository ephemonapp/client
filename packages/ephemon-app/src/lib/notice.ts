import { ConnectionIssue } from '@ephemon/core';

export type NoticeCode = ConnectionIssue | 'server-private' | 'server-offline' | 'server-insecure';

export type ConnectionNotice = {
    code: NoticeCode;
    serverUrl?: string;
};

export function noticeText(notice: ConnectionNotice, name: string): string {
    const server = notice.serverUrl ?? 'their server';
    switch (notice.code) {
        case 'peer-unreachable':
            return `${name} is not reachable right now. Their server has no live route to them — they are probably offline.`;
        case 'server-private':
            return `${server} refuses connections from this app. It only accepts its own client, so ${name} can only be reached from there.`;
        case 'server-offline':
            return `${server} did not answer. ${name} cannot be reached until that server is back.`;
        case 'server-insecure':
            return `${server} is served over http, and this page is https — the browser blocks that. ${name} can only be reached over https.`;
        case 'signalling-rejected':
            return `${server} refused the connection request.`;
        case 'signalling-unavailable':
            return `Could not reach the signalling server, so ${name} cannot be contacted right now.`;
    }
}

/**
 * The same notice squeezed into the places that only have room for a status: a conversation row,
 * a chat header. The sentence belongs in the banner; here it has to fit next to a name.
 */
export function noticeLabel(notice: ConnectionNotice): string {
    switch (notice.code) {
        case 'peer-unreachable':
            return 'not reachable';
        case 'server-private':
            return 'server refuses this app';
        case 'server-offline':
            return 'server is down';
        case 'server-insecure':
            return 'needs https';
        case 'signalling-rejected':
            return 'request refused';
        case 'signalling-unavailable':
            return 'no signalling';
    }
}
