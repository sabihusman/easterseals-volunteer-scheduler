import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Integration test for the useUnreadCount hook.
 *
 * The hook previously had two bugs:
 *   1. Stale realtime subscriptions from React StrictMode double-mount
 *      (one per mount, never torn down) — every incoming message
 *      incremented the counter once per stacked subscription.
 *   2. Sticky counter — only ever incremented on INSERT, never
 *      decremented when the user read a conversation.
 *
 * These tests lock both fixes down: exactly one subscription is
 * active at a time, and unmount cleanly removes the channel.
 *
 * We mock the supabase client so we can inspect which channels are
 * created and whether they get removed, without hitting the network.
 */

// Track every channel the hook creates so we can assert on counts.
type MockChannel = {
  name: string;
  listeners: Array<{ event: string; config: unknown; cb: (payload: unknown) => void }>;
  subscribed: boolean;
  removed: boolean;
  on: (event: string, config: unknown, cb: (p: unknown) => void) => MockChannel;
  subscribe: () => MockChannel;
};

const createdChannels: MockChannel[] = [];
let rpcMock = vi.fn().mockResolvedValue({ data: 0, error: null });

function makeChannel(name: string): MockChannel {
  const ch: MockChannel = {
    name,
    listeners: [],
    subscribed: false,
    removed: false,
    on(event, config, cb) {
      this.listeners.push({ event, config, cb });
      return this;
    },
    subscribe() {
      this.subscribed = true;
      return this;
    },
  };
  createdChannels.push(ch);
  return ch;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      channel: (name: string) => makeChannel(name),
      removeChannel: (ch: MockChannel) => {
        ch.removed = true;
      },
      rpc: (...args: unknown[]) => rpcMock(...args),
    },
  };
});

// The hook reads the current user from AuthContext. We stub it to a
// fixed user so the effect runs deterministically.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "test-user-123", email: "test@example.com" },
  }),
}));

// Import AFTER mocks are registered.
import { useUnreadCount } from "@/hooks/useUnreadCount";

beforeEach(() => {
  createdChannels.length = 0;
  rpcMock = vi.fn().mockResolvedValue({ data: 3, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useUnreadCount", () => {
  it("creates exactly one realtime channel on mount", async () => {
    const { unmount } = renderHook(() => useUnreadCount());
    await waitFor(() => {
      expect(createdChannels.length).toBe(1);
    });
    expect(createdChannels[0].name).toBe("unread-count:test-user-123");
    expect(createdChannels[0].subscribed).toBe(true);
    unmount();
  });

  it("subscribes to both messages INSERT and conversation_participants UPDATE", async () => {
    const { unmount } = renderHook(() => useUnreadCount());
    await waitFor(() => {
      expect(createdChannels.length).toBe(1);
    });
    const ch = createdChannels[0];
    // The fix for the "sticky badge" bug added a second listener that
    // fires when the user marks something read. Both must be wired.
    const listenedTables = ch.listeners.map(
      (l) => (l.config as { table: string }).table
    );
    expect(listenedTables).toContain("messages");
    expect(listenedTables).toContain("conversation_participants");
    unmount();
  });

  it("removes the channel on unmount (no leaked subscriptions)", async () => {
    const { unmount } = renderHook(() => useUnreadCount());
    await waitFor(() => {
      expect(createdChannels.length).toBe(1);
    });
    unmount();
    expect(createdChannels[0].removed).toBe(true);
  });

  it("keeps a single active channel across re-renders", async () => {
    const { rerender, unmount } = renderHook(() => useUnreadCount());
    await waitFor(() => {
      expect(createdChannels.length).toBe(1);
    });
    rerender();
    rerender();
    // No new channels should have been created by non-dependency rerenders.
    const active = createdChannels.filter((c) => !c.removed);
    expect(active.length).toBe(1);
    unmount();
  });

  it("tears down old channel and creates new one if the hook remounts", async () => {
    const first = renderHook(() => useUnreadCount());
    await waitFor(() => {
      // Under StrictMode the effect may fire twice, but the defensive
      // teardown inside useUnreadCount guarantees exactly one active
      // channel at any moment.
      const active = createdChannels.filter((c) => !c.removed);
      expect(active.length).toBe(1);
    });
    first.unmount();
    // After unmount nothing should be active.
    const afterFirstUnmount = createdChannels.filter((c) => !c.removed);
    expect(afterFirstUnmount.length).toBe(0);

    const second = renderHook(() => useUnreadCount());
    await waitFor(() => {
      const active = createdChannels.filter((c) => !c.removed);
      expect(active.length).toBe(1);
      expect(active[0].subscribed).toBe(true);
    });
    second.unmount();
    const afterSecondUnmount = createdChannels.filter((c) => !c.removed);
    expect(afterSecondUnmount.length).toBe(0);
  });

  it("exposes the initial count from the RPC", async () => {
    rpcMock = vi.fn().mockResolvedValue({ data: 7, error: null });
    const { result, unmount } = renderHook(() => useUnreadCount());
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(7);
    });
    unmount();
  });
});
