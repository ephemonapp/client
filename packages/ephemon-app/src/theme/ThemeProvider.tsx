import {
    THEME_ATTRIBUTE,
    THEME_STORAGE_KEY,
    ThemeName,
    ThemePreference,
    nextThemePreference,
    parseThemePreference,
} from './tokens';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ThemeContextValue = {
    theme: ThemeName;
    preference: ThemePreference;
    toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
    theme: 'light',
    preference: 'system',
    toggleTheme: () => {},
});

export function useTheme(): ThemeContextValue {
    return useContext(ThemeContext);
}

const STORAGE_KEY = THEME_STORAGE_KEY;

function applyTheme(theme: ThemeName) {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
}

function getSystemTheme(): ThemeName {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredPreference(): ThemePreference {
    try {
        return parseThemePreference(localStorage.getItem(STORAGE_KEY));
    } catch {
        return 'system';
    }
}

const CARD_MAX_WIDTH = 1112;
const CARD_HEIGHT_RATIO = 0.9;

function computeWindowed(): boolean {
    if (typeof window === 'undefined') return false;
    if (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) {
        return false;
    }
    const cardWidth = Math.min(window.innerWidth, CARD_MAX_WIDTH);
    const horizontalGap = (window.innerWidth - cardWidth) / 2;
    const verticalGap = (window.innerHeight - window.innerHeight * CARD_HEIGHT_RATIO) / 2;
    return horizontalGap >= verticalGap;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [preference, setPreference] = useState<ThemePreference>(getStoredPreference);
    const [systemTheme, setSystemTheme] = useState<ThemeName>(getSystemTheme);
    const theme = preference === 'system' ? systemTheme : preference;

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        if (typeof matchMedia === 'undefined') {
            return;
        }
        const media = matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light');
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, []);

    const toggleTheme = useCallback(() => {
        const next = nextThemePreference(preference, getSystemTheme());
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {}
        setPreference(next);
    }, [preference]);

    const value = useMemo(() => ({ theme, preference, toggleTheme }), [theme, preference, toggleTheme]);

    const rootRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const apply = () => rootRef.current?.classList.toggle('ephemon-root--windowed', computeWindowed());
        apply();
        window.addEventListener('resize', apply);
        const standalone = typeof matchMedia !== 'undefined' ? matchMedia('(display-mode: standalone)') : null;
        standalone?.addEventListener('change', apply);
        return () => {
            window.removeEventListener('resize', apply);
            standalone?.removeEventListener('change', apply);
        };
    }, []);

    return (
        <ThemeContext.Provider value={value}>
            <main
                ref={rootRef}
                className='ephemon-root'
                data-theme={theme}
            >
                {children}
            </main>
        </ThemeContext.Provider>
    );
};
