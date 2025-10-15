import { StyleSheet, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Theme colors based on the CSS theme
export const colors = {
  dark: {
    bg: '#0e0e0e',
    text: '#ffcce6',
    card: '#1a1a1a',
    inputBg: '#222',
    iconColor: '#ffb6c1',
    primary: '#ff69b4',
    secondary: '#ffb6c1',
    accent: '#ff1493',
    success: '#2ecc71',
    warning: '#f1c40f',
    danger: '#e74c3c',
  },
  light: {
    bg: '#ffffff',
    text: '#222222',
    card: '#ffffff',
    inputBg: '#ffffff',
    iconColor: '#222222',
    primary: '#ff69b4',
    secondary: '#ffb6c1',
    accent: '#ff1493',
    success: '#2ecc71',
    warning: '#f1c40f',
    danger: '#e74c3c',
  },
  // Flattened top-level keys used across screens
  bg: '#0e0e0e',
  text: '#ffcce6',
  card: '#1a1a1a',
  inputBg: '#222',
  iconColor: '#ffb6c1',
  primary: '#ff69b4',
  secondary: '#ffb6c1',
  accent: '#ff1493',
  surface: '#1a1a1a',
  border: '#ff69b420',
  textMuted: '#ffcce6AA',
  background: '#0e0e0e',
  success: '#2ecc71',
  warning: '#f1c40f',
  danger: '#e74c3c',
};

export const globalStyles = StyleSheet.create({
  // Container styles
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 16,
  },
  
  // Card styles
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    shadowColor: colors.border,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  // Text styles
  text: {
    fontSize: 16,
    color: colors.text,
    fontFamily: 'System',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  caption: {
    fontSize: 14,
    color: colors.text,
    opacity: 0.7,
  },
  textMuted: {
    fontSize: 14,
    color: colors.textMuted,
  },
  
  // Input styles
  input: {
    backgroundColor: colors.inputBg,
    color: colors.text,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.card,
    marginVertical: 8,
  },
  textarea: {
    backgroundColor: colors.inputBg,
    color: colors.text,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.card,
    marginVertical: 8,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  
  // Button styles
  button: {
    backgroundColor: colors.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 8,
  },
  buttonSecondary: {
    backgroundColor: colors.secondary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 8,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonTextOutline: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  
  // Layout styles
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spaceBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Common flex utilities used across screens
  flexRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flexRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flexRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Profile styles
  profileContainer: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginVertical: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  
  // Icon styles
  icon: {
    color: colors.iconColor,
  },
  
  // Responsive styles
  fullWidth: {
    width: '100%',
  },
  halfWidth: {
    width: '48%',
  },
  
  // Spacing utilities
  marginTop: {
    marginTop: 16,
  },
  marginBottom: {
    marginBottom: 16,
  },
  marginVertical: {
    marginVertical: 8,
  },
  marginHorizontal: {
    marginHorizontal: 8,
  },
  padding: {
    padding: 16,
  },
  paddingVertical: {
    paddingVertical: 8,
  },
  paddingHorizontal: {
    paddingHorizontal: 16,
  },
});

export const dimensions = {
  width,
  height,
  isSmallDevice: width < 375,
  isTablet: width > 768,
};