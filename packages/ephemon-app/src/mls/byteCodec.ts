export class Writer {
    private readonly chunks: Array<Uint8Array> = [];
    private byteLength = 0;

    u8(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error('Value does not fit uint8');
        this.push(Uint8Array.from([value]));
    }

    u16(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('Value does not fit uint16');
        const bytes = new Uint8Array(2);
        new DataView(bytes.buffer).setUint16(0, value, false);
        this.push(bytes);
    }

    u32(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Value does not fit uint32');
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, value, false);
        this.push(bytes);
    }

    u64(value: bigint): void {
        if (value < 0n || value > 0xffffffffffffffffn) throw new Error('Value does not fit uint64');
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setBigUint64(0, value, false);
        this.push(bytes);
    }

    fixed(value: Uint8Array, expectedBytes: number, field: string): void {
        if (value.byteLength !== expectedBytes) throw new Error(`${field} must contain exactly ${expectedBytes} bytes`);
        this.push(value);
    }

    variable(value: Uint8Array): void {
        this.u32(value.byteLength);
        this.push(value);
    }

    finish(): Uint8Array {
        const output = new Uint8Array(this.byteLength);
        let offset = 0;
        for (const chunk of this.chunks) {
            output.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return output;
    }

    private push(value: Uint8Array): void {
        this.chunks.push(value);
        this.byteLength += value.byteLength;
    }
}

export class Reader {
    private offset = 0;

    constructor(
        private readonly bytes: Uint8Array,
        private readonly label: string,
    ) {}

    u8(): number {
        return this.take(1)[0];
    }

    u16(): number {
        return new DataView(this.take(2).buffer).getUint16(0, false);
    }

    u32(): number {
        return new DataView(this.take(4).buffer).getUint32(0, false);
    }

    u64(): bigint {
        return new DataView(this.take(8).buffer).getBigUint64(0, false);
    }

    fixed(byteLength: number): Uint8Array {
        return this.take(byteLength);
    }

    variable(): Uint8Array {
        return this.take(this.u32());
    }

    finish(): void {
        if (this.offset !== this.bytes.byteLength) throw new Error(`${this.label} contains trailing bytes`);
    }

    private take(byteLength: number): Uint8Array {
        const end = this.offset + byteLength;
        if (!Number.isSafeInteger(end) || end > this.bytes.byteLength) {
            throw new Error(`${this.label} is truncated`);
        }
        const value = this.bytes.slice(this.offset, end);
        this.offset = end;
        return value;
    }
}
