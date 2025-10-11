import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { colors, globalStyles } from '../styles/globalStyles';

const SponsorsScreen: React.FC = () => {
  const isDark = useColorScheme() === 'dark';
  return (
    <View style={globalStyles.container}>
      <View style={styles.header}> 
        <Text style={styles.headerTitle}>Sponsors</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.placeholder}>Sponsored content coming soon.</Text>
        <Text style={styles.subtext}>We’ll showcase partner posts and promotions here.</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    backgroundColor: colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  content: {
    ...globalStyles.padding,
  },
  placeholder: {
    color: colors.text,
    fontSize: 16,
    marginBottom: 6,
  },
  subtext: {
    color: colors.textMuted,
    fontSize: 14,
  },
});

export default SponsorsScreen;