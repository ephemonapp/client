declare global {
    interface Window {
        __notifications?: string[];
    }
}

export function installNotificationRecorder(): void {
    const shown: string[] = [];
    window.__notifications = shown;

    const RealNotification = window.Notification;
    if (RealNotification !== undefined) {
        window.Notification = new Proxy(RealNotification, {
            construct(target, args: [string, NotificationOptions?]) {
                shown.push(args[0]);
                try {
                    return new target(...args);
                } catch {
                    return Object.create(target.prototype) as Notification;
                }
            },
        });
    }

    const post = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
        const payload = message as { type?: string; title?: string } | null;
        if (payload?.type === 'SHOW_NOTIFICATION' && payload.title !== undefined) shown.push(payload.title);
        return (post as (this: ServiceWorker, ...args: unknown[]) => void).call(this, message, ...rest);
    };
}
