import { create } from "zustand";

/**
 * A message the user asked to land on, from a surface outside the chat — today the Command
 * Center's message search. The chat consumes it once and clears it, so a stale request never
 * jumps the same chat twice.
 */
export interface ChatMessageJump {
  serverId: string;
  agentId: string;
  /** Timeline position of the hit, from the host that produced it. */
  epoch: string;
  seq: number;
  /** Monotonic token so the same message asked twice still jumps. */
  requestId: number;
}

interface ChatMessageJumpState {
  jump: ChatMessageJump | null;
  requestJump(input: { serverId: string; agentId: string; epoch: string; seq: number }): void;
  clearJump(requestId: number): void;
}

let nextJumpToken = 0;

export const useChatMessageJumpStore = create<ChatMessageJumpState>((set) => ({
  jump: null,
  requestJump: ({ serverId, agentId, epoch, seq }) =>
    set({ jump: { serverId, agentId, epoch, seq, requestId: ++nextJumpToken } }),
  clearJump: (requestId) =>
    set((state) => (state.jump?.requestId === requestId ? { jump: null } : state)),
}));

export function requestChatMessageJump(input: {
  serverId: string;
  agentId: string;
  epoch: string;
  seq: number;
}): void {
  useChatMessageJumpStore.getState().requestJump(input);
}
