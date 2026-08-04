declare const conversationIdBrand: unique symbol;
declare const memberNumberBrand: unique symbol;

/** A local, stable identifier for a conversation and its persisted state. */
export type ConversationId = number & { readonly [conversationIdBrand]: 'ConversationId' };

/** A stable, group-scoped MLS member number assigned when a member joins. */
export type MemberNumber = number & { readonly [memberNumberBrand]: 'MemberNumber' };

export function toConversationId(value: number): ConversationId {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('ConversationId must be a non-negative safe integer');
    }
    return value as ConversationId;
}

export function toMemberNumber(value: number): MemberNumber {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError('MemberNumber must be an unsigned 32-bit integer');
    }
    return value as MemberNumber;
}
