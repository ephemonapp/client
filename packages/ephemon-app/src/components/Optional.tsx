import React, { Suspense } from 'react';

type LazyComponent<P> = React.LazyExoticComponent<React.ComponentType<P>>;

export type OptionalModule<P> = {
    current: LazyComponent<P>;
    reload: () => void;
};

export function optionalModule<P>(load: () => Promise<{ default: React.ComponentType<P> }>): OptionalModule<P> {
    const module: OptionalModule<P> = {
        current: React.lazy(load),
        reload: () => {
            module.current = React.lazy(load);
        },
    };
    return module;
}

type OptionalProps<P> = {
    module: OptionalModule<P>;
    fallback: React.ReactNode;
    failure?: React.ReactNode;
    children: (Component: LazyComponent<P>) => React.ReactNode;
};

type OptionalState = {
    failed: boolean;
};

class Optional<P> extends React.Component<OptionalProps<P>, OptionalState> {
    state: OptionalState = { failed: false };

    static getDerivedStateFromError(): OptionalState {
        return { failed: true };
    }

    componentDidCatch(): void {
        this.props.module.reload();
    }

    render(): React.ReactNode {
        if (this.state.failed) return this.props.failure ?? this.props.fallback;
        return <Suspense fallback={this.props.fallback}>{this.props.children(this.props.module.current)}</Suspense>;
    }
}

export default Optional;
