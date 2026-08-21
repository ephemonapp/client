import { displayName, hashColor, initials } from '../../lib/identicon';
import React, { useCallback, useState } from 'react';

export type PickableContact = {
    publicKey: string;
    name: string | undefined;
};

type ContactPickerModalProps = {
    title: string;
    subtitle: string;
    confirmLabel: string;
    contacts: ReadonlyArray<PickableContact>;
    namePlaceholder?: string;
    onCancel: () => void;
    onConfirm: (publicKeys: ReadonlyArray<string>, name: string) => void;
};

const ContactPickerModal: React.FC<ContactPickerModalProps> = ({
    title,
    subtitle,
    confirmLabel,
    contacts,
    namePlaceholder,
    onCancel,
    onConfirm,
}) => {
    const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
    const [name, setName] = useState('');

    const toggle = useCallback((publicKey: string) => {
        setSelected((previous) =>
            previous.includes(publicKey)
                ? previous.filter((candidate) => candidate !== publicKey)
                : [...previous, publicKey],
        );
    }, []);

    const named = namePlaceholder === undefined || name.trim().length > 0;

    const confirm = useCallback(() => {
        if (selected.length > 0 && named) onConfirm(selected, name.trim());
    }, [name, named, onConfirm, selected]);

    return (
        <div>
            <div className='rename__title'>{title}</div>
            <div className='rename__sub'>{subtitle}</div>
            {namePlaceholder !== undefined && (
                <input
                    className='rename__input'
                    value={name}
                    autoFocus
                    placeholder={namePlaceholder}
                    onChange={(event) => setName(event.target.value)}
                />
            )}
            {contacts.length === 0 ? (
                <div className='contact-picker__empty'>No contacts yet. Connect to someone first.</div>
            ) : (
                <div className='contact-picker__list'>
                    {contacts.map((contact) => (
                        <div
                            key={contact.publicKey}
                            className={`contact-picker__row${selected.includes(contact.publicKey) ? ' contact-picker__row--selected' : ''}`}
                            onClick={() => toggle(contact.publicKey)}
                        >
                            <div
                                className='contact-picker__avatar'
                                style={{ background: hashColor(contact.publicKey) }}
                            >
                                {initials(contact.name, contact.publicKey)}
                            </div>
                            <div className='contact-picker__name'>{displayName(contact.name, contact.publicKey)}</div>
                        </div>
                    ))}
                </div>
            )}
            <div className='rename__actions'>
                <button
                    className='rename__cancel'
                    onClick={onCancel}
                >
                    Cancel
                </button>
                <button
                    className='rename__save contact-picker__confirm'
                    disabled={selected.length === 0 || !named}
                    onClick={confirm}
                >
                    {confirmLabel}
                </button>
            </div>
        </div>
    );
};

export default React.memo(ContactPickerModal);
