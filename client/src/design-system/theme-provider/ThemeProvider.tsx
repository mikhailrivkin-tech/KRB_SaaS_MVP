import React, { createContext, useContext, useEffect, useState } from 'react';
import { ColorTokens, defaultDarkTokens, defaultLightTokens } from '../tokens/colors';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  mode: ThemeMode;
  tokens: ColorTokens;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  updateTokens: (newTokens: Partial<ColorTokens>) => void;
  resetTokens: () => void;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem('krb_theme_mode') as ThemeMode) || 'light';
  });
  const [tokens, setTokens] = useState<ColorTokens>(mode === 'dark' ? defaultDarkTokens : defaultLightTokens);
  const [isLoading, setIsLoading] = useState(false);

  // Apply CSS custom properties to :root element
  const applyTokensToRoot = (currentTokens: ColorTokens) => {
    const root = document.documentElement;
    Object.entries(currentTokens).forEach(([tokenKey, value]) => {
      root.style.setProperty(`--${tokenKey}`, value);
    });
  };

  // Sync theme from API or local storage
  const fetchTheme = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const res = await fetch('/api/theme', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.tokens) {
            setTokens(data.tokens);
            applyTokensToRoot(data.tokens);
            setIsLoading(false);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch custom theme from API, using default preset');
    }
    const currentDefaults = mode === 'dark' ? defaultDarkTokens : defaultLightTokens;
    setTokens(currentDefaults);
    applyTokensToRoot(currentDefaults);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchTheme();
  }, [mode]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem('krb_theme_mode', newMode);
    const newDefaults = newMode === 'dark' ? defaultDarkTokens : defaultLightTokens;
    setTokens(newDefaults);
    applyTokensToRoot(newDefaults);
  };

  const toggleMode = () => {
    setMode(mode === 'light' ? 'dark' : 'light');
  };

  const updateTokens = (newTokens: Partial<ColorTokens>) => {
    const updated = { ...tokens, ...newTokens };
    setTokens(updated);
    applyTokensToRoot(updated);
  };

  const resetTokens = () => {
    const defaultTokens = mode === 'dark' ? defaultDarkTokens : defaultLightTokens;
    setTokens(defaultTokens);
    applyTokensToRoot(defaultTokens);
  };

  return (
    <ThemeContext.Provider value={{ mode, tokens, setMode, toggleMode, updateTokens, resetTokens, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
