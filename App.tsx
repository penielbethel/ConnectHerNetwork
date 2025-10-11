import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar, View, ActivityIndicator, useColorScheme, LogBox } from 'react-native';

// Components
import TopNav from './src/components/TopNav';
import DevLogOverlay from './src/components/DevLogOverlay';

// Screens
// Lazily require screens to avoid import-time crashes preventing AppRegistry registration
// Use literal require calls to satisfy Metro's static analysis
const requireSafe = (loader: () => any, name: string) => {
  try {
    const mod = loader();
    return mod?.default ?? mod;
  } catch (e) {
    console.error(`[ScreenImportError] ${name} failed to import:`, e);
    return function ImportErrorFallback() {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <StatusBar barStyle={'light-content'} />
          <ActivityIndicator size="large" color="#ff3b30" />
        </View>
      );
    };
  }
};

const LoginScreen = requireSafe(() => require('./src/screens/LoginScreen'), 'LoginScreen');
const DashboardScreen = requireSafe(() => require('./src/screens/DashboardScreen'), 'DashboardScreen');
const CommunityScreen = requireSafe(() => require('./src/screens/CommunityScreen'), 'CommunityScreen');
const ProfileScreen = requireSafe(() => require('./src/screens/ProfileScreen'), 'ProfileScreen');
const ChatScreen = requireSafe(() => require('./src/screens/ChatScreen'), 'ChatScreen');
const NotificationScreen = requireSafe(() => require('./src/screens/NotificationScreen'), 'NotificationScreen');
const SearchScreen = requireSafe(() => require('./src/screens/SearchScreen'), 'SearchScreen');
const PostDetailScreen = requireSafe(() => require('./src/screens/PostDetailScreen'), 'PostDetailScreen');
const CreateCommunityScreen = requireSafe(() => require('./src/screens/CreateCommunityScreen'), 'CreateCommunityScreen');
const ConversationScreen = requireSafe(() => require('./src/screens/ConversationScreen'), 'ConversationScreen');
const CommunityChatScreen = requireSafe(() => require('./src/screens/CommunityChatScreen'), 'CommunityChatScreen');
const CommunityCallScreen = requireSafe(() => require('./src/screens/CommunityCallScreen'), 'CommunityCallScreen');
const CommunityIncomingCallScreen = requireSafe(() => require('./src/screens/CommunityIncomingCallScreen'), 'CommunityIncomingCallScreen');
const VerificationScreen = requireSafe(() => require('./src/screens/VerificationScreen'), 'VerificationScreen');
const SponsorsScreen = requireSafe(() => require('./src/screens/SponsorsScreen'), 'SponsorsScreen');
const SponsorDetailScreen = requireSafe(() => require('./src/screens/SponsorDetailScreen'), 'SponsorDetailScreen');
const SuperAdminPanelScreen = requireSafe(() => require('./src/screens/SuperAdminPanelScreen'), 'SuperAdminPanelScreen');
const AdminPanelScreen = requireSafe(() => require('./src/screens/AdminPanelScreen'), 'AdminPanelScreen');
const CallScreen = requireSafe(() => require('./src/screens/CallScreen'), 'CallScreen');
const IncomingCallScreen = requireSafe(() => require('./src/screens/IncomingCallScreen'), 'IncomingCallScreen');

// Services
import SocketService from './src/services/SocketService';
import PushNotificationService from './src/services/pushNotifications';

// Types
import { RootStackParamList } from './src/types/navigation';

// Styles
import { globalStyles } from './src/styles/globalStyles';
// Navigation helpers
import { navigationRef, navigate } from './src/navigation/RootNavigation';

// Theme colors
const colors = {
  primary: '#6c63ff',
  background: '#121212',
  card: '#1f1f1f',
  text: '#ffffff',
  border: '#272727',
  notification: '#ffb703',
};

const Stack = createStackNavigator<RootStackParamList>();

