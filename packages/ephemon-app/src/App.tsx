import LockScreen from './components/LockScreen/LockScreen';
import PermissionOverlay from './components/PermissionOverlay/PermissionOverlay';
import { usePasswordCheck } from './hooks/usePasswordCheck';
import { usePermissionOverlay } from './hooks/usePermissionOverlay';
import { useSearchParams } from './hooks/useSearchParams';
import { getVault } from './lib/vault';
import { useTheme } from './theme/ThemeProvider';
import { themeTokens } from './theme/tokens';
import { loadEphemonCore } from './utils/core';
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react';

const Messenger = React.lazy(async () => {
    await loadEphemonCore();
    return import(/* webpackChunkName: "messenger.min" */ './components/Messenger/Messenger');
});

function setThemeColorMeta(color: string) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
    }
    meta.setAttribute('content', color);
}

const DB_NAMES = ['ephemon', 'ephemon-sw'];

const App: React.FC = () => {
    useLayoutEffect(() => {
        document.getElementById('lock-skeleton')?.setAttribute('data-done', '');
    }, []);

    const { theme } = useTheme();
    const [debugPassword] = useSearchParams('__debug_password');
    const [password, setPassword] = useState<string | undefined>(debugPassword || undefined);
    useEffect(() => {
        if (debugPassword) {
            setPassword(debugPassword);
        }
    }, [debugPassword]);

    const passwordState = usePasswordCheck(password);

    useEffect(() => {
        if (passwordState === 'valid') setPassword(undefined);
    }, [passwordState]);

    const {
        showPermissionOverlay,
        permissionOverlayOnClick,
        onPermissionDefault,
        onPermissionGranted,
        onPermissionDenied,
    } = usePermissionOverlay();

    const [publicKey, setPublicKey] = useState<string | undefined>();

    const onReset = useCallback(() => {
        const erase = (name: string) =>
            new Promise<void>((resolve) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
            });

        try {
            getVault().close();
        } catch {}
        Promise.all(DB_NAMES.map(erase)).finally(() => window.location.reload());
    }, []);

    const onSubmitPassword = useCallback((value: string) => setPassword(value), []);

    useEffect(() => {
        if (publicKey === undefined) {
            document.documentElement.removeAttribute('data-public-key');
        } else {
            document.documentElement.setAttribute('data-public-key', publicKey);
        }
    }, [publicKey]);

    const onLanding = showPermissionOverlay || publicKey === undefined;
    useEffect(() => {
        const tokens = themeTokens(theme);
        const base = tokens['--surface'];
        setThemeColorMeta(onLanding ? tokens['--surface'] : tokens['--side']);
        document.documentElement.style.backgroundColor = base;
        document.body.style.backgroundColor = base;
    }, [onLanding, theme]);

    return (
        <>
            {publicKey === undefined && (
                <LockScreen
                    passwordState={passwordState}
                    onSubmit={onSubmitPassword}
                    onReset={onReset}
                />
            )}
            {passwordState === 'valid' && (
                <Suspense fallback={null}>
                    <Messenger
                        passwordState={passwordState}
                        onPermissionDefault={onPermissionDefault}
                        onPermissionGranted={onPermissionGranted}
                        onPermissionDenied={onPermissionDenied}
                        onPublicKey={setPublicKey}
                    />
                </Suspense>
            )}
            {showPermissionOverlay && <PermissionOverlay onClick={permissionOverlayOnClick} />}
        </>
    );
};

export default App;
