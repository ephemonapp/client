import { Logger } from '../utils/logger';

export type WorkerServiceConfig = {
    version?: string;

    onNewVersion?: () => void;
};

type WorkerServiceEffectiveConfig = WorkerServiceConfig & {
    navigator: Navigator;
};

export interface WorkerService {
    initialize(config: WorkerServiceEffectiveConfig): Promise<void>;

    get registration(): ServiceWorkerRegistration | undefined;

    get container(): ServiceWorkerContainer | undefined;

    get controller(): ServiceWorker | null | undefined;
}

export function getWorkerService(logger: Logger): WorkerService {
    let serviceWorker: ServiceWorkerContainer | undefined;
    let registration: ServiceWorkerRegistration | undefined;
    return {
        get registration(): ServiceWorkerRegistration | undefined {
            return registration;
        },
        get container(): ServiceWorkerContainer | undefined {
            return serviceWorker;
        },
        get controller(): ServiceWorker | null | undefined {
            return serviceWorker?.controller;
        },
        async initialize(config: WorkerServiceEffectiveConfig): Promise<void> {
            const navigator = config.navigator;
            if (!('serviceWorker' in navigator)) {
                logger.warn('[worker-service] Service Worker is not supported in this browser.');
                return;
            }
            serviceWorker = navigator.serviceWorker;
            try {
                registration = await serviceWorker.register(`/service-worker.js?_=${config.version}`);
                logger.debug('[worker-service] Registered with scope:', registration.scope);
                registration = await serviceWorker.ready;
                logger.debug('[worker-service] Ready to use.');
            } catch (err) {
                logger.warn('[worker-service] Error registering:', err);
            }
            serviceWorker.addEventListener('message', (event: any) => {
                if (event.data && event.data.type === 'NEW_VERSION_AVAILABLE') {
                    logger.debug('[worker-service] New version is available.');
                    if (config.onNewVersion) {
                        config.onNewVersion();
                    }
                }
            });
            logger.debug('[worker-service] Initialized.');
        },
    };
}
