import React, { useCallback, useState } from 'react';

type LockResetPanelProps = {
    onReset: () => void;
};

const LockResetPanel: React.FC<LockResetPanelProps> = ({ onReset }) => {
    const [confirming, setConfirming] = useState(false);

    const confirm = useCallback(() => setConfirming(true), []);
    const cancel = useCallback(() => setConfirming(false), []);
    const erase = useCallback(() => {
        setConfirming(false);
        onReset();
    }, [onReset]);

    return (
        <div className='lock__reset-wrap'>
            {confirming ? (
                <div className='lock__reset-card'>
                    <div className='lock__reset-copy'>
                        Erase this device's encrypted vault — identity, contacts and history — permanently? This cannot
                        be undone, and forgotten passwords can't be recovered.
                    </div>
                    <div className='lock__reset-actions'>
                        <button
                            className='lock__reset-erase'
                            onClick={erase}
                        >
                            Erase &amp; start over
                        </button>
                        <button
                            className='lock__reset-cancel'
                            onClick={cancel}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <span
                    className='lock__reset-link'
                    onClick={confirm}
                >
                    Can't unlock? Reset this device
                </span>
            )}
        </div>
    );
};

export default React.memo(LockResetPanel);
