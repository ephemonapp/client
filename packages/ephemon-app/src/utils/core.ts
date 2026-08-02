let loading: Promise<void> | undefined;

export function loadEphemonCore(): Promise<void> {
    if (loading === undefined) {
        loading = new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${process.env.EPHEMON_CLIENT_URL}/core.min.js?_=${process.env.EPHEMON_BUILD_TIMESTAMP}`;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => {
                loading = undefined;
                script.remove();
                reject(new Error('Unable to load core.min.js.'));
            };
            document.head.appendChild(script);
        });
    }
    return loading;
}
