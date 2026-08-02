import React from 'react';

type IconProps = {
    w?: number;
    h?: number;
    sw?: number;
    style?: React.CSSProperties;
    className?: string;
};

export const LockIcon = React.memo(function LockIcon({ w = 16, h = 16, sw = 1.8, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <rect
                x='5'
                y='11'
                width='14'
                height='9'
                rx='2'
            />
            <path d='M8 11V8a4 4 0 0 1 8 0v3' />
        </svg>
    );
});

export const UsersIcon = React.memo(function UsersIcon({ w = 26, h = 26, sw = 1.6, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            style={style}
            className={className}
        >
            <circle
                cx='9'
                cy='8'
                r='3.4'
            />
            <path d='M3 20a6 6 0 0 1 11.5-2' />
            <path d='M17 9l4 4M21 9l-4 4' />
        </svg>
    );
});

export const P2PIcon = React.memo(function P2PIcon({ w = 26, h = 26, sw = 1.6, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            style={style}
            className={className}
        >
            <circle
                cx='12'
                cy='12'
                r='2'
            />
            <path d='M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9M4.7 4.7a10 10 0 0 0 0 14.6M19.3 4.7a10 10 0 0 1 0 14.6' />
        </svg>
    );
});

export const PulseIcon = React.memo(function PulseIcon({ w = 26, h = 26, sw = 1.6, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M3 12h2l2-6 4 15 3-10 2 5 1.5-4H21' />
        </svg>
    );
});

export const ShieldIcon = React.memo(function ShieldIcon({ w = 12, h = 12, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            style={style}
            className={className}
        >
            <path d='M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3z' />
        </svg>
    );
});

export const ShieldCheckIcon = React.memo(function ShieldCheckIcon({
    w = 13,
    h = 13,
    sw = 1.7,
    style,
    className,
}: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            style={style}
            className={className}
        >
            <path d='M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3z' />
            <path d='M9 12l2 2 4-4' />
        </svg>
    );
});

export const SunIcon = React.memo(function SunIcon({ w = 16, h = 16, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            style={style}
            className={className}
        >
            <circle
                cx='12'
                cy='12'
                r='4'
            />
            <path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' />
        </svg>
    );
});

export const MoonIcon = React.memo(function MoonIcon({ w = 16, h = 16, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' />
        </svg>
    );
});

export const HelpIcon = React.memo(function HelpIcon({ w = 13, h = 13, sw = 1.8, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <circle
                cx='12'
                cy='12'
                r='9'
            />
            <path d='M9.4 9.2a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 3.9' />
            <path d='M12 17.4h.01' />
        </svg>
    );
});

export const GearIcon = React.memo(function GearIcon({ w = 16, h = 16, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <circle
                cx='12'
                cy='12'
                r='3'
            />
            <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
        </svg>
    );
});

export const QrIcon = React.memo(function QrIcon({ w = 17, h = 17, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='currentColor'
            style={style}
            className={className}
        >
            <path d='M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm10-2h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2z' />
        </svg>
    );
});

export const ScanIcon = React.memo(function ScanIcon({ w = 18, h = 18, sw = 1.9, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3' />
            <rect
                x='8.5'
                y='8.5'
                width='7'
                height='7'
                rx='1'
            />
        </svg>
    );
});

export const ArrowRightIcon = React.memo(function ArrowRightIcon({
    w = 15,
    h = 15,
    sw = 2.2,
    style,
    className,
}: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M5 12h14M13 6l6 6-6 6' />
        </svg>
    );
});

export const ArrowDownIcon = React.memo(function ArrowDownIcon({
    w = 18,
    h = 18,
    sw = 2.2,
    style,
    className,
}: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M12 5v14M6 13l6 6 6-6' />
        </svg>
    );
});

export const BackIcon = React.memo(function BackIcon({ w = 20, h = 20, sw = 2.2, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M15 5l-7 7 7 7' />
        </svg>
    );
});

