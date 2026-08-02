import React from 'react';

const LockFormSkeleton: React.FC = () => (
    <div className='lock__form'>
        <div className='lock-skel__actions'>
            <div className='lock-skel__action skeleton' />
            <div className='lock-skel__action skeleton' />
        </div>
        <div className='lock__card'>
            <div className='lock-skel__title skeleton' />
            <div className='lock-skel__sub skeleton' />
            <div className='lock-skel__sub lock-skel__sub--short skeleton' />
            <div className='lock-skel__label skeleton' />
            <div className='lock-skel__field skeleton' />
            <div className='lock-skel__submit skeleton' />
            <div className='lock-skel__reassure skeleton' />
            <div className='lock-skel__links'>
                <div className='lock-skel__link skeleton' />
                <div className='lock-skel__link skeleton' />
                <div className='lock-skel__link skeleton' />
            </div>
            <div className='lock-skel__reset skeleton' />
        </div>
    </div>
);

export default React.memo(LockFormSkeleton);
