import { useServerNetStatus } from '../../../hooks/useServerNetStatus';
import { netStatus } from '../../../lib/status';
import React from 'react';

const BrandNetStatus: React.FC = () => {
    const { label, color } = netStatus(useServerNetStatus());

    return (
        <div className='brand__net'>
            <span
                className='brand__net-dot'
                style={{ background: color }}
            />
            <span className='brand__net-label'>{label}</span>
        </div>
    );
};

export default React.memo(BrandNetStatus);
