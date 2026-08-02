import qrcode from 'qrcode-generator';
import React, { useCallback } from 'react';

type QrCodeProps = {
    value: string;
};

const QrCode: React.FC<QrCodeProps> = ({ value }) => {
    const qrRef = useCallback(
        (el: HTMLDivElement | null) => {
            if (!el || !value) return;
            try {
                const qr = qrcode(0, 'M');
                qr.addData(value);
                qr.make();
                el.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1, scalable: true });
                const svg = el.querySelector('svg');
                if (svg) {
                    svg.style.width = '100%';
                    svg.style.height = '100%';
                    svg.style.display = 'block';
                    svg.removeAttribute('width');
                    svg.removeAttribute('height');
                }
            } catch {}
        },
        [value],
    );

    return (
        <div
            className='qr__code'
            ref={qrRef}
        />
    );
};

export default React.memo(QrCode);
