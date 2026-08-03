// ============================================================================
// Pure "sticky scroll" helper for AiChatPanel's message list (2026-08-04
// owner-reported bug: the panel forced the scroll position back to the
// bottom on every streamed chunk, making it impossible to scroll up and read
// earlier messages while a reply was still streaming in). Extracted as a
// standalone pure function — rather than inlined DOM logic in the component —
// specifically so it's unit-testable without simulating real DOM scroll
// geometry (jsdom doesn't lay out scrollHeight/clientHeight realistically).
// ============================================================================

/**
 * Standard chat-UI "sticky scroll" check: true when the container is already
 * at (or within `threshold` px of) the bottom, meaning new content arriving
 * should auto-scroll to reveal it. False once the user has manually scrolled
 * up to read something earlier — in that case new content must NOT yank the
 * view back down; the caller should leave the scroll position alone until
 * this returns true again (i.e. the user scrolls back down themselves).
 */
export function shouldAutoScroll(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 80,
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom < threshold;
}
