import React from 'react';
import { View, TouchableOpacity, StyleSheet, useColorScheme } from 'react-native';
import { StackHeaderProps } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { colors } from '../styles/globalStyles';

type NavItem = {
  key: string;
  label: string;
  icon: string;
  route: 'Dashboard' | 'Chat' | 'Community' | 'Notification' | 'Sponsors';
};

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home', route: 'Dashboard' },
  { key: 'chat', label: 'Chat', icon: 'chat', route: 'Chat' },
  { key: 'community', label: 'Community', icon: 'groups', route: 'Community' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications', route: 'Notification' },
  { key: 'sponsors', label: 'Sponsors', icon: 'stars', route: 'Sponsors' },
];

type TopNavProps = Partial<StackHeaderProps> & {
  activeRouteName?: 'Dashboard' | 'Chat' | 'Community' | 'Notification' | 'Sponsors' | string;
  onNavigate?: (route: NavItem['route']) => void;
};

const TopNav: React.FC<TopNavProps> = ({ activeRouteName, onNavigate, navigation, route }) => {
  const isDark = useColorScheme() === 'dark';

  const bg = isDark ? colors.dark.card : colors.light.card;
  const text = isDark ? colors.dark.text : colors.light.text;
  const primary = isDark ? colors.dark.primary : colors.light.primary;
  const circleBg = isDark ? '#131313' : '#ffffff';

  const currentRouteName = activeRouteName || (route?.name as string | undefined);

  return (
    <View style={[styles.container, { backgroundColor: bg, borderBottomColor: text + '20' }]}>
      {NAV_ITEMS.map((item) => {
        const active = currentRouteName ? currentRouteName === item.route : false;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.itemCircle, { backgroundColor: circleBg, borderColor: active ? primary : text + '20' }]}
            onPress={() => {
              if (onNavigate) {
                onNavigate(item.route);
                return;
              }
              if (navigation && typeof navigation.navigate === 'function') {
                // Only navigate if route exists in navigator to avoid runtime errors
                const names = (navigation as any).getState?.()?.routeNames || [];
                if (Array.isArray(names) && names.includes(item.route)) {
                  navigation.navigate(item.route as never);
                } else {
                  console.warn(`[TopNav] Route not found in navigator: ${item.route}`);
                }
              }
            }}
          >
            <Icon name={item.icon} size={22} color={active ? primary : text + 'AA'} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});

export default TopNav;