import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface HelpModeContextValue {
  helpMode: boolean;
  setHelpMode: (value: boolean) => void;
  toggleHelpMode: () => void;
}

const HelpModeContext = createContext<HelpModeContextValue | undefined>(undefined);

const STORAGE_KEY = 'admin_help_mode';

export function HelpModeProvider({ children }: { children: ReactNode }) {
  const [helpMode, setHelpModeState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(helpMode));
  }, [helpMode]);

  const setHelpMode = (value: boolean) => {
    setHelpModeState(value);
  };

  const toggleHelpMode = () => {
    setHelpModeState((prev) => !prev);
  };

  return (
    <HelpModeContext.Provider value={{ helpMode, setHelpMode, toggleHelpMode }}>
      {children}
    </HelpModeContext.Provider>
  );
}

export function useHelpMode() {
  const context = useContext(HelpModeContext);
  if (context === undefined) {
    throw new Error('useHelpMode must be used within a HelpModeProvider');
  }
  return context;
}
