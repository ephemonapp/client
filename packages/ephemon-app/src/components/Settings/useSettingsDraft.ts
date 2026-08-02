import {
    defaultSettings,
    getSettings,
    hasPreset,
    isConfigured,
    parseConfig,
    Settings,
    toConfigJson,
} from '../../lib/settingsStore';
import { useCallback, useMemo, useState } from 'react';

export type IceDraft = {
    key: string;
    urls: string;
    username: string;
    credential: string;
};

export type Draft = {
    serverUrl: string;
    vapidKey: string;
    iceServers: Array<IceDraft>;
};

export type DraftErrors = {
    serverUrl: string | undefined;
    vapidKey: string | undefined;
    iceServers: Array<string | undefined>;
};

const ICE_URL_PATTERN = /^(stun|stuns|turn|turns):\S+$/i;
const VAPID_PATTERN = /^[A-Za-z0-9_-]+$/;

const EMPTY: Settings = { serverUrl: '', vapidKey: '', iceServers: [] };

let keySequence = 0;

function nextKey(): string {
    keySequence += 1;
    return `ice-${keySequence}`;
}

export function scheme(urls: string): 'stun' | 'turn' | undefined {
    const match = /^(stun|stuns|turn|turns):/i.exec(urls.trim());
    if (!match) return undefined;
    return match[1].toLowerCase().startsWith('stun') ? 'stun' : 'turn';
}

export function host(urls: string): string {
    return urls.trim().replace(/^(stun|stuns|turn|turns):/i, '');
}

function toDraft(settings: Settings): Draft {
    return {
        serverUrl: settings.serverUrl,
        vapidKey: settings.vapidKey,
        iceServers: settings.iceServers.map((server) => ({
            key: nextKey(),
            urls: server.urls,
            username: server.username ?? '',
            credential: server.credential ?? '',
        })),
    };
}

export function toSettings(draft: Draft): Settings {
    return {
        serverUrl: draft.serverUrl.trim(),
        vapidKey: draft.vapidKey.trim(),
        iceServers: draft.iceServers.map(({ urls, username, credential }) => ({
            urls: urls.trim(),
            ...(username.trim() ? { username: username.trim() } : {}),
            ...(credential.trim() ? { credential: credential.trim() } : {}),
        })),
    };
}

function validate(draft: Draft): DraftErrors {
    const url = draft.serverUrl.trim();
    let serverUrl: string | undefined;
    if (!url) {
        serverUrl = 'Enter the signalling server URL.';
    } else {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                serverUrl = 'Use an http:// or https:// URL.';
            }
        } catch {
            serverUrl = 'This is not a valid URL.';
        }
    }

    const key = draft.vapidKey.trim();
    const vapidKey =
        !key || VAPID_PATTERN.test(key) ? undefined : 'Use base64url characters only: A–Z, a–z, 0–9, - and _.';

    return {
        serverUrl,
        vapidKey,
        iceServers: draft.iceServers.map((server) =>
            ICE_URL_PATTERN.test(server.urls.trim()) ? undefined : 'Start with stun:, stuns:, turn: or turns:.',
        ),
    };
}

type State = {
    draft: Draft;
    json: string;
    jsonError: string | undefined;
    notes: Array<string>;
};

function stateFrom(settings: Settings, notes: Array<string> = []): State {
    return { draft: toDraft(settings), json: toConfigJson(settings), jsonError: undefined, notes };
}

export function useSettingsDraft() {
    const [state, setState] = useState<State>(() => stateFrom(getSettings()));

    /** Every field edit re-projects the JSON view, so the two never drift. */
    const edit = useCallback((mutate: (draft: Draft) => Draft) => {
        setState((previous) => {
            const draft = mutate(previous.draft);
            return { draft, json: toConfigJson(toSettings(draft)), jsonError: undefined, notes: [] };
        });
    }, []);

    const setJson = useCallback((text: string) => {
        setState((previous) => {
            const result = parseConfig(text);
            if (!result.ok) {
                return { ...previous, json: text, jsonError: result.error, notes: [] };
            }
            return { draft: toDraft(result.settings), json: text, jsonError: undefined, notes: result.notes };
        });
    }, []);

    const setServerUrl = useCallback((value: string) => edit((draft) => ({ ...draft, serverUrl: value })), [edit]);

    const setVapidKey = useCallback((value: string) => edit((draft) => ({ ...draft, vapidKey: value })), [edit]);

    const setIceField = useCallback(
        (key: string, field: keyof Omit<IceDraft, 'key'>, value: string) =>
            edit((draft) => ({
                ...draft,
                iceServers: draft.iceServers.map((server) =>
                    server.key === key ? { ...server, [field]: value } : server,
                ),
            })),
        [edit],
    );

    const addIceServer = useCallback(() => {
        const key = nextKey();
        edit((draft) => ({
            ...draft,
            iceServers: [...draft.iceServers, { key, urls: '', username: '', credential: '' }],
        }));
        return key;
    }, [edit]);

    const removeIceServer = useCallback(
        (key: string) =>
            edit((draft) => ({ ...draft, iceServers: draft.iceServers.filter((server) => server.key !== key) })),
        [edit],
    );

    /** Back to what is saved, or — when nothing is saved yet — back to an empty config. */
    const [restoreTarget] = useState<Settings>(() => (isConfigured() ? getSettings() : EMPTY));
    const restore = useCallback(() => setState(stateFrom(restoreTarget)), [restoreTarget]);

    /** Back to the settings this build ships with. Absent from builds without a preset. */
    const [preset] = useState<Settings>(defaultSettings);
    const resetToPreset = useCallback(() => setState(stateFrom(preset)), [preset]);

    const draftJson = useMemo(() => toConfigJson(toSettings(state.draft)), [state.draft]);

    /** Neither is offered while the draft already matches what it would put back. */
    const canRestore = useMemo(() => draftJson !== toConfigJson(restoreTarget), [draftJson, restoreTarget]);
    const canResetToPreset = useMemo(() => draftJson !== toConfigJson(preset), [draftJson, preset]);

    const errors = useMemo(() => validate(state.draft), [state.draft]);
    const invalid =
        errors.serverUrl !== undefined ||
        errors.vapidKey !== undefined ||
        errors.iceServers.some((error) => error !== undefined);

    return {
        draft: state.draft,
        json: state.json,
        jsonError: state.jsonError,
        notes: state.notes,
        errors,
        invalid,
        setJson,
        setServerUrl,
        setVapidKey,
        setIceField,
        addIceServer,
        removeIceServer,
        restore,
        canRestore,
        resetToPreset,
        canResetToPreset,
        hasPresetBuild: hasPreset(),
    };
}
