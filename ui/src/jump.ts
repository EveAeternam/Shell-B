// Jump to a message after navigating to its chat (sidebar full-text search). MessageView marks each message with
// data-msg; the chat loads asynchronously, so this waits for the element to appear.
let timer: ReturnType<typeof setInterval> | undefined;

export function jumpToMessage(msgId: string) {
  clearInterval(timer);
  const until = Date.now() + 8000;
  timer = setInterval(() => {
    const el = document.querySelector<HTMLElement>(`[data-msg="${CSS.escape(msgId)}"]`);
    if (!el && Date.now() < until) return;
    clearInterval(timer);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-flash');
    setTimeout(() => el.classList.remove('msg-flash'), 2400);
  }, 150);
}