export const KebabIcon = React.memo(function KebabIcon({ w = 18, h = 18, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='currentColor'
            style={style}
            className={className}
        >
            <circle
                cx='12'
                cy='5'
                r='1.6'
            />
            <circle
                cx='12'
                cy='12'
                r='1.6'
            />
            <circle
                cx='12'
                cy='19'
                r='1.6'
            />
        </svg>
    );
});

export const PencilIcon = React.memo(function PencilIcon({ w = 16, h = 16, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z' />
            <path d='M13.5 6.5l3 3' />
        </svg>
    );
});

export const TrashIcon = React.memo(function TrashIcon({ w = 16, h = 16, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14' />
        </svg>
    );
});

export const CloseIcon = React.memo(function CloseIcon({ w = 16, h = 16, sw = 2, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M18 6L6 18M6 6l12 12' />
        </svg>
    );
});

export const ReplyIcon = React.memo(function ReplyIcon({ w = 15, h = 15, sw = 1.8, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M10 9V5l-7 7 7 7v-4c5 0 8 1 10 5 0-7-3-11-10-11z' />
        </svg>
    );
});

export const DoubleCheckIcon = React.memo(function DoubleCheckIcon({
    w = 17,
    h = 12,
    sw = 3,
    style,
    className,
}: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 30 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M2 13l4 4L15 8' />
            <path d='M13 17L24 6' />
        </svg>
    );
});

export const CheckIcon = React.memo(function CheckIcon({ w = 14, h = 12, sw = 3, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M5 13l4 4L19 7' />
        </svg>
    );
});

export const SpinnerIcon = React.memo(function SpinnerIcon({ w = 12, h = 12, sw = 2.4, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            style={{ animation: 'spin .9s linear infinite', ...style }}
            className={className}
        >
            <path d='M12 3a9 9 0 1 0 9 9' />
        </svg>
    );
});

export const WarningIcon = React.memo(function WarningIcon({ w = 14, h = 14, sw = 1.9, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M12 3.6 2.6 20h18.8L12 3.6Z' />
            <path d='M12 9.5v4.4' />
            <path d='M12 17h.01' />
        </svg>
    );
});

export const SmileyIcon = React.memo(function SmileyIcon({ w = 14, h = 14, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <circle
                cx='12'
                cy='12'
                r='9'
            />
            <path d='M8.5 14.5s1.3 1.6 3.5 1.6 3.5-1.6 3.5-1.6' />
            <path d='M9 9.5h.01M15 9.5h.01' />
        </svg>
    );
});

export const SendIcon = React.memo(function SendIcon({ w = 18, h = 18, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='currentColor'
            style={style}
            className={className}
        >
            <path d='M3.4 20.4l17.5-8.4c.8-.4.8-1.6 0-2L3.4 1.6C2.7 1.3 2 1.8 2 2.6l.01 5c0 .5.4.9.9 1l10.6 1.4L3.9 12.4c-.5.1-.89.5-.89 1L3 18.4c0 .8.7 1.3 1.4 1z' />
        </svg>
    );
});

export const CameraIcon = React.memo(function CameraIcon({ w = 40, h = 40, sw = 1.5, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            style={style}
            className={className}
        >
            <path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' />
            <circle
                cx='12'
                cy='13'
                r='4'
            />
        </svg>
    );
});

export const RefreshIcon = React.memo(function RefreshIcon({ w = 16, h = 16, sw = 1.7, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            className={className}
        >
            <path d='M21 12a9 9 0 1 1-2.64-6.36' />
            <path d='M21 3v6h-6' />
        </svg>
    );
});

export const PlusIcon = React.memo(function PlusIcon({ w = 24, h = 24, sw = 2.4, style, className }: IconProps) {
    return (
        <svg
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={sw}
            strokeLinecap='round'
            style={style}
            className={className}
        >
            <path d='M12 5v14M5 12h14' />
        </svg>
    );
});
