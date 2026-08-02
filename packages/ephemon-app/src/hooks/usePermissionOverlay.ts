import { useCallback, useRef, useState } from 'react';

export function usePermissionOverlay() {
    const [showPermissionOverlay, setShowPermissionOverlay] = useState<boolean>(false);
    const resolveRef = useRef<(() => void) | undefined>(undefined);

    const permissionOverlayOnClick = useCallback(() => {
        if (resolveRef.current) {
            resolveRef.current();
        }
    }, []);

    const onPermissionDefault = useCallback(async () => {
        setShowPermissionOverlay(true);
        await new Promise<void>((resolve) => {
            resolveRef.current = resolve;
        });
    }, []);

    const onPermissionGranted = useCallback(() => {
        setShowPermissionOverlay(false);
        return Promise.resolve();
    }, []);

    const onPermissionDenied = useCallback(() => {
        setShowPermissionOverlay(false);
        return Promise.resolve();
    }, []);

    return {
        showPermissionOverlay,
        permissionOverlayOnClick,
        onPermissionDefault,
        onPermissionGranted,
        onPermissionDenied,
    };
}
