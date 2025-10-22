import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { colors, globalStyles } from '../styles/globalStyles';

const OfflineScreen = () => {
  // Rotate animation setup
  const spinValue = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  useEffect(() => {
    // Start continuous rotation while offline screen is visible
    loopRef.current = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loopRef.current.start();

    return () => {
      try { loopRef.current?.stop(); } catch (_) {}
      spinValue.stopAnimation(() => {
        try { spinValue.setValue(0); } catch (_) {}
      });
    };
  }, [spinValue]);

  return (
    <View style={[globalStyles.container, styles.container]}> 
      <View style={styles.card}>
        <Animated.Image
          source={require('../../public/logo.png')}
          style={[styles.logo, { transform: [{ rotate: spin }] }]}
          resizeMode="contain"
        />
        <Text style={styles.title}>You are offline</Text>
        <Text style={styles.subtitle}>Please turn on your Internet connection.</Text>
        <Text style={styles.hint}>Tip: Check Wi‑Fi or Mobile Data and try again.</Text>
        <TouchableOpacity activeOpacity={0.8} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 14,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default OfflineScreen;