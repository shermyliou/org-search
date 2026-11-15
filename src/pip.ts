declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options: { width: number; height: number }): Promise<Window>;
    };
  }
}

type PipState = { kind: 'home' } | { kind: 'opening' } | { kind: 'floating'; window: Window };

export function attachPictureInPicture({ root, home, trigger, away, returnButton, onError }: {
  root: HTMLElement;
  home: HTMLElement;
  trigger: HTMLButtonElement;
  away: HTMLElement;
  returnButton: HTMLButtonElement;
  onError: (message: string) => void;
}) {
  const api = window.documentPictureInPicture;
  let state: PipState = { kind: 'home' };
  if (!api) {
    trigger.disabled = true;
    trigger.title = '此瀏覽器不支援 Document Picture-in-Picture，請使用桌面版 Chrome 或 Edge。';
    return false;
  }

  const restore = () => {
    home.append(root);
    away.hidden = true;
    trigger.disabled = false;
    trigger.querySelector('span')?.replaceChildren('浮動視窗');
    trigger.setAttribute('aria-label', '浮動視窗');
    trigger.title = '浮動視窗';
    state = { kind: 'home' };
  };

  const close = () => {
    if (state.kind === 'floating') state.window.close();
  };

  trigger.addEventListener('click', async () => {
    if (state.kind === 'floating') {
      close();
      return;
    }
    if (state.kind === 'opening') return;
    state = { kind: 'opening' };
    trigger.disabled = true;
    onError('');
    let opened: Window | undefined;
    try {
      opened = await api.requestWindow({ width: 460, height: 700 });
      const pipDocument = opened.document;
      pipDocument.documentElement.lang = 'zh-Hant';
      pipDocument.documentElement.setAttribute('data-theme', 'light');
      pipDocument.documentElement.setAttribute('data-compact', '');
      pipDocument.title = document.title;
      for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        pipDocument.head.append(style.cloneNode(true));
      }
      opened.addEventListener('pagehide', restore, { once: true });
      state = { kind: 'floating', window: opened };
      pipDocument.body.append(root);
      away.hidden = false;
      trigger.disabled = false;
      trigger.querySelector('span')?.replaceChildren('返回分頁');
      trigger.setAttribute('aria-label', '返回分頁');
      trigger.title = '返回分頁';
    } catch (error) {
      opened?.close();
      restore();
      const message = error instanceof Error ? error.message : String(error);
      onError(`無法開啟浮動視窗。${message}`);
    }
  });
  returnButton.addEventListener('click', close);
  return true;
}
