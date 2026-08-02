export type ThemeName = 'light' | 'dark';

export type ThemePreference = ThemeName | 'system';

export type ThemeTokens = {
    '--surface': string;
    '--side': string;
    '--shell': string;
    '--brand': string;
    '--brand-deep': string;
    '--on-brand': string;
    '--on-brand-strong': string;
    '--pri': string;
    '--pri-text': string;
    '--prih': string;
    '--you': string;
    '--peer': string;
    '--sys': string;
    '--text': string;
    '--muted': string;
    '--input': string;
    '--field': string;
    '--menu': string;
    '--unread': string;
    '--err-bg': string;
    '--line': string;
    '--idbg': string;
    '--ok': string;
    '--warn': string;
    '--skeleton': string;
    '--skeleton-shine': string;
};

export const LIGHT: ThemeTokens = {
    '--surface': '#ffffff',
    '--side': '#f7f8fa',
    '--shell': '#e6e9ed',
    '--brand': '#6A5BFF',
    '--brand-deep': '#2E2596',
    '--on-brand': '#ffffff',
    '--on-brand-strong': 'rgba(255,255,255,.85)',
    '--pri': '#5B4CE8',
    '--pri-text': '#5B4CE8',
    '--prih': '#4A3CD1',
    '--you': '#DCD8FF',
    '--peer': '#eceef1',
    '--sys': '#e6e9ed',
    '--text': '#14161a',
    '--muted': '#6c757d',
    '--input': '#eef0f3',
    '--field': '#eef0f3',
    '--menu': '#ffffff',
    '--unread': '#ff3b30',
    '--err-bg': 'rgba(255,59,48,.08)',
    '--line': 'rgba(0,0,0,.07)',
    '--idbg': '#EDEBFF',
    '--ok': '#2aa876',
    '--warn': '#c77d00',
    '--skeleton': '#d8dde3',
    '--skeleton-shine': '#eceff3',
};

export const DARK: ThemeTokens = {
    '--surface': '#181a1b',
    '--side': '#1e2021',
    '--shell': '#0d0e0f',
    '--brand': '#6A5BFF',
    '--brand-deep': '#2E2596',
    '--on-brand': '#ffffff',
    '--on-brand-strong': 'rgba(255,255,255,.85)',
    '--pri': '#6A5BFF',
    '--pri-text': '#9E94FF',
    '--prih': '#5B4CE8',
    '--you': '#241F5E',
    '--peer': '#26292b',
    '--sys': '#2f3336',
    '--text': '#e8e6e3',
    '--muted': '#8b9297',
    '--input': '#242728',
    '--field': '#242728',
    '--menu': '#242728',
    '--unread': '#ff5a4d',
    '--err-bg': 'rgba(255,90,77,.12)',
    '--line': 'rgba(255,255,255,.09)',
    '--idbg': '#211C52',
    '--ok': '#2aa876',
    '--warn': '#e0a34a',
    '--skeleton': '#2a2e30',
    '--skeleton-shine': '#363b3e',
};

export function themeTokens(theme: ThemeName): ThemeTokens {
    return theme === 'dark' ? DARK : LIGHT;
}

export const THEME_STORAGE_KEY = 'ephemon_theme';

export const THEME_ATTRIBUTE = 'data-theme';

const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

export function parseThemePreference(stored: string | null): ThemePreference {
    return THEME_PREFERENCES.find((preference) => preference === stored) ?? 'system';
}

export function nextThemePreference(preference: ThemePreference, systemTheme: ThemeName): ThemePreference {
    if (preference === 'system') {
        return systemTheme === 'dark' ? 'light' : 'dark';
    }
    return preference === systemTheme ? 'system' : systemTheme;
}

function declarations(tokens: ThemeTokens): string {
    return Object.entries(tokens)
        .map(([name, value]) => `    ${name}: ${value};`)
        .join('\n');
}

export function themeCss(): string {
    return [
        `:root,\n:root[${THEME_ATTRIBUTE}='light'] {\n${declarations(LIGHT)}\n}`,
        `:root[${THEME_ATTRIBUTE}='dark'] {\n${declarations(DARK)}\n}`,
        `@media (prefers-color-scheme: dark) {\n:root:not([${THEME_ATTRIBUTE}]) {\n${declarations(DARK)}\n}\n}`,
    ].join('\n\n');
}

export function themeBootstrap(): string {
    return (
        `(function(){var d=document.documentElement,t;` +
        `try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}` +
        `if(t!=='light'&&t!=='dark'){` +
        `t=typeof matchMedia!=='undefined'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}` +
        `d.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t)})()`
    );
}
