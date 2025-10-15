import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../styles/globalStyles';

export type ThemeMode = 'light' | 'dark';

export interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
}

export const ThemeContext = React.createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
});

export const persistTheme = async (mode: ThemeMode) => {
  try {
    await AsyncStorage.setItem('appTheme', mode);
  } catch (_) {}
};

export const applyThemeColors = (mode: ThemeMode) => {
  const src = mode === 'dark' ? colors.dark : colors.light;
  // Mutate flattened top-level palette used by inline styles
  colors.bg = src.bg;
  colors.text = src.text;
  colors.card = src.card;
  colors.inputBg = src.inputBg;
  colors.iconColor = src.iconColor;
  colors.primary = src.primary;
  colors.secondary = src.secondary;
  colors.accent = src.accent;
  colors.surface = src.card;
  colors.border = mode === 'dark' ? '#ff69b420' : '#00000020';
  colors.textMuted = mode === 'dark' ? '#ffcce6AA' : '#33333399';
  colors.background = src.bg;
};