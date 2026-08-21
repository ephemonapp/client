const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeSelfChatMessage(message: string): Uint8Array {
    return encoder.encode(message);
}

export function decodeSelfChatMessage(message: Uint8Array): string {
    return decoder.decode(message);
}
