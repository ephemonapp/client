import { getLogger } from '../../lib/logStore';
import React, { useCallback, useState } from 'react';
import { prepareWasm, useZxing } from 'react-zxing';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm';

type ScannerViewProps = {
    onResult: (text: string) => void;
};

prepareWasm({ wasmUrl: `${wasmUrl}?_=${process.env.EPHEMON_BUILD_TIMESTAMP}` }).catch((error) =>
    getLogger().error('[scanner] Unable to initialize the zxing wasm reader.', error),
);

const ScannerView: React.FC<ScannerViewProps> = ({ onResult }) => {
    const [streaming, setStreaming] = useState(false);

    const onPlaying = useCallback(() => setStreaming(true), []);

    const { ref } = useZxing({
        onDecodeResult: (result) => {
            const text = result.rawValue?.trim();
            if (text) onResult(text);
        },
        onError: (error) => getLogger().error('[scanner] Unable to start the camera stream.', error),
    });

    return (
        <>
            {!streaming && <div className='scanner__video skeleton skeleton--dark' />}
            <video
                ref={ref as React.RefObject<HTMLVideoElement>}
                className='scanner__video'
                onPlaying={onPlaying}
            />
        </>
    );
};

export default React.memo(ScannerView);
