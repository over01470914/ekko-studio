// Resolve each invocation against durable room, Agent, and message records. Neither
// prompt text nor caller-supplied ownership claims can grant host access.
interface HostAccessStorage {
    getRoom(roomId: string): { ownerAuthUserId?: number } | null
    getRoomAgentByAgentId(roomId: string, agentId: string): {
        id: string; agentId: string; executorType?: string; ownerMemberId?: string; connectorId?: string; remoteOrigin?: string; hostAccessEnabled?: number
    } | null
    getMessage(messageId: string): {
        roomId: string; senderId: string; senderAgentRecordId?: string; senderType?: string; role?: string
    } | null
}

// Blank ownership is the legacy server-local row shape, not a caller claim.
export function isRoomOwnerLocalAgent(
    agent: { executorType?: string; ownerMemberId?: string; connectorId?: string; remoteOrigin?: string } | null,
    owner: string,
): boolean {
    return !!agent && agent.executorType === 'server'
        && !agent.connectorId && !agent.remoteOrigin
        && (agent.ownerMemberId === owner || !agent.ownerMemberId)
}

export function canGrantGroupAgentHostAccess(
    storage: HostAccessStorage,
    roomId: string,
    targetAgentId: string,
    senderId: string,
    messageId: string,
): boolean {
    if (!roomId || !targetAgentId || !senderId || !messageId || senderId === targetAgentId) return false
    const room = storage.getRoom(roomId)
    const ownerId = room?.ownerAuthUserId
    if (typeof ownerId !== 'number' || !Number.isSafeInteger(ownerId) || ownerId <= 0) return false
    const owner = `auth:${ownerId}`
    const target = storage.getRoomAgentByAgentId(roomId, targetAgentId)
    const sender = storage.getRoomAgentByAgentId(roomId, senderId)
    const message = storage.getMessage(messageId)
    return target?.hostAccessEnabled === 1
        && isRoomOwnerLocalAgent(target, owner)
        && isRoomOwnerLocalAgent(sender, owner)
        && sender?.agentId === senderId
        && target.agentId === targetAgentId
        && message?.roomId === roomId
        && message.senderType === 'agent'
        && message.role === 'assistant'
        && message.senderId === sender?.agentId
        && message.senderAgentRecordId === sender?.id
}
