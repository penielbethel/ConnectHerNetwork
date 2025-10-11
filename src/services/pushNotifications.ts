import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { firebase } from '@react-native-firebase/app';
import { Platform, Alert, PermissionsAndroid, InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PushNotification from 'react-native-push-notification';
import socketService from './SocketService';
import { navigate } from '../navigation/RootNavigation';

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

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // First, detect if the Firebase default app is available
      try {
        const app = firebase.app();
        if (app) {
          this.firebaseAvailable = true;
          console.log('Firebase default app initialized:', app.name);
        }
      } catch (appInitError) {
        this.firebaseAvailable = false;
        // Tone down startup noise: avoid yellowbox stack by using log
        console.log('Firebase default app not initialized; continuing with local notifications');
      }

      // Configure push notifications (local notifications always work)
      this.configurePushNotifications();

      // Request permission for notifications (skip Firebase messaging if not available)
      await this.requestPermission();

      // Try to set up Firebase messaging only if Firebase is available
      if (this.firebaseAvailable) {
        // Defer FCM setup until after initial UI interactions to reduce startup contention
        InteractionManager.runAfterInteractions(async () => {
          try {
            await this.setupFirebaseMessaging();
            console.log('Firebase messaging initialized successfully');
          } catch (firebaseError) {
            // Avoid yellowbox stack by using log for non-fatal messaging availability
            console.log('Firebase messaging not available, using local notifications only');
            this.firebaseAvailable = false;
          }
        });
      }
      
      this.isInitialized = true;
      console.log('Push notification service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize push notification service:', error);
      // Don't throw error - allow app to continue with basic functionality
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

      // If Firebase is not available, skip Firebase Messaging permission gracefully
      if (!this.firebaseAvailable) {
        // Use log to avoid yellowbox component stack
        console.log('Firebase messaging permission skipped: default app not available');
        console.log('Notification permissions granted (local notifications only)');
        return true;
      }

      // Request Firebase messaging permission
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        console.warn('Firebase messaging permission denied');
        return false;
      }

      console.log('Notification permissions granted');
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
          this.handleNotificationTap(notification);
        }
      },

      onAction: (notification) => {
        console.log('Notification action:', notification);
        // Accept/Decline actions for call alerts
        try {
          const action = (notification as any).action;
          const data = (notification as any)?.data || (notification as any)?.userInfo || {};
          const caller = data?.caller || data?.from || data?.username;
          const type = (data?.callType || data?.type) === 'video' ? 'video' : 'audio';

          if (action === 'Accept' && caller) {
            socketService.acceptCall({ from: data?.receiver || data?.to, to: caller });
            navigate('Call', { to: caller, type, mode: 'callee' });
          } else if (action === 'Decline' && caller) {
            socketService.rejectCall({ from: data?.receiver || data?.to, to: caller });
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
        soundName: 'default',
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
        soundName: 'default',
        importance: 5,
        vibrate: true,
      },
    ];

    channels.forEach(channel => {
      PushNotification.createChannel(channel, (created) => {
        console.log(`Channel ${channel.channelId} created:`, created);
      });
    });
  }

  private async setupFirebaseMessaging(): Promise<void> {
    try {
      // Check if Firebase messaging is available
      if (!messaging) {
        throw new Error('Firebase messaging not available');
      }

      // Get FCM token
      const fcmToken = await messaging().getToken();
      if (fcmToken) {
        console.log('FCM Token:', fcmToken);
        await this.saveFCMToken(fcmToken);
      }

      // Listen for token refresh
      messaging().onTokenRefresh(async (token) => {
        console.log('FCM Token refreshed:', token);
        await this.saveFCMToken(token);
      });

      // Handle foreground messages
      messaging().onMessage(async (remoteMessage) => {
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
        this.handleNotificationTap(remoteMessage);
      });

      // Check if app was opened from a notification
      const initialNotification = await messaging().getInitialNotification();
      if (initialNotification) {
        console.log('App opened from notification:', initialNotification);
        this.handleNotificationTap(initialNotification);
      }
    } catch (error) {
      console.error('Error setting up Firebase messaging:', error);
      throw error; // Re-throw to be caught by the initialize method
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

  private displayLocalNotification(remoteMessage: FirebaseMessagingTypes.RemoteMessage): void {
    const { notification, data } = remoteMessage;
    
    if (!notification) return;

    const isCall = !!(data?.caller || String(data?.type || '').toLowerCase() === 'call' || String(notification.title || '').toLowerCase().includes('call'));
    const channelId = isCall ? 'connecther_calls' : 'connecther_messages';
    const actions = isCall ? ['Accept', 'Decline'] : ['View'];

    PushNotification.localNotification({
      title: notification.title || 'ConnectHer',
      message: notification.body || 'You have a new notification',
      channelId,
      priority: 'max',
      importance: 'max',
      vibrate: true,
      allowWhileIdle: true,
      ignoreInForeground: false,
      visibility: 'public',
      playSound: true,
      soundName: 'default',
      fullScreenIntent: isCall,
      autoCancel: !isCall,
      userInfo: data,
      actions,
    });
  }

  showLocalNotification(notificationData: NotificationData): void {
    PushNotification.localNotification({
      title: notificationData.title,
      message: notificationData.body,
      channelId: notificationData.channelId || 'connecther_notifications',
      priority: notificationData.priority || 'max',
      importance: 'max',
      vibrate: notificationData.vibrate !== false,
      allowWhileIdle: true,
      ignoreInForeground: false,
      visibility: 'public',
      fullScreenIntent: true,
      autoCancel: true,
      playSound: true,
      soundName: notificationData.sound || 'default',
      userInfo: notificationData.data,
    });
  }

  private handleNotificationTap(notification: any): void {
    console.log('Notification tapped:', notification);
    
    // Handle different notification types
    const data = notification.data || notification.userInfo;
    
    if (data?.type) {
      switch (data.type) {
        case 'message':
          // Navigate to messages screen
          console.log('Navigate to messages');
          break;
        case 'call':
          // Navigate to full-screen incoming call UI
          try {
            const caller = (data as any)?.caller || (data as any)?.from || (data as any)?.username;
            const callType = ((data as any)?.callType === 'video' || (data as any)?.type === 'video') ? 'video' : 'audio';
            if (caller) {
              navigate('IncomingCall', { caller, type: callType });
            }
          } catch (e) {
            console.log('Navigate to IncomingCall failed:', e);
          }
          break;
        case 'event':
          // Navigate to events screen
          console.log('Navigate to events');
          break;
        case 'profile':
          // Navigate to profile screen
          console.log('Navigate to profile');
          break;
        default:
          // Navigate to home screen
          console.log('Navigate to home');
          break;
      }
    }
  }

  async subscribeToTopic(topic: string): Promise<void> {
    if (!this.firebaseAvailable) {
      console.log(`Cannot subscribe to topic ${topic}: Firebase messaging not available`);
      return;
    }
    
    try {
      await messaging().subscribeToTopic(topic);
      console.log(`Subscribed to topic: ${topic}`);
    } catch (error) {
      // Avoid noisy stack traces; surface as a concise message
      console.log(`Subscribe to topic failed (${topic}). Messaging unavailable or not initialized.`);
    }
  }

  async unsubscribeFromTopic(topic: string): Promise<void> {
    if (!this.firebaseAvailable) {
      console.log(`Cannot unsubscribe from topic ${topic}: Firebase messaging not available`);
      return;
    }
    
    try {
      await messaging().unsubscribeFromTopic(topic);
      console.log(`Unsubscribed from topic: ${topic}`);
    } catch (error) {
      console.log(`Unsubscribe from topic failed (${topic}). Messaging unavailable or not initialized.`);
    }
  }

  cancelAllNotifications(): void {
    PushNotification.cancelAllLocalNotifications();
    console.log('All notifications cancelled');
  }

  cancelNotification(id: string): void {
    PushNotification.cancelLocalNotifications({ id });
    console.log(`Notification ${id} cancelled`);
  }

  async checkPermissionStatus(): Promise<boolean> {
    try {
      const authStatus = await messaging().hasPermission();
      return authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
             authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    } catch (error) {
      console.error('Error checking notification permission:', error);
      return false;
    }
  }

  showPermissionAlert(): void {
    Alert.alert(
      'Enable Notifications',
      'To receive important updates and messages, please enable notifications for ConnectHer in your device settings.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Settings',
          onPress: () => {
            // Open app settings
            if (Platform.OS === 'ios') {
              // Linking.openURL('app-settings:');
            } else {
              // Linking.openSettings();
            }
          },
        },
      ]
    );
  }
}

export default PushNotificationService;