const App: React.FC = () => {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    LogBox.ignoreLogs([
      'VirtualizedLists should never be nested inside plain ScrollViews',
      'Require cycle:',
      'Warning:...',
      'new NativeEventEmitter()',
    ]);

    if (typeof global !== 'undefined') {
      if (!global.__CONNECTHER_GLOBAL_ERROR_HANDLER_SET__) {
        global.__CONNECTHER_GLOBAL_ERROR_HANDLER_SET__ = true;
        const originalConsoleError = console.error;
        console.error = function (...args) {
          originalConsoleError.apply(console, args);
        };

        const originalConsoleLog = console.log;
        console.log = function (...args) {
          originalConsoleLog.apply(console, args);
        };

        const originalError = Error;
        try {
          void originalError;
        } catch (e) {
          // swallow
        }
      }
    }

    const initializeApp = async () => {
      try {
        try {
          await PushNotificationService.getInstance().initialize();
          console.log('[InitOK] PushNotificationService.initialize');
        } catch (e) {
          console.error('[InitFAIL] PushNotificationService.initialize', e);
        }

        // ApiService has no initializeFirebase/initialize in this project.
        // Firebase messaging is handled by PushNotificationService; API base is configured on demand.

        let token: string | null = null;
        let userData: string | null = null;
        try {
          token = await AsyncStorage.getItem('authToken');
          userData = await AsyncStorage.getItem('currentUser');
          console.log('[InitOK] AsyncStorage auth fetched');
        } catch (e) {
          console.error('[InitFAIL] AsyncStorage.getItem', e);
        }

        if (token && userData) {
          try {
            setIsAuthenticated(true);
            SocketService.initialize();
            console.log('[InitOK] SocketService.initialize');
          } catch (e) {
            console.error('[InitFAIL] SocketService.initialize', e);
          }
        }
      } catch (error) {
        console.error('Initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // Listen for incoming call socket events and navigate to IncomingCall
  useEffect(() => {
    if (!isAuthenticated) return;
    const handler = (payload: { from: string; to: string; type: 'audio' | 'video' }) => {
      try {
        navigate('IncomingCall', { caller: payload.from, type: payload.type });
      } catch (e) {
        console.error('[NavFAIL] IncomingCall navigate', e);
      }
    };
    try {
      SocketService.on('incomingCall', handler);
    } catch (e) {
      console.error('[SocketFAIL] incomingCall listener', e);
    }
    return () => {
      try {
        SocketService.off('incomingCall', handler);
      } catch (e) {
        // swallow
      }
    };
  }, [isAuthenticated]);

  // Listen for incoming group calls and navigate to community incoming call screen
  useEffect(() => {
    if (!isAuthenticated) return;
    const groupHandler = (payload: { from: string; communityId: string; communityName: string; type?: 'audio' | 'video' }) => {
      try {
        // Show local push notification as well
        PushNotificationService.getInstance().displayNotification({
          title: 'Group Call',
          message: `${payload.from} is calling in ${payload.communityName}`,
        });
      } catch (_) {}
      try {
        navigate('CommunityIncomingCall', {
          communityId: payload.communityId,
          communityName: payload.communityName,
          caller: { username: payload.from },
          type: payload.type || 'audio',
        });
      } catch (e) {
        console.error('[NavFAIL] CommunityIncomingCall navigate', e);
      }
    };
    try {
      SocketService.onIncomingGroupCall(groupHandler as any);
    } catch (e) {
      console.error('[SocketFAIL] incoming-group-call listener', e);
    }
    return () => {
      try {
        SocketService.off('incoming-group-call', groupHandler as any);
      } catch (e) {}
    };
  }, [isAuthenticated]);

  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      ...colors,
      background: isDarkMode ? '#121212' : '#f2f2f2',
      card: isDarkMode ? '#1f1f1f' : '#ffffff',
      text: isDarkMode ? '#ffffff' : '#000000',
    },
  };

  if (isLoading) {
    return (
      <View style={globalStyles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <Stack.Navigator
        initialRouteName={isAuthenticated ? 'Dashboard' : 'Login'}
        screenOptions={{
          header: (props) => <TopNav {...props} />,
          headerStyle: {
            backgroundColor: isDarkMode ? colors.card : '#ffffff',
          },
          headerTintColor: isDarkMode ? '#ffffff' : '#000000',
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Community" component={CommunityScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="Notification" component={NotificationScreen} />
        <Stack.Screen name="Search" component={SearchScreen} />
        <Stack.Screen name="PostDetail" component={PostDetailScreen} />
        <Stack.Screen name="CreateCommunity" component={CreateCommunityScreen} />
        <Stack.Screen name="CommunityChat" component={CommunityChatScreen} />
        <Stack.Screen name="CommunityCall" component={CommunityCallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="CommunityIncomingCall" component={CommunityIncomingCallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Conversation" component={ConversationScreen} />
        <Stack.Screen name="Call" component={CallScreen} />
        <Stack.Screen name="IncomingCall" component={IncomingCallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Verification" component={VerificationScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Sponsors" component={SponsorsScreen} />
        <Stack.Screen name="SponsorDetail" component={SponsorDetailScreen} />
        <Stack.Screen name="SuperAdminPanel" component={SuperAdminPanelScreen} />
        <Stack.Screen name="AdminPanel" component={AdminPanelScreen} />
      </Stack.Navigator>
      {__DEV__ ? <DevLogOverlay /> : null}
    </NavigationContainer>
  );
};

export default App;