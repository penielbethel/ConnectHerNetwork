import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { firebase } from '@react-native-firebase/app';
import { Platform, Alert, PermissionsAndroid, InteractionManager, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PushNotification from 'react-native-push-notification';
import Sound from 'react-native-sound';
import socketService from './SocketService';
import { navigate } from '../navigation/RootNavigation';
import NotificationPlugin from '../plugins/notification';

export interface NotificationData {
  title: string;
  body: string;
  data?: { [key: string]: string };
  channelId?: string;
  priority?: 'high' | 'normal' | 'low';
  sound?: string;
  vibrate?: boolean;
}

export class PushNotificationService {
  private static instance: PushNotificationService;
  private isInitialized = false;
  private firebaseAvailable = false;
  private foregroundUnsubscribe: (() => void) | null = null;
  private ringingTimers: Record<string, ReturnType<typeof setInterval>> = {};
  private ringingSounds: Record<string, Sound> = {};
  private recentNotificationIds: Set<string> = new Set();
  private activeGroupCalls: Set<string> = new Set();

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Configure local notifications (works regardless of Firebase state)
      this.configurePushNotifications();

      // Try to register device for remote messages to confirm Firebase Messaging availability
      try {
        await messaging().registerDeviceForRemoteMessages();
        this.firebaseAvailable = true;
        console.log('Firebase Messaging: device registered for remote messages');
      } catch (e) {
        this.firebaseAvailable = false;
        console.log('Firebase Messaging not available; proceeding with local notifications only');
      }

      // Request notification permissions (handles Android 13+ and FCM permissions)
      await this.requestPermission();

      // Initialize Firebase Messaging if available, defer until after initial UI work
      if (this.firebaseAvailable) {
        InteractionManager.runAfterInteractions(async () => {
          try {
            await this.setupFirebaseMessaging();
            console.log('Firebase messaging initialized successfully');
          } catch (firebaseError) {
            console.log('Firebase messaging init failed; using local notifications only');
            this.firebaseAvailable = false;
          }
        });
      }

      this.isInitialized = true;
      console.log('Push notification service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize push notification service:', error);
      this.isInitialized = true;
    }
  }

  private async requestPermission(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        // For Android 13+ (API 33+), request notification permission
        if (Platform.Version >= 33) {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            {
              title: 'Notification Permission',
              message: 'ConnectHer needs permission to send you notifications.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            }
          );
          
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            console.warn('Notification permission denied');
            return false;
          }
        }
      }

      // Request FCM permission when available
      if (this.firebaseAvailable) {
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
          console.warn('Firebase messaging permission denied');
          return false;
        }
        console.log('Notification permissions granted (FCM)');
        return true;
      }

      // If FCM not available, still proceed with local notifications
      console.log('Notification permissions granted (local notifications only)');
      return true;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  private configurePushNotifications(): void {
    PushNotification.configure({
      onRegister: (token) => {
        console.log('Push notification token:', token);
        this.saveFCMToken(token.token);
      },

      onNotification: (notification) => {
        console.log('Notification received:', notification);
        
        // Handle notification tap
        if (notification.userInteraction) {
          try {
            const payload = (notification as any)?.data || (notification as any)?.userInfo || {};
            this.handleNotificationTap(payload);
          } catch (e) {
            console.log('onNotification tap handler error:', e);
          }
        }
      },

      onAction: async (notification) => {
        console.log('Notification action:', notification);
        // Accept/Decline actions for call alerts
        try {
          const action = (notification as any).action;
          const data = (notification as any)?.data || (notification as any)?.userInfo || {};
          const caller = data?.caller || data?.from || data?.username;
          const dtype = String(data?.type || '').toLowerCase();
          const type = (data?.callType === 'video' || data?.type === 'video') ? 'video' : 'audio';

          if (dtype === 'group_call') {
            const communityId = data?.communityId;
            const communityName = data?.communityName;
            if (action === 'Accept' && communityId) {
              try {
                const stored = await AsyncStorage.getItem('currentUser');
                const me = stored ? JSON.parse(stored) : null;
                const username = me?.username;
                const name = me?.name || username;
                const avatar = me?.avatar;
                if (username) {
                  socketService.joinGroupCall({
                    username,
                    communityId,
                    communityName,
                    name,
                    avatar,
                  });
                }
              } catch (_) {}
              // Stop ringing when user accepts
              this.stopRinging(String(communityId));
              this.activeGroupCalls.add(String(communityId));
              this.stopAllRinging();
              navigate('CommunityCall', {
                communityId,
                communityName,
                mode: 'callee',
                type,
                caller: { username: caller },
              });
            } else if (action === 'Decline' && communityId) {
              try {
                const stored = await AsyncStorage.getItem('currentUser');
                const me = stored ? JSON.parse(stored) : null;
                const username = me?.username;
                if (username) {
                  socketService.declineGroupCall({ communityId, username });
                }
              } catch (_) {}
              // Stop ringing when user declines
              this.stopRinging(String(communityId));
              this.stopAllRinging();
            }
          } else {
            if (action === 'Accept' && caller) {
              socketService.acceptCall({ from: data?.receiver || data?.to, to: caller });
              navigate('Call', { to: caller, type, mode: 'callee' });
            } else if (action === 'Decline' && caller) {
              socketService.rejectCall({ from: data?.receiver || data?.to, to: caller });
            }
          }
        } catch (e) {
          console.log('onAction handler error:', e);
        }
      },

      onRegistrationError: (err) => {
        console.error('Push notification registration error:', err);
      },

      permissions: {
        alert: true,
        badge: true,
        sound: true,
      },

      popInitialNotification: true,
      requestPermissions: Platform.OS === 'ios',
    });

    // Create notification channels for Android
    if (Platform.OS === 'android') {
      this.createNotificationChannels();
    }
  }

  private createNotificationChannels(): void {
    const channels = [
      {
        channelId: 'connecther_notifications',
        channelName: 'ConnectHer Notifications',
        channelDescription: 'General notifications from ConnectHer',
        playSound: true,
        soundName: 'default',
        importance: 5, // MAX importance to enable heads-up notifications
        vibrate: true,
      },
      {
        channelId: 'connecther_messages',
        channelName: 'Messages',
        channelDescription: 'New message notifications',
        playSound: true,
        soundName: 'notify.mp3',
        importance: 5, // MAX importance for message notifications
        vibrate: true,
      },
      {
        channelId: 'connecther_events',
        channelName: 'Events',
        channelDescription: 'Event notifications and reminders',
        playSound: true,
        soundName: 'default',
        importance: 4,
        vibrate: true,
      },
      {
        channelId: 'connecther_calls',
        channelName: 'Calls',
        channelDescription: 'Incoming call alerts',
        playSound: true,
        soundName: 'connectring.mp3',
        importance: 5,
        vibrate: true,
      },
      {
        channelId: 'sponsors_alerts',
        channelName: 'Sponsors Alerts',
        channelDescription: 'Notifications about sponsor posts and opportunities',
        playSound: true,
        soundName: 'default',
        importance: 5, // Ensure heads-up visibility
        vibrate: true,
      },
    ];

    channels.forEach(channel => {
      PushNotification.createChannel(channel, (created) => {
        console.log(`Channel ${channel.channelId} created:`, created);
      });
    });
  }

  // Convenience: allow screens to create additional channels on demand
  createChannel(channel: {
    channelId: string;
    channelName: string;
    channelDescription?: string;
    playSound?: boolean;
    soundName?: string;
    importance?: number;
    vibrate?: boolean;
  }): void {
    try {
      PushNotification.createChannel(channel as any, (created) => {
        console.log(`Channel ${channel.channelId} created:`, created);
      });
    } catch (e) {
      console.log('createChannel failed:', e);
    }
  }

  private async setupFirebaseMessaging(): Promise<void> {
    try {
      // Check if Firebase messaging is available
      if (!messaging) {
        throw new Error('Firebase messaging not available');
      }

      // Ensure device registration (safe to call even if already registered)
      try {
        await messaging().registerDeviceForRemoteMessages();
      } catch (_) {}

      // Get FCM token
      const fcmToken = await messaging().getToken();
      if (fcmToken) {
        console.log('FCM Token:', fcmToken);
        await this.saveFCMToken(fcmToken);
        try { await this.subscribeToTopic('new_posts'); } catch (_) {}
        try { await this.subscribeToTopic('sponsor_posts'); } catch (_) {}
      }

      // Listen for token refresh
      messaging().onTokenRefresh(async (token) => {
        console.log('FCM Token refreshed:', token);
        await this.saveFCMToken(token);
        try { await this.subscribeToTopic('new_posts'); } catch (_) {}
        try { await this.subscribeToTopic('sponsor_posts'); } catch (_) {}
      });

      // Handle foreground messages
      this.foregroundUnsubscribe = messaging().onMessage(async (remoteMessage) => {
        console.log('Foreground message received:', remoteMessage);
        this.displayLocalNotification(remoteMessage);
      });

      // Handle background messages
      messaging().setBackgroundMessageHandler(async (remoteMessage) => {
        console.log('Background message received:', remoteMessage);
        // Always show a local notification for background messages
        this.displayLocalNotification(remoteMessage);
        return Promise.resolve();
      });

      // Handle notification opened from background/quit state
      messaging().onNotificationOpenedApp((remoteMessage) => {
        console.log('Notification opened app:', remoteMessage);
        try {
          this.handleNotificationTap(remoteMessage?.data || {});
        } catch (e) {
          console.log('onNotificationOpenedApp handler error:', e);
        }
      });

      // Check if app was opened from a notification
      const initialNotification = await messaging().getInitialNotification();
      if (initialNotification) {
        console.log('App opened from notification:', initialNotification);
        try {
          this.handleNotificationTap(initialNotification?.data || {});
        } catch (e) {
          console.log('getInitialNotification handler error:', e);
        }
      }
    } catch (error) {
      console.error('Error setting up Firebase messaging:', error);
      throw error; // Re-throw to be caught by the initialize method
    }
  }

  // Allow consumers to register custom foreground message handlers
  onMessage(handler: (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => void): void {
    try {
      if (!this.firebaseAvailable) {
        console.log('onMessage ignored: Firebase messaging not available');
        return;
      }
      // Chain alongside internal display handler
      messaging().onMessage(async (remoteMessage) => {
        try {
          handler(remoteMessage);
        } catch (e) {
          console.log('onMessage handler error:', e);
        }
      });
    } catch (e) {
      console.log('onMessage registration failed:', e);
    }
  }

  // Ensure background handling is enabled; safe to call multiple times
  enableBackgroundHandling(): void {
    try {
      if (!this.firebaseAvailable) {
        console.log('enableBackgroundHandling: attempting to enable despite unknown Firebase state');
      }
      // No-op here since setBackgroundMessageHandler is configured in setupFirebaseMessaging
      console.log('Background message handling enabled');
    } catch (e) {
      console.log('enableBackgroundHandling failed:', e);
    }
  }

  private async saveFCMToken(token: string): Promise<void> {
    try {
      await AsyncStorage.setItem('fcm_token', token);
      console.log('FCM token saved locally');

      // Also send the token to backend so server can send notifications
      try {
        const userDataRaw = await AsyncStorage.getItem('currentUser');
        const userData = userDataRaw ? JSON.parse(userDataRaw) : null;
        const username = userData?.username;

        if (username) {
          const response = await fetch('https://connecther.network/api/notifications/save-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, token }),
          });

          if (!response.ok) {
            const payload = await response.text();
            console.warn('Failed to save FCM token to backend:', payload);
          } else {
            console.log('FCM token saved to backend for user:', username);
          }
        } else {
          console.warn('No username found; skipping backend FCM token save');
        }
      } catch (err) {
        console.error('Error sending FCM token to backend:', err);
      }
    } catch (error) {
      console.error('Error saving FCM token:', error);
    }
  }

  async getFCMToken(): Promise<string | null> {
    try {
      const token = await AsyncStorage.getItem('fcm_token');
      return token;
    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  private isDuplicateAndMark(key?: string): boolean {
    try {
      if (!key) return false;
      if (this.recentNotificationIds.has(key)) return true;
      this.recentNotificationIds.add(key);
      setTimeout(() => {
        try { this.recentNotificationIds.delete(key); } catch (_) {}
      }, 10000);
      return false;
    } catch (_) {
      return false;
    }
  }

  private computeNotificationIdForGroupCall(communityId: string): number {
    try {
      const s = String(communityId || '');
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash);
    } catch (_) {
      return Math.floor(Math.random() * 100000);
    }
  }

  private displayLocalNotification(remoteMessage: FirebaseMessagingTypes.RemoteMessage): void {
    const { notification, data } = remoteMessage;
    const dtype = String((data as any)?.type || '').toLowerCase();
    const notifTitle = notification?.title || (data as any)?.title || 'ConnectHer';
    const isCall = !!(data?.caller || dtype === 'call' || dtype === 'group_call' || String(notifTitle || '').toLowerCase().includes('call'));

    // Deduplicate notifications (special handling for group calls)
    let dedupKey: string | undefined = remoteMessage.messageId || (data as any)?.msgId || (data as any)?.id;
    let groupCommunityId: string | undefined;
    if (dtype === 'group_call') {
      groupCommunityId = String((data as any)?.communityId || '');
      // Use only communityId for dedup to unify FCM/socket
      dedupKey = `group_call|${groupCommunityId}`;
    } else if (!dedupKey) {
      dedupKey = `${dtype}|${(data as any)?.communityId || ''}|${(data as any)?.from || (data as any)?.sender || ''}|${notification?.body || (data as any)?.body || ''}|${(data as any)?.createdAt || (data as any)?.time || ''}`;
    }
    // For group calls, do not skip duplicates here; replacement handled via stable id
    if (dtype !== 'group_call' && this.isDuplicateAndMark(dedupKey)) {
      return;
    }

    const reactorName = (data as any)?.reactorName || (data as any)?.senderName || (data as any)?.fromName || (data as any)?.from || '';
    const communityName = (data as any)?.communityName || '';

    const computedMessage = (() => {
      if (dtype === 'reaction') {
        return `${reactorName || 'Someone'} reacted to your message.`;
      }
      if (dtype === 'community_reaction') {
        return `${reactorName || 'Someone'} reacted to your message on "${communityName || 'a community'}".`;
      }
      if (dtype === 'community_message') {
        const body = notification?.body || (data as any)?.body;
        return body || `New message in "${communityName || 'a community'}"`;
      }
      if (dtype === 'incoming_call') {
        const callType = String((data as any)?.callType || 'audio');
        const fromName = String((data as any)?.caller || reactorName || 'Someone');
        return `Incoming ${callType} call from ${fromName}.`;
      }
      return notification?.body || (data as any)?.body || 'You have a new notification';
    })();

    const computedTitle = (() => {
      if (dtype === 'reaction') return reactorName || 'New reaction';
      if (dtype === 'community_reaction') return reactorName || 'New reaction';
      if (dtype === 'community_message') {
        if (notifTitle && notifTitle !== 'ConnectHer') return notifTitle;
        const sender = reactorName;
        return `${sender || 'New message'} on "${communityName || 'a community'}"`;
      }
      if (dtype === 'incoming_call') return 'Incoming Call';
      return notifTitle;
    })();

    const soundName = isCall ? 'connectring.mp3' : ((dtype === 'community_message' || dtype === 'message') ? 'notify.mp3' : 'default');
    const channelId = isCall
      ? 'connecther_calls'
      : (dtype === 'friend' || dtype === 'friend_request')
        ? 'connecther_notifications'
        : 'connecther_messages';

    // Wake the screen for visibility even when device is idle
    try { NotificationPlugin.wakeUpScreen(); } catch (_) {}

    PushNotification.localNotification({
      title: computedTitle,
      message: computedMessage,
      channelId,
      priority: 'max',
      importance: 'max',
      vibrate: true,
      allowWhileIdle: true,
      ignoreInForeground: false,
      visibility: 'public',
      playSound: true,
      soundName,
      fullScreenIntent: isCall || dtype === 'message' || dtype === 'reaction' || dtype === 'community_reaction' || dtype === 'community_message',
      invokeApp: isCall,
      autoCancel: !isCall,
      userInfo: data,
      actions: isCall ? ['Accept', 'Decline'] : undefined,
      id: dtype === 'group_call' ? this.computeNotificationIdForGroupCall(String(groupCommunityId || '').trim() || '0') : undefined,
      tag: dtype === 'group_call' ? `group_call_${String(groupCommunityId || '').trim()}` : undefined,
    });

    // Start a 40s ringing loop for group calls (repeat sound + vibration)
    if (dtype === 'group_call') {
      const sid = String((data as any)?.communityId || (data as any)?.cid || '').trim();
      if (sid) {
        this.startRinging(sid);
      } else {
        console.warn('group_call without communityId; skipping startRinging');
      }
    }
  }

  showLocalNotification(notificationData: NotificationData): void {
    const dtype = String(notificationData?.data?.type || '').toLowerCase();
    const isCall = dtype === 'call' || dtype === 'group_call' || dtype === 'incoming_call' ||
      String(notificationData.title || '').toLowerCase().includes('call');

    // Deduplicate notifications (special handling for group calls)
    let dedupKey: string | undefined = notificationData?.data?.messageId || notificationData?.data?.msgId || notificationData?.data?.id;
    let groupCommunityId: string | undefined;
    if (dtype === 'group_call') {
      groupCommunityId = String(notificationData?.data?.communityId || '').trim();
      dedupKey = `group_call|${groupCommunityId}`;
    } else if (!dedupKey) {
      dedupKey = `${dtype}|${notificationData?.data?.communityId || ''}|${notificationData.title || ''}|${notificationData.body || ''}`;
    }
    if (dtype !== 'group_call' && this.isDuplicateAndMark(dedupKey)) {
      return;
    }

    const reactorName = notificationData?.data?.reactorName || notificationData?.data?.senderName || notificationData?.data?.fromName || notificationData?.data?.from || '';
    const communityName = notificationData?.data?.communityName || '';

    const title = (() => {
      if (dtype === 'reaction') return reactorName || 'New reaction';
      if (dtype === 'community_reaction') return reactorName || 'New reaction';
      if (dtype === 'community_message') {
        if (notificationData.title) return notificationData.title;
        return `${reactorName || 'New message'} on "${communityName || 'a community'}"`;
      }
      if (dtype === 'incoming_call') return 'Incoming Call';
      return notificationData.title || 'ConnectHer';
    })();

    const message = (() => {
      if (dtype === 'reaction') return `${reactorName || 'Someone'} reacted to your message.`;
      if (dtype === 'community_reaction') return `${reactorName || 'Someone'} reacted to your message on "${communityName || 'a community'}".`;
      if (dtype === 'community_message') {
        return notificationData.body || `New message in "${communityName || 'a community'}"`;
      }
      if (dtype === 'incoming_call') {
        const callType = String(notificationData?.data?.callType || 'audio');
        const fromName = String(notificationData?.data?.caller || reactorName || 'Someone');
        return `Incoming ${callType} call from ${fromName}.`;
      }
      return notificationData.body || 'You have a new notification';
    })();

    const soundName = notificationData.sound || (isCall ? 'connectring.mp3' : (dtype === 'community_message' ? 'notify.mp3' : 'default'));
    const channelId = isCall ? 'connecther_calls' : (notificationData.channelId || 'connecther_messages');

    // Wake the screen for visibility even when device is idle
    try { NotificationPlugin.wakeUpScreen(); } catch (_) {}

    PushNotification.localNotification({
      title,
      message,
      channelId,
      priority: notificationData.priority || 'max',
      importance: 'max',
      vibrate: notificationData.vibrate !== false,
      allowWhileIdle: true,
      ignoreInForeground: false,
      visibility: 'public',
      fullScreenIntent: isCall || dtype === 'message' || dtype === 'reaction' || dtype === 'community_reaction' || dtype === 'community_message',
      autoCancel: !isCall,
      playSound: true,
      soundName,
      userInfo: notificationData.data,
      actions: isCall ? ['Accept', 'Decline'] : undefined,
      id: dtype === 'group_call' ? this.computeNotificationIdForGroupCall(String(groupCommunityId || '').trim() || '0') : undefined,
      tag: dtype === 'group_call' ? `group_call_${String(groupCommunityId || '').trim()}` : undefined,
    });

    if (dtype === 'group_call') {
      const sid = String(notificationData?.data?.communityId || notificationData?.data?.cid || '').trim();
      if (sid) {
        this.startRinging(sid);
      } else {
        console.warn('group_call without communityId; skipping startRinging');
      }
    }
  }

  private startRinging(communityId: string): void {
    try {
      const cid = String(communityId || '').trim();
      if (!cid || cid.toLowerCase() === 'group') return;
      if (this.activeGroupCalls.has(cid)) {
        return; // Do not start ringing if call already active
      }
      if (this.ringingTimers[cid]) {
        clearInterval(this.ringingTimers[cid]);
      }

      const sound = new Sound('connectring.mp3', Sound.MAIN_BUNDLE, (err) => {
        if (err) {
          console.warn('Failed to load ringing sound:', err);
          return;
        }
        sound.setVolume(1.0);
        sound.play((success) => {
          if (!success) {
            console.warn('Ringing sound playback failed');
          }
        });
        this.ringingSounds[cid] = sound;
      });

      this.ringingTimers[cid] = setInterval(() => {
        try { PushNotification.vibrate(); } catch (_) {}
        try {
          const s = this.ringingSounds[cid] || sound;
          s?.stop(() => {
            s?.play();
          });
        } catch (_) {}
      }, 4000);
    } catch (e) {
      console.log('startRinging error', e);
    }
  }

  stopRinging(communityId: string): void {
    try {
      const cid = String(communityId || '').trim();
      if (this.ringingTimers[cid]) {
        clearInterval(this.ringingTimers[cid]);
        delete this.ringingTimers[cid];
      }
      const s = this.ringingSounds[cid];
      if (s) {
        try { s.stop(); } catch (_) {}
        try { s.release(); } catch (_) {}
        delete this.ringingSounds[cid];
      }
      this.activeGroupCalls.delete(cid);
      try { Vibration.cancel(); } catch (_) {}
      try { PushNotification.cancelAllLocalNotifications(); } catch (_) {}
      try { PushNotification.removeAllDeliveredNotifications(); } catch (_) {}
    } catch (e) {}
  }

  stopAllRinging(): void {
    try {
      Object.keys(this.ringingTimers).forEach((cid) => {
        try { clearInterval(this.ringingTimers[cid]); } catch (_) {}
        delete this.ringingTimers[cid];
      });
      Object.keys(this.ringingSounds).forEach((cid) => {
        const s = this.ringingSounds[cid];
        if (s) {
          try { s.stop(); } catch (_) {}
          try { s.release(); } catch (_) {}
        }
        delete this.ringingSounds[cid];
      });
      this.activeGroupCalls.clear();
      try { Vibration.cancel(); } catch (_) {}
      try { PushNotification.cancelAllLocalNotifications(); } catch (_) {}
      try { PushNotification.removeAllDeliveredNotifications(); } catch (_) {}
    } catch (_) {}
  }

  async handleNotificationTap(data: Record<string, any>): Promise<void> {
    try {
      const dtype = String(data?.type || '').toLowerCase();
      if (dtype === 'message' || dtype === 'reaction') {
        const chatId = String(data?.chatId || '');
        const recipientUsername = String(data?.peerUsername || data?.recipientUsername || '');
        const recipientName = String(data?.peerName || data?.recipientName || recipientUsername || '');
        const recipientAvatar = String(data?.peerAvatar || data?.recipientAvatar || '');
        if (chatId && recipientUsername) {
          navigate('Conversation', {
            chatId,
            recipientUsername,
            recipientName,
            recipientAvatar,
          });
        }
        return;
      }
      if (dtype === 'group_call') {
        const communityId = String(data?.communityId || '');
        const communityName = String(data?.communityName || '');
        const callerUsername = String(data?.caller || data?.from || '');
        const type = (String(data?.callType || '').toLowerCase() === 'video') ? 'video' : 'audio';
        if (communityId && communityName && callerUsername) {
          this.stopRinging(communityId);
          this.activeGroupCalls.add(communityId);
          navigate('CommunityIncomingCall', {
            communityId,
            communityName,
            caller: { username: callerUsername },
            type,
          });
        }
        return;
      }
      if (dtype === 'community_message' || dtype === 'community_reaction') {
        const communityId = String(data?.communityId || '');
        const communityName = String(data?.communityName || '');
        if (communityId) {
          navigate('CommunityChat', {
            communityId,
            communityName,
          });
        }
        return;
      }

      if (dtype === 'incoming_call') {
        const caller = String(data?.caller || data?.from || '');
        const type = (String(data?.callType || '').toLowerCase() === 'video') ? 'video' : 'audio';
        if (caller) {
          navigate('IncomingCall', { caller, type });
        }
        return;
      }

      // Default: do nothing special
    } catch (e) {
      console.log('handleNotificationTap error', e);
    }
  }
}

export default PushNotificationService;