import { useCallback, useState } from 'react';

export type FlashTone = 'good' | 'danger' | 'warn';

export interface FlashMessage {
  text: string;
  tone: FlashTone;
}

export function useFlash(autoClearMs = 4000) {
  const [flash, setFlash] = useState<FlashMessage | null>(null);

  const showFlash = useCallback(
    (text: string, tone: FlashTone = 'good') => {
      setFlash({ text, tone });
      if (tone === 'good' && autoClearMs > 0) {
        window.setTimeout(() => setFlash(null), autoClearMs);
      }
    },
    [autoClearMs],
  );

  const clearFlash = useCallback(() => setFlash(null), []);

  return { flash, showFlash, clearFlash };
}
