import { CallPayload } from '../models/infrasctructure/call-payload';
import { Base64 } from '../utils/base64';
import { Logger } from '../utils/logger';
import { WorkerService } from './worker-service';

export type PushServiceConfig = {
    disablePushService?: boolean;
    vapidKey?: string;
    onPermissionDefault?: () => Promise<void>;
    onPermissionGranted?: () => Promise<void>;
    onPermissionDenied?: () => Promise<void>;
    urlBase64ToUint8Array?: (base64String: string) => Uint8Array;
};

type PushServiceEffectiveConfig = {
    onCall: (payload: CallPayload) => Promise<void>;
    notification?: typeof Notification;
    pushManager?: typeof PushManager;
    urlBase64ToUint8Array?: (base64String: string) => Uint8Array;
} & PushServiceConfig;

export interface Subscription {
    endpoint: string;
    expirationTime: number | null;
    keys: {
        p256dh: string;
        auth: string;
    };
}

export interface PushService {
    initialize(config: PushServiceEffectiveConfig): Promise<void>;

    getSubscription(): Promise<Subscription | undefined>;

    showNotification(title: string, options?: NotificationOptions): boolean;
}

export function getPushService(logger: Logger, workerService: WorkerService, base64: Base64): PushService {
    let subscription: Subscription | undefined;
    let vapidKey: string | undefined;
    let notification: typeof Notification | undefined;
    let pushManager: typeof PushManager | undefined;
    let urlBase64ToUint8Array: ((base64String: string) => Uint8Array) | undefined;
    return {
        async initialize(config: PushServiceEffectiveConfig): Promise<void> {
            if (config.disablePushService) {
                logger.warn('[push-service] Disabled.');
                return;
            }
            if (!workerService.container) {
                logger.warn('[push-service] Service Worker is not available.');
                return;
            }

            notification = config.notification;
            pushManager = config.pushManager;
            urlBase64ToUint8Array = config.urlBase64ToUint8Array;

            async function processMessage(payload: any) {
                const { data } = payload;
                if (!data) {
                    logger.error('[push-service] Invalid payload data.');
                    return;
                }
                const callPayload = data as CallPayload;
                if (!callPayload || !callPayload.a) {
                    logger.error('[push-service] Invalid payload data.');
                    return;
                }
                if (!config.onCall) {
                    logger.warn('[push-service] Message callback is not initialized.');
                    return;
                }
                try {
                    await config.onCall(callPayload);
                } catch (error) {
                    logger.error(`[push-service] Error while processing push call.`, error);
                }
            }

            workerService.container.addEventListener('message', async (event: any) => {
                if (event.data?.payload && event.data.type === 'PUSH_NOTIFICATION') {
                    logger.debug('[push-service] Message received from Service Worker:', event.data.payload);
                    await processMessage(event.data.payload);
                }
            });

            vapidKey = config.vapidKey;
            if (!config.vapidKey) {
                logger.warn('[push-service] No vapid key found.');
                return;
            }

            const Notification = notification;

            if (!Notification) {
                logger.warn('[push-service] Notifications are not supported.');
                return;
            }
            let permission: NotificationPermission = Notification.permission;
            const { onPermissionDefault, onPermissionGranted, onPermissionDenied } = config;
            if (permission === 'default') {
                if (onPermissionDefault) await onPermissionDefault();
                permission = await Notification.requestPermission();
            }
            switch (permission) {
                case 'granted':
                    logger.debug('[push-service] Notification permission granted.');
                    if (onPermissionGranted) await onPermissionGranted();
                    break;
                case 'denied':
                    logger.error('[push-service] Notification permission denied.');
                    if (onPermissionDenied) await onPermissionDenied();
                    break;
                case 'default':
                    logger.error('[push-service] Notification permission is still default.');
                    if (onPermissionDefault) await onPermissionDefault();
                    break;
            }
            logger.debug('[push-service] Initialized.');
        },
        async getSubscription(): Promise<Subscription | undefined> {
            async function getPushSubscription(
                urlBase64ToUint8Array: (base64String: string) => Uint8Array,
            ): Promise<PushSubscription | undefined> {
                if (!pushManager) {
                    logger.warn('[push-service] PushManager is not available.');
                    return undefined;
                }

                async function unsubscribePushSubscription(subscription: PushSubscription): Promise<void> {
                    try {
                        await subscription.unsubscribe();
                        logger.debug(`[push-service] Unsubscribed.`);
                    } catch (err) {
                        logger.error('[push-service] An error occurred while cancelling the subscription.', err);
                    }
                }

                const registration = workerService.registration;
                if (!registration) {
                    logger.warn('[push-service] Service Worker registration is not available.');
                    return undefined;
                }
                if (!vapidKey) {
                    logger.warn('[push-service] Vapid Key is not initialized.');
                    return undefined;
                }
                try {
                    const applicationServerKey = urlBase64ToUint8Array(vapidKey);
                    const currentSubscription = await registration.pushManager.getSubscription();
                    if (currentSubscription?.options?.applicationServerKey) {
                        const currentSubscriptionApplicationServerKey = new Uint8Array(
                            currentSubscription.options.applicationServerKey,
                        );
                        if (
                            base64.encode(currentSubscriptionApplicationServerKey) !==
                            base64.encode(applicationServerKey)
                        ) {
                            logger.debug('[push-service] Another subscription found. Unsubscribing.');
                            await unsubscribePushSubscription(currentSubscription);
                        }
                    }
                    return await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
                    });
                } catch (err) {
                    logger.error('[push-service] An error occurred while obtaining the subscription.', err);
                    return undefined;
                }
            }

            const Notification = notification;

            if (!Notification) {
                return undefined;
            }
            if (Notification.permission !== 'granted') {
                logger.warn('[push-service] Notification permission was not granted.');
                return undefined;
            }
            if (!urlBase64ToUint8Array) {
                logger.warn('[push-service] UrlBase64ToUint8Array is not initialized.');
                return undefined;
            }
            const pushSubscription = await getPushSubscription(urlBase64ToUint8Array);
            if (!pushSubscription) {
                return undefined;
            }
            if (!pushSubscription.endpoint) {
                logger.warn('[push-service] Invalid subscription endpoint.');
                return undefined;
            }
            const p256dhKey = pushSubscription.getKey('p256dh');
            if (!p256dhKey || p256dhKey.byteLength === 0) {
                logger.warn('[push-service] Invalid p256dh key.');
                return undefined;
            }
            const authKey = pushSubscription.getKey('auth');
            if (!authKey || authKey.byteLength === 0) {
                logger.warn('[push-service] Invalid auth key.');
                return undefined;
            }
            subscription = {
                endpoint: pushSubscription.endpoint,
                expirationTime: pushSubscription.expirationTime,
                keys: {
                    p256dh: base64.encode(new Uint8Array(p256dhKey)),
                    auth: base64.encode(new Uint8Array(authKey)),
                },
            };

            logger.debug('[push-service] Subscription:', JSON.stringify(subscription));
            return subscription;
        },
        showNotification(title: string, options?: NotificationOptions) {
            function showInternal() {
                const worker = workerService.registration?.active ?? workerService.controller;
                if (!worker?.postMessage) {
                    logger.warn('[push-service] Unable to show notification. Service worker is not initialized.');
                    return false;
                }
                if (!subscription) {
                    logger.warn('[push-service] Unable to show notification. Notifications unavailable.');
                    return false;
                }
                worker.postMessage({ type: 'SHOW_NOTIFICATION', title: title, options: options });
                return true;
            }

            const shown = showInternal();
            if (!shown) {
                const Notification = notification;

                if (Notification) {
                    new Notification(title, options);
                    return true;
                }
                return false;
            }
            return shown;
        },
    };
}
