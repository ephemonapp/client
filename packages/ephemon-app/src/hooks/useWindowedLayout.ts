import { useEffect, useState } from 'react';

const CARD_MAX_WIDTH = 1112;
const CARD_HEIGHT_RATIO = 0.9;

function computeWindowed(): boolean {
    if (typeof window === 'undefined') return false;
    if (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) {
        return false;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(vw, CARD_MAX_WIDTH);
    const cardHeight = vh * CARD_HEIGHT_RATIO;
    const horizontalGap = (vw - cardWidth) / 2;
    const verticalGap = (vh - cardHeight) / 2;
    return horizontalGap >= verticalGap;
}

export function useWindowedLayout(): boolean {
    const [windowed, setWindowed] = useState<boolean>(computeWindowed);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const update = () => setWindowed(computeWindowed());
        update();
        window.addEventListener('resize', update);
        const standalone = typeof matchMedia !== 'undefined' ? matchMedia('(display-mode: standalone)') : null;
        standalone?.addEventListener('change', update);
        return () => {
            window.removeEventListener('resize', update);
            standalone?.removeEventListener('change', update);
        };
    }, []);

    return windowed;
}
