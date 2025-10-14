import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

type Props = {
  active?: boolean;
  barCount?: number;
  width?: number;
  height?: number;
  color?: string;
};

const RecordingWaveform: React.FC<Props> = ({
  active = false,
  barCount = 24,
  width = 160,
  height = 32,
  color = '#ff1493',
}) => {
  const valuesRef = useRef<Animated.Value[]>(
    Array.from({ length: barCount }, () => new Animated.Value(0.2))
  );
  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    // Initialize animations once
    if (animationsRef.current.length === 0) {
      animationsRef.current = valuesRef.current.map((val, idx) => {
        const up = Animated.timing(val, {
          toValue: 1,
          duration: 180 + (idx % 5) * 30,
          useNativeDriver: false,
        });
        const down = Animated.timing(val, {
          toValue: 0.2,
          duration: 160 + (idx % 5) * 30,
          useNativeDriver: false,
        });
        return Animated.loop(Animated.sequence([up, down]));
      });
    }
    // Start or stop based on active
    if (active) {
      animationsRef.current.forEach(a => a.start());
    } else {
      animationsRef.current.forEach(a => a.stop());
      valuesRef.current.forEach(v => v.setValue(0.2));
    }
    return () => {
      animationsRef.current.forEach(a => a.stop());
    };
  }, [active]);

  const barWidth = Math.max(2, Math.floor(width / (barCount * 1.5)));
  const gap = Math.max(2, Math.floor(barWidth / 2));

  return (
    <View style={[styles.container, { width, height }]}>
      {valuesRef.current.map((val, idx) => (
        <Animated.View
          key={idx}
          style={[
            styles.bar,
            {
              width: barWidth,
              marginLeft: idx === 0 ? 0 : gap,
              backgroundColor: color,
              height: val.interpolate({ inputRange: [0, 1], outputRange: [height * 0.2, height] }),
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bar: {
    borderRadius: 2,
  },
});

export default RecordingWaveform;