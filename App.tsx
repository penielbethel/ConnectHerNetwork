import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar, View, ActivityIndicator, useColorScheme, LogBox, AppState, Modal, TouchableOpacity, Text } from 'react-native';

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
const NewUserVerificationScreen = requireSafe(() => require('./src/screens/NewUserVerificationScreen'), 'NewUserVerificationScreen');
const TermsAttestationScreen = requireSafe(() => require('./src/screens/TermsAttestationScreen'), 'TermsAttestationScreen');
const SponsorsScreen = requireSafe(() => require('./src/screens/SponsorsScreen'), 'SponsorsScreen');
const SponsorDetailScreen = requireSafe(() => require('./src/screens/SponsorDetailScreen'), 'SponsorDetailScreen');
const SuperAdminPanelScreen = requireSafe(() => require('./src/screens/SuperAdminPanelScreen'), 'SuperAdminPanelScreen');
const AdminPanelScreen = requireSafe(() => require('./src/screens/AdminPanelScreen'), 'AdminPanelScreen');
const CallScreen = requireSafe(() => require('./src/screens/CallScreen'), 'CallScreen');
const IncomingCallScreen = requireSafe(() => require('./src/screens/IncomingCallScreen'), 'IncomingCallScreen');
const StartNewChatScreen = requireSafe(() => require('./src/screens/StartNewChatScreen'), 'StartNewChatScreen');
const HelpDeskScreen = requireSafe(() => require('./src/screens/HelpDeskScreen'), 'HelpDeskScreen');
const SettingsScreen = requireSafe(() => require('./src/screens/SettingsScreen'), 'SettingsScreen');

// Services
import SocketService from './src/services/SocketService';
import PushNotificationService from './src/services/pushNotifications';
import BiometricService from './src/services/BiometricService';

// Types
import { RootStackParamList } from './src/types/navigation';

// Styles
import { globalStyles } from './src/styles/globalStyles';
import { ThemeContext, persistTheme, applyThemeColors } from './src/context/ThemeContext';
// Navigation helpers
import { navigationRef, navigate } from './src/navigation/RootNavigation';

// Use palette from globalStyles colors (mutated via ThemeContext)
import { colors } from './src/styles/globalStyles';

const Stack = createStackNavigator<RootStackParamList>();

