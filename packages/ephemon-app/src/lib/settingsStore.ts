export type IceServerSetting = {
    urls: string;
    username?: string;
    credential?: string;
};

export type Settings = {
    serverUrl: string;
    vapidKey: string;
    iceServers: Array<IceServerSetting>;
};

const STORAGE_KEY = 'ephemon_settings';

const TURN_USERNAME = 'b2vKdbNyBGvTBZi28ALDp7sZw58lCquPTjNCkP5O';
const TURN_CREDENTIAL = 'CUCijSIiw0hm6nqzgpEGcl6dAOm60cXmNniWrG5m';

const BUILD_PRESET: Settings =
    process.env.EPHEMON_PRESET === 'none'
        ? { serverUrl: '', vapidKey: '', iceServers: [] }
        : {
              serverUrl: process.env.EPHEMON_SERVER_URL,
              vapidKey: process.env.EPHEMON_VAPID_KEY,
              iceServers: [
                  { urls: 'stun:r1.ephemon.app:3478' },
                  { urls: 'stun:r2.ephemon.app:3478' },
                  { urls: 'stun:r3.ephemon.app:3478' },
                  {
                      urls: 'turn:r1.ephemon.app:3478',
                      username: TURN_USERNAME,
                      credential: TURN_CREDENTIAL,
                  },
                  {
                      urls: 'turn:r2.ephemon.app:3478',
                      username: TURN_USERNAME,
                      credential: TURN_CREDENTIAL,
                  },
                  {
                      urls: 'turn:r3.ephemon.app:3478',
                      username: TURN_USERNAME,
                      credential: TURN_CREDENTIAL,
                  },
              ],
          };

/**
 * Whatever this device treats as "the defaults". Normally the settings the build ships with,
 * but a build without a preset can be handed one at boot by whoever hosts it — see
 * {@link loadHostedPreset}.
 */
let preset: Settings = BUILD_PRESET;

export function hasPreset(): boolean {
    return preset.serverUrl.trim() !== '';
}

export function defaultSettings(): Settings {
    return cloneSettings(preset);
}

export function cloneSettings(value: Settings): Settings {
    return {
        serverUrl: value.serverUrl,
        vapidKey: value.vapidKey,
        iceServers: value.iceServers.map((server) => ({ ...server })),
    };
}

function sanitizeIceServer(value: unknown): IceServerSetting | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const { urls, username, credential } = value as Partial<IceServerSetting>;
    if (typeof urls !== 'string' || !urls.trim()) return undefined;
    const server: IceServerSetting = { urls: urls.trim() };
    if (typeof username === 'string' && username.trim()) server.username = username.trim();
    if (typeof credential === 'string' && credential.trim()) server.credential = credential.trim();
    return server;
}

function sanitize(value: unknown): Settings {
    const { serverUrl, vapidKey, iceServers } = (value ?? {}) as Partial<Settings>;
    return {
        serverUrl: typeof serverUrl === 'string' ? serverUrl.trim() : preset.serverUrl,
        vapidKey: typeof vapidKey === 'string' ? vapidKey.trim() : preset.vapidKey,
        iceServers: Array.isArray(iceServers)
            ? iceServers.map(sanitizeIceServer).filter((server): server is IceServerSetting => server !== undefined)
            : preset.iceServers.map((server) => ({ ...server })),
    };
}

function isPreset(value: Settings): boolean {
    return JSON.stringify(value) === JSON.stringify(sanitize(preset));
}

function read(): Settings {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return sanitize(JSON.parse(stored));
    } catch {}
    return defaultSettings();
}

let settings: Settings = read();

export function getSettings(): Settings {
    return settings;
}

/**
 * True once this device knows where to connect. Until then the app cannot reach a server,
 * so builds that ship without a preset must collect settings before anything else.
 */
export function isConfigured(): boolean {
    return settings.serverUrl.trim() !== '';
}

export function saveSettings(value: Settings): Settings {
    settings = sanitize(value);
    try {
        if (isPreset(settings)) {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        }
    } catch {}
    return settings;
}

