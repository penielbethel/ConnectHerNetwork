import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { colors, globalStyles } from '../styles/globalStyles';
import { PermissionsManager } from '../utils/permissions';
import { PushNotificationService } from '../services/pushNotifications';

interface SettingsItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  type: 'toggle' | 'navigation' | 'action';
  value?: boolean;
  onPress?: () => void;
  onToggle?: (value: boolean) => void;
}

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [settings, setSettings] = useState({
    notifications: true,
    pushNotifications: true,
    emailNotifications: true,
    soundEnabled: true,
    vibrationEnabled: true,
    darkMode: true,
    autoDownload: false,
    dataUsage: true,
    locationServices: false,
    biometricAuth: false,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedSettings = await AsyncStorage.getItem('userSettings');
      if (savedSettings) {
        setSettings(JSON.parse(savedSettings));
      }
      // Also load current user role to conditionally show admin entries
      try {
        const userData = await AsyncStorage.getItem('currentUser');
        const parsed = userData ? JSON.parse(userData) : null;
        setCurrentUserRole(parsed?.role || null);
      } catch (e) {
        console.error('Error loading current user:', e);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async (newSettings: typeof settings) => {
    try {
      await AsyncStorage.setItem('userSettings', JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert('Error', 'Failed to save settings');
    }
  };

  const handleToggle = (key: keyof typeof settings) => {
    const newSettings = {
      ...settings,
      [key]: !settings[key],
    };
    saveSettings(newSettings);
  };

  const handleNotificationPermissions = async () => {
    setIsLoading(true);
    try {
      const permissionsManager = new PermissionsManager();
      const granted = await permissionsManager.requestNotificationPermission();
      
      if (granted) {
        Alert.alert('Success', 'Notification permissions granted');
        handleToggle('pushNotifications');
      } else {
        Alert.alert('Permission Denied', 'Notification permissions are required for push notifications');
      }
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
      Alert.alert('Error', 'Failed to request notification permissions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocationPermissions = async () => {
    setIsLoading(true);
    try {
      const permissionsManager = new PermissionsManager();
      const granted = await permissionsManager.requestLocationPermission();
      
      if (granted) {
        Alert.alert('Success', 'Location permissions granted');
        handleToggle('locationServices');
      } else {
        Alert.alert('Permission Denied', 'Location permissions are required for location services');
      }
    } catch (error) {
      console.error('Error requesting location permissions:', error);
      Alert.alert('Error', 'Failed to request location permissions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will clear all cached data. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              // Clear specific cache keys, not user data
              await AsyncStorage.multiRemove(['imageCache', 'apiCache', 'tempData']);
              Alert.alert('Success', 'Cache cleared successfully');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear cache');
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.multiRemove(['currentUser', 'authToken', 'userSettings']);
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' as never }],
              });
            } catch (error) {
              Alert.alert('Error', 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This action cannot be undone. All your data will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirm Deletion',
              'Type "DELETE" to confirm account deletion',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Confirm',
                  style: 'destructive',
                  onPress: async () => {
                    // Implement account deletion API call here
                    Alert.alert('Account Deleted', 'Your account has been deleted');
                    navigation.reset({
                      index: 0,
                      routes: [{ name: 'Login' as never }],
                    });
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const settingsItems: SettingsItem[] = [
    // Notifications Section
    {
      id: 'notifications',
      title: 'Push Notifications',
      subtitle: 'Receive push notifications',
      icon: 'notifications',
      type: 'toggle',
      value: settings.pushNotifications,
      onToggle: () => handleNotificationPermissions(),
    },
    {
      id: 'emailNotifications',
      title: 'Email Notifications',
      subtitle: 'Receive email updates',
      icon: 'email',
      type: 'toggle',
      value: settings.emailNotifications,
      onToggle: () => handleToggle('emailNotifications'),
    },
    {
      id: 'soundEnabled',
      title: 'Sound',
      subtitle: 'Play notification sounds',
      icon: 'volume-up',
      type: 'toggle',
      value: settings.soundEnabled,
      onToggle: () => handleToggle('soundEnabled'),
    },
    {
      id: 'vibrationEnabled',
      title: 'Vibration',
      subtitle: 'Vibrate for notifications',
      icon: 'vibration',
      type: 'toggle',
      value: settings.vibrationEnabled,
      onToggle: () => handleToggle('vibrationEnabled'),
    },
    
    // Privacy & Security Section
    {
      id: 'locationServices',
      title: 'Location Services',
      subtitle: 'Allow location access',
      icon: 'location-on',
      type: 'toggle',
      value: settings.locationServices,
      onToggle: () => handleLocationPermissions(),
    },
    {
      id: 'biometricAuth',
      title: 'Biometric Authentication',
      subtitle: 'Use fingerprint or face unlock',
      icon: 'fingerprint',
      type: 'toggle',
      value: settings.biometricAuth,
      onToggle: () => handleToggle('biometricAuth'),
    },
    
    // Data & Storage Section
    {
      id: 'autoDownload',
      title: 'Auto Download Media',
      subtitle: 'Automatically download images and videos',
      icon: 'cloud-download',
      type: 'toggle',
      value: settings.autoDownload,
      onToggle: () => handleToggle('autoDownload'),
    },
    {
      id: 'dataUsage',
      title: 'Data Usage Optimization',
      subtitle: 'Reduce data consumption',
      icon: 'data-usage',
      type: 'toggle',
      value: settings.dataUsage,
      onToggle: () => handleToggle('dataUsage'),
    },
    
    // Account Management Section
    {
      id: 'profile',
      title: 'Edit Profile',
      subtitle: 'Update your profile information',
      icon: 'person',
      type: 'navigation',
      onPress: () => navigation.navigate('Profile' as never),
    },
    {
      id: 'superAdminPanel',
      title: 'Super Admin Panel',
      subtitle: 'Manage users and analytics',
      icon: 'admin-panel-settings',
      type: 'navigation',
      onPress: () => navigation.navigate('SuperAdminPanel' as never),
    },
    {
      id: 'adminPanel',
      title: 'Admin Panel',
      subtitle: 'Manage sponsors and posts',
      icon: 'stars',
      type: 'navigation',
      onPress: () => navigation.navigate('AdminPanel' as never),
    },
    {
      id: 'privacy',
      title: 'Privacy Settings',
      subtitle: 'Manage your privacy preferences',
      icon: 'security',
      type: 'navigation',
      onPress: () => {
        // Navigate to privacy settings
        Alert.alert('Privacy Settings', 'Privacy settings screen coming soon');
      },
    },
    {
      id: 'blocked',
      title: 'Blocked Users',
      subtitle: 'Manage blocked users',
      icon: 'block',
      type: 'navigation',
      onPress: () => {
        // Navigate to blocked users
        Alert.alert('Blocked Users', 'Blocked users screen coming soon');
      },
    },
    
    // Support Section
    {
      id: 'help',
      title: 'Help & Support',
      subtitle: 'Get help and contact support',
      icon: 'help',
      type: 'navigation',
      onPress: () => {
        Alert.alert('Help & Support', 'Support screen coming soon');
      },
    },
    {
      id: 'about',
      title: 'About ConnectHer',
      subtitle: 'App version and information',
      icon: 'info',
      type: 'navigation',
      onPress: () => {
        Alert.alert('About ConnectHer', 'Version 1.0.0\nBuilt with React Native');
      },
    },
    
    // Actions Section
    {
      id: 'clearCache',
      title: 'Clear Cache',
      subtitle: 'Free up storage space',
      icon: 'clear',
      type: 'action',
      onPress: handleClearCache,
    },
    {
      id: 'logout',
      title: 'Logout',
      subtitle: 'Sign out of your account',
      icon: 'logout',
      type: 'action',
      onPress: handleLogout,
    },
    {
      id: 'deleteAccount',
      title: 'Delete Account',
      subtitle: 'Permanently delete your account',
      icon: 'delete-forever',
      type: 'action',
      onPress: handleDeleteAccount,
    },
  ];

  const renderSettingsItem = (item: SettingsItem) => {
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.settingsItem}
        onPress={item.onPress}
        disabled={item.type === 'toggle'}
      >
        <View style={styles.itemLeft}>
          <View style={styles.iconContainer}>
            <Icon 
              name={item.icon} 
              size={24} 
              color={item.id === 'deleteAccount' ? colors.error : colors.dark.primary} 
            />
          </View>
          <View style={styles.itemText}>
            <Text style={[
              styles.itemTitle,
              item.id === 'deleteAccount' && { color: colors.error }
            ]}>
              {item.title}
            </Text>
            {item.subtitle && (
              <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
            )}
          </View>
        </View>
        
        <View style={styles.itemRight}>
          {item.type === 'toggle' && (
            <Switch
              value={item.value}
              onValueChange={item.onToggle}
              trackColor={{ 
                false: colors.dark.text + '40', 
                true: colors.dark.primary + '80' 
              }}
              thumbColor={item.value ? colors.dark.primary : colors.dark.text + '80'}
            />
          )}
          {item.type === 'navigation' && (
            <Icon name="chevron-right" size={24} color={colors.dark.text + '80'} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const getSectionTitle = (index: number) => {
    if (index === 0) return 'Notifications';
    if (index === 4) return 'Privacy & Security';
    if (index === 6) return 'Data & Storage';
    if (index === 8) return 'Account Management';
    if (index === 11) return 'Support';
    if (index === 13) return 'Actions';
    return null;
  };

  return (
    <View style={globalStyles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color={colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.dark.primary} />
          </View>
        )}
        
        {settingsItems
          .filter((item) => {
            if (item.id === 'superAdminPanel') return currentUserRole === 'superadmin';
            if (item.id === 'adminPanel') return currentUserRole === 'admin' || currentUserRole === 'superadmin';
            return true;
          })
          .map((item, index) => {
          const sectionTitle = getSectionTitle(index);
          return (
            <View key={item.id}>
              {sectionTitle && (
                <Text style={styles.sectionTitle}>{sectionTitle}</Text>
              )}
              {renderSettingsItem(item)}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.card,
  },
  backButton: {
    padding: 8,
  },
  title: {
    ...globalStyles.title,
    fontSize: 20,
    marginBottom: 0,
  },
  placeholder: {
    width: 40,
  },
  scrollContainer: {
    padding: 16,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.dark.bg + '80',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  sectionTitle: {
    ...globalStyles.text,
    fontSize: 18,
    fontWeight: '600',
    color: colors.dark.primary,
    marginTop: 24,
    marginBottom: 12,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: colors.dark.card,
    borderRadius: 12,
    marginBottom: 8,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.dark.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemText: {
    flex: 1,
  },
  itemTitle: {
    ...globalStyles.text,
    fontSize: 16,
    fontWeight: '600',
  },
  itemSubtitle: {
    ...globalStyles.text,
    fontSize: 14,
    color: colors.dark.text + '80',
    marginTop: 2,
  },
  itemRight: {
    marginLeft: 12,
  },
});

export default SettingsScreen;