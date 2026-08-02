import LockFormSkeleton from './components/LockScreen/LockFormSkeleton';
import LockLanding from './components/LockScreen/LockLanding';
import { themeBootstrap, themeCss } from './theme/tokens';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export function renderLockSkeleton(): string {
    return renderToStaticMarkup(
        <>
            <LockLanding />
            <LockFormSkeleton />
        </>,
    );
}

export function renderThemeCss(): string {
    return themeCss();
}

export function renderThemeBootstrap(): string {
    return themeBootstrap();
}
