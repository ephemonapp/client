import { isConfigured } from '../../lib/settingsStore';
import { useTheme } from '../../theme/ThemeProvider';
import SettingsScreen from '../Settings/SettingsScreen';
import { CloseIcon, GearIcon, LockIcon, MoonIcon, ShieldIcon, SunIcon } from '../icons';
import Modal from '../modals/Modal';
import PrivacyModal from '../modals/PrivacyModal';
import LockLanding from './LockLanding';
import LockPasswordForm, { PasswordState } from './LockPasswordForm';
import LockResetPanel from './LockResetPanel';
import './LockScreen.css';
import React, { useCallback, useState } from 'react';

type LockScreenProps = {
    passwordState: PasswordState;
    onSubmit: (password: string) => void;
    onReset: () => void;
};

const SOURCE_URL = 'https://github.com/ephemonapp/client';
const PROTOCOL_URL = `${process.env.EPHEMON_CLIENT_URL}/docs/protocol.svg?_=${process.env.EPHEMON_BUILD_TIMESTAMP}`;

const LockScreen: React.FC<LockScreenProps> = ({ passwordState, onSubmit, onReset }) => {
    const { theme, toggleTheme } = useTheme();
    const [privacyOpen, setPrivacyOpen] = useState(false);
    const [configured, setConfigured] = useState(isConfigured);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const openPrivacy = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        setPrivacyOpen(true);
    }, []);
    const closePrivacy = useCallback(() => setPrivacyOpen(false), []);

    const openSettings = useCallback(() => setSettingsOpen(true), []);
    const closeSettings = useCallback(() => setSettingsOpen(false), []);
    const onSettingsSaved = useCallback(() => {
        setConfigured(isConfigured());
        setSettingsOpen(false);
    }, []);

    const settingsVisible = settingsOpen || !configured;

    return (
        <div className='lock'>
            <LockLanding />

            <div className={settingsVisible ? 'lock__form lock__form--settings' : 'lock__form'}>
                {/* Both controls live in the column, not in the screens, so the theme toggle
                    keeps its place and the gear turns into the close button on the spot. */}
                <div className='lock__actions'>
                    <button
                        className='lock__action'
                        title='Theme'
                        onClick={toggleTheme}
                    >
                        {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
                    </button>
                    {configured && (
                        <button
                            className='lock__action'
                            title={settingsVisible ? 'Close settings' : 'Settings'}
                            onClick={settingsVisible ? closeSettings : openSettings}
                        >
                            {settingsVisible ? <CloseIcon /> : <GearIcon />}
                        </button>
                    )}
                </div>

                {settingsVisible ? (
                    <SettingsScreen onSaved={onSettingsSaved} />
                ) : (
                    <div className='lock__card'>
                        <div className='lock__title'>Unlock {process.env.EPHEMON_APP_NAME}</div>
                        <div className='lock__form-sub'>
                            Enter your password to open this device. If it's new, this password creates your encrypted
                            vault.
                        </div>
                        <LockPasswordForm
                            passwordState={passwordState}
                            onSubmit={onSubmit}
                        />
                        <div className='lock__reassure'>
                            <LockIcon
                                w={12}
                                h={12}
                                sw={1.8}
                            />
                            encrypted on this device · never uploaded
                        </div>
                        <div className='lock__links'>
                            <a
                                href='#privacy'
                                onClick={openPrivacy}
                            >
                                <ShieldIcon
                                    w={12}
                                    h={12}
                                    sw={1.7}
                                />
                                Privacy
                            </a>
                            <a
                                href={SOURCE_URL}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                Source
                            </a>
                            <a
                                href={PROTOCOL_URL}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                Protocol
                            </a>
                        </div>
                        <LockResetPanel onReset={onReset} />
                    </div>
                )}
            </div>
            {privacyOpen && (
                <Modal onClose={closePrivacy}>
                    <PrivacyModal onClose={closePrivacy} />
                </Modal>
            )}
        </div>
    );
};

export default React.memo(LockScreen);
