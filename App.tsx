import React, { useEffect, useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar, View, ActivityIndicator, useColorScheme, LogBox, AppState, Modal, TouchableOpacity, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import CommunityUnreadService from './src/services/CommunityUnreadService';
import ChatUnreadService from './src/services/ChatUnreadService';

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
const OfflineScreen = requireSafe(() => require('./src/screens/OfflineScreen'), 'OfflineScreen');

// Services
import SocketService from './src/services/SocketService';
import PushNotificationService from './src/services/pushNotifications';
import BiometricService from './src/services/BiometricService';
import apiService from './src/services/ApiService';

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

const ProfileHeader: React.FC<any> = ({ navigation, back, options }) => {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {back ? (
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back" style={{ padding: 8 }}>
          <Icon name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: 40 }} />
      )}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.text }}>
          {options?.title || 'Profile'}
        </Text>
      </View>
      <View style={{ width: 40 }} />
    </View>
  );
};

const AppDuplicate: React.FC = () => {
  const colorScheme = useColorScheme();
  const [appTheme, setAppTheme] = useState<'light' | 'dark'>(colorScheme === 'dark' ? 'dark' : 'light');
  const isDarkMode = appTheme === 'dark';
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [verificationCompleted, setVerificationCompleted] = useState<boolean>(false);
  const [biometricEnabled, setBiometricEnabled] = useState<boolean>(false);
  const [locked, setLocked] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [devLogsEnabled, setDevLogsEnabled] = useState<boolean>(false);
  const [showOfflineOverlay, setShowOfflineOverlay] = useState<boolean>(false);
  const offlineTimerRef = useRef<any>(null);
  const [communityUnreadTotal, setCommunityUnreadTotal] = useState<number>(0);
  const [chatUnreadTotal, setChatUnreadTotal] = useState<number>(0);
  const [notificationUnreadTotal, setNotificationUnreadTotal] = useState<number>(0);
  const selfUsernameRef = useRef<string>('');
  const processedCommunityMsgIdsRef = useRef<Set<string>>(new Set());
  const processedPrivateMsgIdsRef = useRef<Set<string>>(new Set());

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

        try {
          const me = userData ? JSON.parse(userData) : null;
          selfUsernameRef.current = me?.username ? String(me.username) : '';
        } catch (_) {}

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
        // Skip if this caller is temporarily suppressed (e.g., call just ended)
        const { isSuppressed } = require('./src/utils/callGuard');
        if (typeof isSuppressed === 'function' && isSuppressed(payload.from)) {
          return;
        }
        // Avoid showing IncomingCall if already in a call or already viewing IncomingCall
        const currentRoute = navigationRef?.getCurrentRoute?.()?.name;
        if (currentRoute === 'Call' || currentRoute === 'IncomingCall') {
          return;
        }
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

  // Dedup: avoid navigating to IncomingCall on 'private-offer' to prevent duplication.
  // Incoming call UI is driven by 'incomingCall' socket event and push notifications.
  // The private-offer is handled inside CallScreen for callee flow.


  // Listen for incoming group calls and navigate to community incoming call screen
  useEffect(() => {
    if (!isAuthenticated) return;
    const groupHandler = (payload: { from: string; communityId: string; communityName: string; type?: 'audio' | 'video' }) => {
      try {
        // Show a local notification so users get an alert + ringtone
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

  // Unread service: init and subscribe to total
  useEffect(() => {
    let unsub: () => void = () => {};
    (async () => {
      try {
        await CommunityUnreadService.init();
      } catch (_) {}
      try {
        unsub = CommunityUnreadService.subscribe((_counts, total) => {
          setCommunityUnreadTotal(total);
        });
      } catch (_) {}
    })();
    return () => {
      try { unsub(); } catch (_) {}
    };
  }, []);

  // Global community-message listener to increment unread
  useEffect(() => {
    if (!isAuthenticated) return;
    const handler = (msg: any) => {
      try {
        const communityId = String(msg?.communityId || msg?.community || '');
        if (!communityId) return;
        const senderUsername = typeof msg?.sender === 'string' ? msg?.sender : (msg?.sender?.username || msg?.from || '');
        const me = selfUsernameRef.current;
        const isFromMe = !!(me && senderUsername && String(senderUsername) === String(me));

        // Dedup incoming events across multiple emit/listener paths
        const rawId = String(
          msg?._id ??
          `${communityId}|${senderUsername || ''}|${msg?.createdAt || msg?.time || ''}|${msg?.text || ''}`
        );
        if (rawId) {
          if (processedCommunityMsgIdsRef.current.has(rawId)) {
            return;
          }
          processedCommunityMsgIdsRef.current.add(rawId);
          setTimeout(() => {
            try { processedCommunityMsgIdsRef.current.delete(rawId); } catch (_) {}
          }, 5000);
        }

        if (!isFromMe) {
          CommunityUnreadService.increment(communityId);
        }
      } catch (_) {}
    };
    try { SocketService.on('community-message', handler); } catch (e) {
      console.error('[SocketFAIL] community-message listener', e);
    }
    return () => {
      try { SocketService.off('community-message', handler); } catch (_) {}
    };
  }, [isAuthenticated]);

  // Global newMessage listener to increment private chat unread
  useEffect(() => {
    if (!isAuthenticated) return;
    const handler = (msg: any) => {
      try {
        const sender = String(msg?.sender || '');
        const recipient = String(msg?.recipient || msg?.to || '');
        if (!sender || !recipient) return;
        const me = selfUsernameRef.current;
        const isFromMe = !!(me && sender && String(sender) === String(me));

        const chatId = [sender, recipient].sort().join('_');
        const rawId = String(msg?._id ?? `${chatId}|${sender}|${msg?.createdAt || msg?.timestamp || ''}|${msg?.text || ''}`);
        if (rawId) {
          if (processedPrivateMsgIdsRef.current.has(rawId)) return;
          processedPrivateMsgIdsRef.current.add(rawId);
          setTimeout(() => { try { processedPrivateMsgIdsRef.current.delete(rawId); } catch (_) {} }, 5000);
        }
        if (!isFromMe) {
          ChatUnreadService.increment(chatId);
          const text = String(msg?.text || '').trim();
          const hasMedia = Array.isArray(msg?.media) && msg.media.length > 0;
          const hasAudio = !!msg?.audio && String(msg.audio).trim().length > 0;
          const content = text ? text : hasMedia ? '📷 Media' : hasAudio ? '🎙️ Voice Note' : 'Message';
          try {
            PushNotificationService.getInstance().showLocalNotification({
              title: `New message from ${sender}`,
              body: content,
              channelId: 'connecther_messages',
              priority: 'high',
              vibrate: true,
              sound: 'notify.mp3',
              data: {
                type: 'message',
                chatId: String(chatId),
                roomId: String(chatId),
                senderUsername: String(sender),
                senderName: String((msg?.senderName || sender)),
                senderAvatar: String(msg?.senderAvatar || ''),
              } as any,
            });
          } catch (_) {}
        }
      } catch (_) {}
    };
    try { SocketService.on('newMessage', handler); } catch (e) {
      console.error('[SocketFAIL] newMessage listener', e);
    }
    return () => { try { SocketService.off('newMessage', handler); } catch (_) {} };
  }, [isAuthenticated]);

  // Cache current user's username for unread filter
  useEffect(() => {
    (async () => {
      try {
        const userData = await AsyncStorage.getItem('currentUser');
        const me = userData ? JSON.parse(userData) : null;
        selfUsernameRef.current = me?.username ? String(me.username) : '';
      } catch (_) {}
    })();
  }, []);

  // Compute and refresh unread notification total (likes/comments, sponsors, friend requests)
  useEffect(() => {
    if (!isAuthenticated) return;

    const recompute = async () => {
      try {
        const userStr = await AsyncStorage.getItem('currentUser');
        const current = userStr ? JSON.parse(userStr) : null;
        const username = current?.username;
        let total = 0;
        // Activity (likes/comments) for user
        if (username) {
          try {
            const activity = await apiService.getNotifications(username);
            const unreadActivity = (activity?.notifications || []).filter((n: any) => !n?.isRead && !n?.read).length;
            total += unreadActivity;
          } catch (_) {}

          // Friend requests (pending are counted)
          try {
            const fr = await apiService.getFriendRequests(username);
            const pendingFR = Array.isArray(fr) ? fr.length : 0;
            total += pendingFR;
          } catch (_) {}
        }

        // Sponsors (global alerts)
        try {
          const sponsor = await apiService.getNotifications();
          const unreadSponsors = (sponsor?.notifications || []).filter((n: any) => !n?.isRead && !n?.read).length;
          total += unreadSponsors;
        } catch (_) {}

        setNotificationUnreadTotal(total);
      } catch (_) {}
    };

    // Initial compute on auth
    recompute();

    // Update on push notification socket events
    const handler = (_data: any) => {
      recompute();
    };
    try {
      SocketService.on('new-notification', handler);
      SocketService.on('notification', handler); // fallback if server uses a generic event
    } catch (_) {}
    // Also recalc when app returns to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') recompute();
    });

    return () => {
      try { SocketService.off('new-notification', handler); } catch (_) {}
      try { SocketService.off('notification', handler); } catch (_) {}
      try { sub.remove(); } catch (_) {}
    };
  }, [isAuthenticated]);

  // Unread service: init and subscribe to total
  useEffect(() => {
    let unsub: () => void = () => {};
    (async () => {
      try {
        await ChatUnreadService.init();
      } catch (_) {}
      try {
        unsub = ChatUnreadService.subscribe((_counts, total) => { setChatUnreadTotal(total); }); } catch (_) {}
    })();
    return () => { try { unsub(); } catch (_) {} };
  }, []);

  // Global community-message listener to increment unread
  useEffect(() => {
    if (!isAuthenticated) return;
    const handler = (msg: any) => {
      try {
        const communityId = String(msg?.communityId || msg?.community || '');
        if (!communityId) return;
        const senderUsername = typeof msg?.sender === 'string' ? msg?.sender : (msg?.sender?.username || msg?.from || '');
        const me = selfUsernameRef.current;
        const isFromMe = !!(me && senderUsername && String(senderUsername) === String(me));

        // Dedup incoming events across multiple emit/listener paths
        const rawId = String(
          msg?._id ??
          `${communityId}|${senderUsername || ''}|${msg?.createdAt || msg?.time || ''}|${msg?.text || ''}`
        );
        if (rawId) {
          if (processedCommunityMsgIdsRef.current.has(rawId)) {
            return;
          }
          processedCommunityMsgIdsRef.current.add(rawId);
          setTimeout(() => {
            try { processedCommunityMsgIdsRef.current.delete(rawId); } catch (_) {}
          }, 5000);
        }

        if (!isFromMe) {
          CommunityUnreadService.increment(communityId);
        }
      } catch (_) {}
    };
    try { SocketService.on('community-message', handler); } catch (e) {
      console.error('[SocketFAIL] community-message listener', e);
    }
    return () => {
      try { SocketService.off('community-message', handler); } catch (_) {}
    };
  }, [isAuthenticated]);

  // Load per-user biometric setting and prompt if authenticated
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let key = 'userSettings';
        const userStr = await AsyncStorage.getItem('currentUser');
        const user = userStr ? JSON.parse(userStr) : null;
        if (user?.username) key = `userSettings:${user.username}`;
        const settingsJson = await AsyncStorage.getItem(key);
        const uiSettings = settingsJson ? JSON.parse(settingsJson) : {};
        const biometricOn = !!uiSettings?.biometricAuth;
        const debugLogsOn = !!uiSettings?.debugLogs;
        if (!cancelled) setBiometricEnabled(biometricOn);
        if (!cancelled) setDevLogsEnabled(debugLogsOn);
        if (biometricOn && isAuthenticated) {
          const ok = await BiometricService.getInstance().promptUnlock('Unlock ConnectHer');
          if (!cancelled) setLocked(!ok);
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Prompt for biometric unlock on app resume if enabled (fresh per-user read)
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      try {
        if (state === 'active' && isAuthenticated) {
          let key = 'userSettings';
          const userStr = await AsyncStorage.getItem('currentUser');
          const user = userStr ? JSON.parse(userStr) : null;
          if (user?.username) key = `userSettings:${user.username}`;
          const settingsJson = await AsyncStorage.getItem(key);
          const uiSettings = settingsJson ? JSON.parse(settingsJson) : {};
          const biometricOn = !!uiSettings?.biometricAuth;
          const debugLogsOn = !!uiSettings?.debugLogs;
          setBiometricEnabled(biometricOn);
          setDevLogsEnabled(debugLogsOn);
          if (biometricOn) {
            const ok = await BiometricService.getInstance().promptUnlock('Unlock ConnectHer');
            setLocked(!ok);
          }
        }
      } catch (_) {}
    });
    return () => {
      try { sub.remove(); } catch (_) {}
    };
  }, [isAuthenticated]);

  // Connectivity: simple polling check to determine online/offline
  useEffect(() => {
    let mounted = true;
    let timer: any = null;

    const timeoutFetch = async (url: string, ms: number): Promise<boolean> => {
      try {
        const res = await Promise.race([
          fetch(url, { method: 'GET' }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
        ]);
        if (!res || typeof (res as any).status !== 'number') return false;
        const status = (res as any).status as number;
        return status === 204 || (status >= 200 && status < 400);
      } catch (_) {
        return false;
      }
    };

    const checkConnectivity = async () => {
      const okGstatic = await timeoutFetch('https://connectivitycheck.gstatic.com/generate_204', 3500);
      const okAlt = okGstatic ? true : await timeoutFetch('https://www.google.com', 3500);
      if (mounted) setIsConnected(!!(okGstatic || okAlt));
    };

    // initial check
    checkConnectivity();
    // periodic checks
    timer = setInterval(checkConnectivity, 5000);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkConnectivity();
    });

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
      try { sub.remove(); } catch (_) {}
    };
  }, []);

  // Debounce offline overlay to avoid flicker
  useEffect(() => {
    if (!isConnected) {
      if (!offlineTimerRef.current) {
        offlineTimerRef.current = setTimeout(() => {
          setShowOfflineOverlay(true);
        }, 2000);
      }
    } else {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      setShowOfflineOverlay(false);
    }
    return () => {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
    };
  }, [isConnected]);

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

  // Deep linking configuration: supports custom scheme and HTTPS links
  const linking = {
    prefixes: ['connecther://', 'https://connecther.network', 'http://connecther.network'],
    config: {
      screens: {
        PostDetail: 'post.html',
      },
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
      <NavigationContainer theme={navTheme} ref={navigationRef} linking={linking}>
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
          header: (props) => (
            <TopNav
              {...props}
              communityUnreadCount={communityUnreadTotal}
              chatUnreadCount={chatUnreadTotal}
              notificationUnreadCount={notificationUnreadTotal}
            />
          ),
          headerStyle: {
            backgroundColor: isDarkMode ? colors.card : '#ffffff',
          },
          headerTintColor: isDarkMode ? '#ffffff' : '#000000',
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Community" component={CommunityScreen} />
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={({ route }) => ({
            header: (props) => <ProfileHeader {...props} />,
            title: route.params?.username ? String(route.params?.username) : 'Profile',
          })}
        />
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
      {(__DEV__ || devLogsEnabled) ? <DevLogOverlay enabled={__DEV__ || devLogsEnabled} /> : null}
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
      {/* Offline overlay */}
      {showOfflineOverlay && <OfflineScreen />}
      </NavigationContainer>
    </ThemeContext.Provider>
  );
}

export default AppDuplicate;