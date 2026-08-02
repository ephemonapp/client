import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, ThemeName } from './tokens';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ThemeContextValue = {
    theme: ThemeName;
    toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
    theme: 'light',
    toggleTheme: () => {},
});

export function useTheme(): ThemeContextValue {
    return useContext(ThemeContext);
}

const STORAGE_KEY = THEME_STORAGE_KEY;

function applyTheme(theme: ThemeName) {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
}

function getInitialTheme(): ThemeName {
    const applied = document.documentElement.getAttribute(THEME_ATTRIBUTE);
    if (applied === 'light' || applied === 'dark') {
        return applied;
    }
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') {
            return stored;
        }
    } catch {}
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
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
    const [theme, setTheme] = useState<ThemeName>(getInitialTheme);
    const [userOverride, setUserOverride] = useState<boolean>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored === 'light' || stored === 'dark';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        if (userOverride || typeof matchMedia === 'undefined') {
            return;
        }
        const media = matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => setTheme(media.matches ? 'dark' : 'light');
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, [userOverride]);

    const toggleTheme = useCallback(() => {
        setTheme((prev) => {
            const next: ThemeName = prev === 'dark' ? 'light' : 'dark';
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch {}
            return next;
        });
        setUserOverride(true);
    }, []);

    const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

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
