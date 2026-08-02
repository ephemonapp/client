import { hasEphemonCore } from '../../lib/ephemonCore';
import { isConfigured, saveSettings } from '../../lib/settingsStore';
import { ArrowRightIcon, LockIcon, PlusIcon } from '../icons';
import ConfigImport from './ConfigImport';
import HelpTip from './HelpTip';
import './Settings.css';
import { host, scheme, toSettings, useSettingsDraft } from './useSettingsDraft';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

type SettingsScreenProps = {
    onSaved: () => void;
};

const SettingsScreen: React.FC<SettingsScreenProps> = ({ onSaved }) => {
    const {
        draft,
        json,
        jsonError,
        notes,
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
        hasPresetBuild,
    } = useSettingsDraft();

    const [openKey, setOpenKey] = useState<string | undefined>();
    const [configured] = useState(isConfigured);
    const [confirmingPreset, setConfirmingPreset] = useState(false);

    const vapidRef = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const el = vapidRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [draft.vapidKey]);

    const applyPreset = useCallback(() => {
        setConfirmingPreset(false);
        resetToPreset();
    }, [resetToPreset]);

    const save = useCallback(() => {
        if (invalid) return;
        saveSettings(toSettings(draft));
        if (hasEphemonCore()) {
            window.location.reload();
            return;
        }
        onSaved();
    }, [draft, invalid, onSaved]);

    return (
        <div className='cfg'>
            <header className='cfg__head'>
                <h2 className='cfg__title'>{configured ? 'Settings' : `Set up ${process.env.EPHEMON_APP_NAME}`}</h2>
                <p className='cfg__sub'>
                    {configured
                        ? 'Where this device connects. Stored here, never uploaded.'
                        : 'Point this device at a server. Your host prints a config you can load here.'}
                </p>
            </header>

            <div className='cfg__body'>
                <ConfigImport
                    json={json}
                    jsonError={jsonError}
                    notes={notes}
                    onJson={setJson}
                />

                <div className='cfg__rule'>
                    <span>or set it up by hand</span>
                    <i className='cfg__hair' />
                </div>

                <ol className='cfg__path'>
                    <li className='cfg__hop cfg__hop--edge'>
                        <span className='cfg__dot cfg__dot--edge' />
                        <span className='cfg__edge-label'>this device</span>
                    </li>

                    <li className='cfg__hop'>
                        <span className='cfg__dot cfg__dot--pri' />
                        <div className='cfg__hop-head'>
                            <span className='cfg__kicker'>signalling server</span>
                            <HelpTip label='About the signalling server'>
                                <b>Required.</b> The only server {process.env.EPHEMON_APP_NAME} talks to. It introduces
                                two devices so they can open a direct channel, and relays the sealed handshake. It never
                                sees your messages.
                            </HelpTip>
                        </div>
                        <input
                            className='cfg__line'
                            value={draft.serverUrl}
                            spellCheck={false}
                            autoComplete='off'
                            placeholder='https://ephemon.example.com'
                            aria-label='Signalling server URL'
                            onChange={(e) => setServerUrl(e.target.value)}
                        />
                        {errors.serverUrl && <div className='cfg__err'>{errors.serverUrl}</div>}

                        <div className='cfg__branch'>
                            <div className='cfg__hop-head'>
                                <span className='cfg__kicker cfg__kicker--sub'>push · vapid public key</span>
                                <HelpTip label='About the VAPID public key'>
                                    <b>Optional.</b> Lets the server wake this device when a message arrives while{' '}
                                    {process.env.EPHEMON_APP_NAME} is closed. Your host prints this key alongside the
                                    server URL. Leave it empty and push notifications stay off.
                                </HelpTip>
                            </div>
                            <textarea
                                ref={vapidRef}
                                className='cfg__line cfg__blob'
                                value={draft.vapidKey}
                                spellCheck={false}
                                autoComplete='off'
                                rows={1}
                                placeholder='Empty — push stays off'
                                aria-label='VAPID public key'
                                onChange={(e) => setVapidKey(e.target.value)}
                            />
                            {errors.vapidKey && <div className='cfg__err'>{errors.vapidKey}</div>}
                        </div>
                    </li>

                    <li className='cfg__hop'>
                        <span className='cfg__dot cfg__dot--fork' />
                        <div className='cfg__hop-head'>
                            <span className='cfg__kicker'>ice servers</span>
                            <HelpTip label='About ICE servers'>
                                <b>Optional, but recommended.</b> STUN helps two devices find a direct path to each
                                other. TURN relays the encrypted traffic when a direct path is blocked. With none of
                                them, peers only reach each other on the same network.
                            </HelpTip>
                            <i className='cfg__hair' />
                            <em className='cfg__count'>{draft.iceServers.length}</em>
                        </div>

                        {draft.iceServers.length === 0 && (
                            <div className='cfg__empty'>
                                No ICE servers. Peers can only connect on the same network.
                            </div>
                        )}

                        {draft.iceServers.map((server, index) => {
                            const kind = scheme(server.urls);
                            const open = openKey === server.key;
                            return (
                                <div
                                    key={server.key}
                                    className={open ? 'cfg__ice cfg__ice--open' : 'cfg__ice'}
                                >
                                    <button
                                        className='cfg__row'
                                        aria-expanded={open}
                                        onClick={() => setOpenKey(open ? undefined : server.key)}
                                    >
                                        <span
                                            className={
                                                kind ? `cfg__chip cfg__chip--${kind}` : 'cfg__chip cfg__chip--none'
                                            }
                                        >
                                            {kind ?? 'set'}
                                        </span>
                                        <span className='cfg__host'>{host(server.urls) || 'New endpoint'}</span>
                                        {server.username !== '' && (
                                            <LockIcon
                                                w={11}
                                                h={11}
                                                sw={2}
                                            />
                                        )}
                                        <ArrowRightIcon
                                            w={13}
                                            h={13}
                                            sw={2}
                                            className='cfg__chev'
                                        />
                                    </button>
                                    {open && (
                                        <div className='cfg__edit'>
                                            <input
                                                className='cfg__line'
                                                value={server.urls}
                                                spellCheck={false}
                                                autoComplete='off'
                                                placeholder='stun:host:3478'
                                                aria-label='Endpoint URL'
                                                onChange={(e) => setIceField(server.key, 'urls', e.target.value)}
                                            />
                                            {kind === 'turn' && (
                                                <>
                                                    <input
                                                        className='cfg__line'
                                                        value={server.username}
                                                        spellCheck={false}
                                                        autoComplete='off'
                                                        placeholder='username'
                                                        aria-label='Username'
                                                        onChange={(e) =>
                                                            setIceField(server.key, 'username', e.target.value)
                                                        }
                                                    />
                                                    <input
                                                        className='cfg__line'
                                                        value={server.credential}
                                                        spellCheck={false}
                                                        autoComplete='off'
                                                        placeholder='credential'
                                                        aria-label='Credential'
                                                        onChange={(e) =>
                                                            setIceField(server.key, 'credential', e.target.value)
                                                        }
                                                    />
                                                </>
                                            )}
                                            <button
                                                className='cfg__remove'
                                                onClick={() => {
                                                    setOpenKey(undefined);
                                                    removeIceServer(server.key);
                                                }}
                                            >
                                                Remove endpoint
                                            </button>
                                        </div>
                                    )}
                                    {errors.iceServers[index] && (
                                        <div className='cfg__err'>{errors.iceServers[index]}</div>
                                    )}
                                </div>
                            );
                        })}

                        <button
                            className='cfg__add'
                            onClick={() => setOpenKey(addIceServer())}
                        >
                            <PlusIcon
                                w={13}
                                h={13}
                                sw={2.4}
                            />
                            Add server
                        </button>
                    </li>

                    <li className='cfg__hop cfg__hop--edge cfg__hop--last'>
                        <span className='cfg__dot cfg__dot--edge' />
                        <span className='cfg__edge-label'>your peer</span>
                    </li>
                </ol>
            </div>

            <footer className='cfg__foot'>
                {confirmingPreset ? (
                    <div className='cfg__confirm'>
                        <div className='cfg__confirm-copy'>
                            Replace the server, push key and ICE list with the ones this install came with? Whatever you
                            have typed here is discarded. Your saved settings stay untouched until you press{' '}
                            {configured ? 'Save' : `Start ${process.env.EPHEMON_APP_NAME}`}.
                        </div>
                        <div className='cfg__confirm-actions'>
                            <button
                                className='cfg__confirm-yes'
                                onClick={applyPreset}
                            >
                                Reset to defaults
                            </button>
                            <button
                                className='cfg__confirm-no'
                                onClick={() => setConfirmingPreset(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className='cfg__foot-left'>
                            <button
                                className='cfg__ghost'
                                disabled={!canRestore}
                                onClick={restore}
                            >
                                {configured ? 'Restore' : 'Reset'}
                            </button>
                            {hasPresetBuild && (
                                <button
                                    className='cfg__danger'
                                    disabled={!canResetToPreset}
                                    onClick={() => setConfirmingPreset(true)}
                                >
                                    Reset to defaults
                                </button>
                            )}
                        </div>
                        <button
                            className='cfg__save'
                            disabled={invalid}
                            onClick={save}
                        >
                            {configured ? 'Save' : `Start ${process.env.EPHEMON_APP_NAME}`}
                        </button>
                    </>
                )}
            </footer>
        </div>
    );
};

export default React.memo(SettingsScreen);
