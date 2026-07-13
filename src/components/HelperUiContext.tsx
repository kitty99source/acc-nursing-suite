import { createContext, useContext, type ReactNode } from 'react';

export interface HelperUiApi {
  /** Open Help Center on the FAQ tab, focused on this entry when possible. */
  openFaq: (faqId: string) => void;
  /** Open Help Center (guide or faq). */
  openHelp: (tab?: 'guide' | 'faq') => void;
}

const HelperUiContext = createContext<HelperUiApi>({
  openFaq: () => undefined,
  openHelp: () => undefined,
});

export function HelperUiProvider({
  value,
  children,
}: {
  value: HelperUiApi;
  children: ReactNode;
}) {
  return <HelperUiContext.Provider value={value}>{children}</HelperUiContext.Provider>;
}

export function useHelperUi(): HelperUiApi {
  return useContext(HelperUiContext);
}
