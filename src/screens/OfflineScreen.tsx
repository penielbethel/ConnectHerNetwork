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
    <View pointerEvents="none" style={styles.overlayContainer}>
      <View style={styles.overlayBanner}>
        <Animated.Image
          source={require('../../public/logo.png')}
          style={[styles.bannerIcon, { transform: [{ rotate: spin }] }]}
          resizeMode="contain"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>No internet connection</Text>
          <Text style={styles.bannerSubtitle}>Some actions may be limited.</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    zIndex: 9999,
  },
  overlayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#1f2937',
    opacity: 0.92,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  bannerIcon: {
    width: 20,
    height: 20,
    marginRight: 8,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  bannerSubtitle: {
    fontSize: 12,
    color: '#e5e7eb',
  },
});

export default OfflineScreen;