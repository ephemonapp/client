import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState<boolean>(() => {
        if (typeof matchMedia === 'undefined') return false;
        return matchMedia(query).matches;
    });

    useEffect(() => {
        if (typeof matchMedia === 'undefined') return;
        const media = matchMedia(query);
        const onChange = () => setMatches(media.matches);
        onChange();
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, [query]);

    return matches;
}

export const MOBILE_QUERY = '(max-width: 760px)';
