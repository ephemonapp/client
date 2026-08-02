import { PasswordState } from '../../hooks/usePasswordCheck';
import { LockIcon } from '../icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export type { PasswordState };

const FAILURE_MESSAGE: Partial<Record<NonNullable<PasswordState>, string>> = {
    invalid: 'Invalid password.',
    blocked: 'Another tab has this vault open. Close it and try again.',
    stale: 'This tab is out of date. Reload the page to continue.',
    unavailable: 'This browser blocked local storage, so the vault cannot be opened.',
    error: 'The vault could not be opened.',
};

type LockPasswordFormProps = {
    passwordState: PasswordState;
    onSubmit: (password: string) => void;
};

const LockPasswordForm: React.FC<LockPasswordFormProps> = ({ passwordState, onSubmit }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [shake, setShake] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const shakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const triggerShake = useCallback(() => {
        setShake(true);
        clearTimeout(shakeTimer.current);
        shakeTimer.current = setTimeout(() => setShake(false), 500);
    }, []);

    useEffect(() => {
        const message = passwordState === undefined ? undefined : FAILURE_MESSAGE[passwordState];
        if (message === undefined) return;
        setSubmitting(false);
        setError(message);
        triggerShake();
    }, [passwordState, triggerShake]);

    useEffect(() => () => clearTimeout(shakeTimer.current), []);

    const unlock = useCallback(() => {
        if (submitting) return;
        if (!password) {
            setError('Enter a password.');
            triggerShake();
            return;
        }
        setSubmitting(true);
        setError('');
        onSubmit(password);
    }, [submitting, password, triggerShake, onSubmit]);

    return (
        <form className='lock__unlock-form'>
            <div className='lock__label'>Password</div>
            <div className={`lock__field${shake ? ' shake' : ''}`}>
                <LockIcon
                    w={16}
                    h={16}
                    sw={1.8}
                />
                <input
                    type='password'
                    autoComplete='off'
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        setError('');
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            unlock();
                        }
                    }}
                    placeholder='••••••••'
                />
            </div>
            <div className='lock__error'>{error}</div>
            <button
                className='lock__submit'
                type='button'
                onClick={unlock}
            >
                {passwordState === 'migrating' ? 'Upgrading vault…' : submitting ? 'Unlocking…' : 'Unlock'}
            </button>
        </form>
    );
};

export default React.memo(LockPasswordForm);
