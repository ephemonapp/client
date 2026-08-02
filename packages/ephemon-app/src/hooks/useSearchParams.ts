import { useEffect, useState } from 'react';

export function useSearchParams(param: string): [string | null, (value: string) => void] {
    const [value, setValue] = useState<string | null>(null);

    useEffect(() => {
        const urlSearchParams = new URLSearchParams(window.location.search);
        setValue(urlSearchParams.get(param));
    }, [param]);

    return [
        value,
        (newVal: string) => {
            const url = new URL(window.location.href);
            url.searchParams.set(param, newVal);
            window.history.pushState({}, '', url);
            setValue(newVal);
        },
    ];
}
