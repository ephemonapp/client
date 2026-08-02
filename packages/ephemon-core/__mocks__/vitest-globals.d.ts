type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> = import('vitest').Mock<T>;
type Mocked<T> = import('vitest').Mocked<T>;
