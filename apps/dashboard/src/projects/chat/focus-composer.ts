/**
 * Puts the cursor in the coordinator's composer, once the pane that holds it is on screen
 * (hence the frame's wait). The composer is found by where it is, because the thing that asks
 * for it (the panel's New thread button) does not hold the chat.
 */
export const focusCoordinatorComposer = (): void => {
  window.requestAnimationFrame(() => {
    document
      .querySelector<HTMLTextAreaElement>(
        '[data-testid="coordinator-chat-pane"] [data-testid="composer-input"]',
      )
      ?.focus();
  });
};
