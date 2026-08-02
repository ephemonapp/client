import { ArrowDownIcon } from '../icons';
import React, { useCallback, useRef, useState } from 'react';

type ConfigImportProps = {
    json: string;
    jsonError: string | undefined;
    notes: Array<string>;
    onJson: (text: string) => void;
};

const ConfigImport: React.FC<ConfigImportProps> = ({ json, jsonError, notes, onJson }) => {
    const [pasting, setPasting] = useState(false);
    const [fileError, setFileError] = useState<string | undefined>();
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const onFile = useCallback(
        (file: File | undefined) => {
            if (!file) return;
            setFileError(undefined);
            file.text()
                .then(onJson)
                .catch(() => setFileError('Could not read that file.'));
        },
        [onJson],
    );

    return (
        <div className='cfg__import'>
            {pasting ? (
                <textarea
                    className='cfg__box cfg__json'
                    value={json}
                    spellCheck={false}
                    autoComplete='off'
                    autoFocus
                    aria-label='Server config JSON'
                    onChange={(e) => onJson(e.target.value)}
                />
            ) : (
                <div
                    className={dragging ? 'cfg__box cfg__drop cfg__drop--over' : 'cfg__box cfg__drop'}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        onFile(e.dataTransfer.files[0]);
                    }}
                >
                    <ArrowDownIcon
                        w={17}
                        h={17}
                        sw={2}
                    />
                    <div className='cfg__drop-title'>
                        <span className='cfg__drop-drag'>Drop your config file here</span>
                        <span className='cfg__drop-tap'>Add your config file</span>
                    </div>
                    <button
                        className='cfg__choose'
                        onClick={() => fileRef.current?.click()}
                    >
                        Choose file…
                    </button>
                </div>
            )}

            <button
                className='cfg__swap'
                onClick={() => setPasting((previous) => !previous)}
            >
                {pasting ? 'Use a file instead' : 'Paste JSON instead'}
            </button>

            <input
                ref={fileRef}
                className='cfg__file'
                type='file'
                accept='.json,application/json'
                onChange={(e) => {
                    onFile(e.target.files?.[0]);
                    e.target.value = '';
                }}
            />

            {(fileError ?? jsonError) && <div className='cfg__err'>{fileError ?? jsonError}</div>}
            {notes.map((note) => (
                <div
                    key={note}
                    className='cfg__note'
                >
                    {note}
                </div>
            ))}
        </div>
    );
};

export default React.memo(ConfigImport);