const App: React.FC = () => {
  const colorScheme = useColorScheme();
  const [appTheme, setAppTheme] = useState<'light' | 'dark'>(colorScheme === 'dark' ? 'dark' : 'light');
  const isDarkMode = appTheme === 'dark';
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [verificationCompleted, setVerificationCompleted] = useState<boolean>(false);
  const [biometricEnabled, setBiometricEnabled] = useState<boolean>(false);
  const [locked, setLocked] = useState<boolean>(false);

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

        // Load Terms & Conditions attestation state
        try {
          const att = await AsyncStorage.getItem('termsAccepted_v1');
          setTermsAccepted(att === 'true');
        } catch (_) {}

        // Load New User Verification completion state
        try {
          const v = await AsyncStorage.getItem('verificationCompleted_v1');
          setVerificationCompleted(v === 'true');
        } catch (_) {}

        // Theme: load persisted selection, default to system scheme
        try {
          const t = await AsyncStorage.getItem('appTheme');
          const mode = t === 'light' || t === 'dark' ? t : (colorScheme === 'dark' ? 'dark' : 'light');
          setAppTheme(mode);
          applyThemeColors(mode);
        } catch (_) {
          const mode = colorScheme === 'dark' ? 'dark' : 'light';
          setAppTheme(mode);
          applyThemeColors(mode);
        }
      } catch (error) {
        console.error('Initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // Gate access: first require New User Verification, then Terms acceptance
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!verificationCompleted) {
      try {
        navigate('NewUserVerification');
      } catch (e) {
        console.error('[NavFAIL] NewUserVerification navigate', e);
      }
      return;
    }
    if (!termsAccepted) {
      try {
        navigate('TermsAttestation');
      } catch (e) {
        console.error('[NavFAIL] TermsAttestation navigate', e);
      }
    }
  }, [isAuthenticated, verificationCompleted, termsAccepted]);

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

  // Ensure IncomingCall UI also appears when private-offer arrives
  useEffect(() => {
    if (!isAuthenticated) return;
    const offerHandler = (payload: { from: string; type?: 'audio' | 'video' }) => {
      try {
        navigate('IncomingCall', { caller: payload.from, type: (payload.type || 'audio') as 'audio' | 'video' });
      } catch (e) {
        console.error('[NavFAIL] IncomingCall via private-offer navigate', e);
      }
    };
    try {
      SocketService.on('private-offer', offerHandler as any);
    } catch (e) {
      console.error('[SocketFAIL] private-offer listener', e);
    }
    return () => {
      try {
        SocketService.off('private-offer', offerHandler as any);
      } catch (e) {}
    };
  }, [isAuthenticated]);

  // Listen for incoming group calls and navigate to community incoming call screen
  useEffect(() => {
    if (!isAuthenticated) return;
    const groupHandler = (payload: { from: string; communityId: string; communityName: string; type?: 'audio' | 'video' }) => {
      try {
        // Show local push notification as well
        PushNotificationService.getInstance().showLocalNotification({
          title: 'Group Call',
          body: `${payload.from} is calling in ${payload.communityName}`,
          data: { type: 'group_call', ...payload },
          channelId: 'connecther_calls',
          priority: 'high',
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
    <ThemeContext.Provider
      value={{
        theme: appTheme,
        setTheme: (mode) => {
          setAppTheme(mode);
          persistTheme(mode);
          applyThemeColors(mode);
        },
      }}
    >
      <NavigationContainer theme={navTheme} ref={navigationRef}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <Stack.Navigator
        initialRouteName={
          isAuthenticated
            ? (!verificationCompleted
                ? 'NewUserVerification'
                : (!termsAccepted ? 'TermsAttestation' : 'Dashboard'))
            : 'Login'
        }
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
        <Stack.Screen name="CommunityChat" component={CommunityChatScreen} options={{ headerShown: false }} />
        <Stack.Screen name="CommunityCall" component={CommunityCallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="CommunityIncomingCall" component={CommunityIncomingCallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Conversation" component={ConversationScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Call" component={CallScreen} />
        <Stack.Screen name="IncomingCall" component={IncomingCallScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Verification" component={VerificationScreen} options={{ headerShown: false }} />
        <Stack.Screen name="NewUserVerification" component={NewUserVerificationScreen} options={{ headerShown: false }} />
        <Stack.Screen name="TermsAttestation" component={TermsAttestationScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Sponsors" component={SponsorsScreen} />
        <Stack.Screen name="SponsorDetail" component={SponsorDetailScreen} />
        <Stack.Screen name="SuperAdminPanel" component={SuperAdminPanelScreen} />
        <Stack.Screen name="AdminPanel" component={AdminPanelScreen} />
        <Stack.Screen name="StartNewChat" component={StartNewChatScreen} />
        <Stack.Screen name="HelpDesk" component={HelpDeskScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
      {__DEV__ ? <DevLogOverlay /> : null}
      {/* Biometric lock overlay */}
      <Modal visible={locked} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 16, width: '90%' }}>
            <Text style={{ ...globalStyles.text, fontSize: 18, fontWeight: '700', marginBottom: 10 }}>Unlock Required</Text>
            <Text style={{ ...globalStyles.text, marginBottom: 16 }}>Authenticate with your fingerprint to continue.</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <TouchableOpacity
                style={globalStyles.secondaryButton}
                onPress={async () => {
                  try {
                    await AsyncStorage.multiRemove(['authToken', 'currentUser']);
                  } catch (_) {}
                  setLocked(false);
                  setIsAuthenticated(false);
                }}
              >
                <Text style={globalStyles.secondaryButtonText}>Logout</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={globalStyles.button}
                onPress={async () => {
                  const ok = await BiometricService.getInstance().promptUnlock('Unlock ConnectHer');
                  setLocked(!ok);
                }}
              >
                <Text style={globalStyles.buttonText}>Unlock</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </NavigationContainer>
    </ThemeContext.Provider>
  );
};

export default App;
        // Load user settings to determine biometric gate
        try {
          const settingsJson = await AsyncStorage.getItem('userSettings');
          const uiSettings = settingsJson ? JSON.parse(settingsJson) : {};
          const biometricOn = !!uiSettings?.biometricAuth;
          setBiometricEnabled(biometricOn);
          if (biometricOn && token && userData) {
            const ok = await BiometricService.getInstance().promptUnlock('Unlock ConnectHer');
            setLocked(!ok);
          }
        } catch (_) {}
  // Prompt for biometric unlock on app resume if enabled
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      try {
        if (state === 'active' && isAuthenticated && biometricEnabled) {
          const ok = await BiometricService.getInstance().promptUnlock('Unlock ConnectHer');
          setLocked(!ok);
        }
      } catch (e) {
        // swallow
      }
    });
    return () => {
      try { sub.remove(); } catch (_) {}
    };
  }, [isAuthenticated, biometricEnabled]);