/**
 * The document a host's bootstrap script prints, the one this screen imports, and the one a
 * host serves at {@link HOSTED_CONFIG_URL}.
 *
 * {
 *   "serverUrl": "https://ephemon.example.com",
 *   "vapidKey": "B…",
 *   "iceServers": [
 *     { "urls": "stun:coturn.example.com:3478" },
 *     { "urls": "turn:coturn.example.com:3478", "username": "…", "credential": "…" }
 *   ]
 * }
 */
export type ConfigParseResult = { ok: true; settings: Settings; notes: Array<string> } | { ok: false; error: string };

function flattenUrls(value: unknown): Array<unknown> {
    if (typeof value !== 'object' || value === null) return [value];
    const { urls } = value as { urls?: unknown };
    if (!Array.isArray(urls)) return [value];
    return urls.map((entry) => ({ ...(value as object), urls: entry }));
}

/**
 * Lenient on purpose: this runs on every keystroke in the JSON view, so it only rejects
 * documents it cannot read at all. Missing or empty values come back as empty settings and
 * are flagged by the fields themselves.
 */
export function parseConfig(text: string): ConfigParseResult {
    const trimmed = text.trim();
    if (!trimmed) {
        return { ok: true, settings: { serverUrl: '', vapidKey: '', iceServers: [] }, notes: [] };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return { ok: false, error: 'Not valid JSON yet — check for a missing comma, quote or brace.' };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: 'Expected a JSON object, starting with {.' };
    }

    const config = parsed as Partial<Settings>;

    if (config.serverUrl !== undefined && typeof config.serverUrl !== 'string') {
        return { ok: false, error: 'serverUrl must be a string.' };
    }
    if (config.vapidKey !== undefined && typeof config.vapidKey !== 'string') {
        return { ok: false, error: 'vapidKey must be a string.' };
    }
    if (config.iceServers !== undefined && !Array.isArray(config.iceServers)) {
        return { ok: false, error: 'iceServers must be an array.' };
    }

    const notes: Array<string> = [];
    const flattened = (config.iceServers ?? []).flatMap(flattenUrls);
    const iceServers = flattened
        .map(sanitizeIceServer)
        .filter((server): server is IceServerSetting => server !== undefined);
    const dropped = flattened.length - iceServers.length;
    if (dropped > 0) {
        notes.push(`Skipped ${dropped} ICE ${dropped === 1 ? 'entry' : 'entries'} with no urls.`);
    }

    return {
        ok: true,
        settings: {
            serverUrl: (config.serverUrl ?? '').trim(),
            vapidKey: (config.vapidKey ?? '').trim(),
            iceServers,
        },
        notes,
    };
}

const HOSTED_CONFIG_URL = '/config.json';
const HOSTED_CONFIG_TIMEOUT = 3000;

/**
 * A build without a preset still has to be usable the moment it is served, so whoever hosts it
 * can drop a config document next to the bundle and skip the setup screen entirely. Runs once,
 * before the first render, and stays quiet on anything it cannot use — a missing, unreachable
 * or unreadable document just leaves the setup screen in place.
 *
 * Settings already saved on the device outrank the hosted document: re-provisioning the host
 * must not silently move a device someone pointed somewhere else by hand.
 */
export async function loadHostedPreset(): Promise<void> {
    if (process.env.EPHEMON_PRESET !== 'none') return;
    if (isConfigured()) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOSTED_CONFIG_TIMEOUT);
    try {
        const response = await fetch(HOSTED_CONFIG_URL, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const result = parseConfig(await response.text());
        if (!result.ok || !result.settings.serverUrl) return;
        preset = result.settings;
        settings = read();
    } catch {
    } finally {
        clearTimeout(timeout);
    }
}

export function toConfigJson(value: Settings): string {
    return JSON.stringify(
        {
            serverUrl: value.serverUrl,
            vapidKey: value.vapidKey,
            iceServers: value.iceServers.map(({ urls, username, credential }) => ({
                urls,
                ...(username ? { username } : {}),
                ...(credential ? { credential } : {}),
            })),
        },
        null,
        2,
    );
}
