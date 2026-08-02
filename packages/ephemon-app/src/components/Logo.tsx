import './Logo.css';
import React from 'react';

type LogoProps = {
    size: number;
    animate?: boolean;
    compact?: boolean;
    style?: React.CSSProperties;
    className?: string;
};

const Logo: React.FC<LogoProps> = ({ size, animate = true, compact, style, className }) => {
    const small = compact ?? size < 48;

    return (
        <svg
            width={size}
            height={size}
            viewBox='0 0 32 32'
            className={className}
            style={style}
            aria-hidden='true'
        >
            {small ? (
                <>
                    <path
                        className={animate ? 'eph-logo__core' : undefined}
                        d='M20.249 20.499A8.6 8.6 0 1 1 11.501 11.751A9.8 9.8 0 0 0 20.249 20.499Z'
                        fill='currentColor'
                    />
                    <circle
                        className={animate ? 'eph-logo__ghost' : undefined}
                        cx='21.25'
                        cy='10.75'
                        r='5.4'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='3.8'
                        strokeDasharray='5.7 5.6'
                    />
                </>
            ) : (
                <>
                    <circle
                        className={animate ? 'eph-logo__shell' : undefined}
                        cx='20.64'
                        cy='11.36'
                        r='8.2'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='0.65'
                        strokeDasharray='1.3 1.1'
                    />
                    <path
                        className={animate ? 'eph-logo__core' : undefined}
                        d='M19.639 20.913A8.4 8.4 0 1 1 11.087 12.361A9.6 9.6 0 0 0 19.639 20.913Z'
                        fill='currentColor'
                    />
                    <circle
                        className={animate ? 'eph-logo__ghost' : undefined}
                        cx='20.64'
                        cy='11.36'
                        r='5.4'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2.2'
                        strokeDasharray='3.8 3'
                    />
                </>
            )}
        </svg>
    );
};

export default React.memo(Logo);
