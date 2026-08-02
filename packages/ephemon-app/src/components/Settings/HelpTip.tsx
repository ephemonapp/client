import { HelpIcon } from '../icons';
import React, { useEffect, useRef, useState } from 'react';

type HelpTipProps = {
    label: string;
    children: React.ReactNode;
};

const HelpTip: React.FC<HelpTipProps> = ({ label, children }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <span
            className='cfg__help'
            ref={ref}
        >
            <button
                className='cfg__help-btn'
                aria-label={label}
                aria-expanded={open}
                onClick={() => setOpen((previous) => !previous)}
            >
                <HelpIcon />
            </button>
            {open && (
                <span
                    className='cfg__help-tip'
                    role='tooltip'
                >
                    {children}
                </span>
            )}
        </span>
    );
};

export default React.memo(HelpTip);
