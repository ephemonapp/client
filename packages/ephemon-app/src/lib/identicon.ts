const PALETTE = ['#4a5bb8', '#566573', '#2e7d9a', '#8a5a2b', '#6b4e9a', '#2a7d5a'];

export function hashColor(key: string | undefined): string {
    let h = 0;
    const s = key || '';
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return PALETTE[h % PALETTE.length];
}

export function shortKey(key: string | undefined): string {
    if (!key) return '';
    const k = String(key);
    return k.length > 16 ? k.slice(0, 7) + '…' + k.slice(-6) : k;
}

export function initials(name: string | undefined, key: string | undefined): string {
    const n = (name || key || '?').replace(/[^a-zA-Z0-9]/g, '');
    return (n.slice(0, 2) || '??').toUpperCase();
}

export function displayName(name: string | undefined, key: string): string {
    return name || shortKey(key);
}
