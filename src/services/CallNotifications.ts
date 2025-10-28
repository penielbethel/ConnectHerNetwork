import { Platform, DeviceEventEmitter } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import PushNotification, { Importance } from 'react-native-push-notification';
import { isSuppressed } from '../utils/callGuard';
import PushNotificationService from './pushNotifications';

// Align with existing app channel naming if present
const CALLS_CHANNEL_ID = 'connecther_calls';

let initialized = false;
let unsubscribeOnMessage: (() => void) | null = null;

function createCallsChannel() {
  PushNotification.createChannel(
    {
      channelId: CALLS_CHANNEL_ID,
      channelName: 'Calls',
      channelDescription: 'Incoming/outgoing call alerts',
      importance: Importance.MAX,
      vibrate: true,
      soundName: 'connectring.mp3', // expects file in res/raw on Android
    },
    (created) => {
      // no-op
    }
  );
}

function showIncomingCallNotification(remoteMessage: any) {
  const data = remoteMessage?.data || remoteMessage || {};
  const caller = data?.caller || data?.from || 'Unknown';
  const type: 'audio' | 'video' = (data?.callType === 'video') ? 'video' : 'audio';
  const messageId = remoteMessage?.messageId || data?.id || data?.msgId;
  const push = require('./pushNotifications').default.getInstance();
  push.showLocalNotification({
    title: `Incoming ${type} call`,
    body: `${caller} is calling...`,
    data: { type: 'incoming_call', caller, callType: type, id: messageId },
    channelId: CALLS_CHANNEL_ID,
  });
}

export async function initCallNotifications() {
  if (initialized) {
    return;
  }
  initialized = true;

  if (Platform.OS === 'android') {
    createCallsChannel();
  }
  try {
    await messaging().requestPermission();
  } catch {}

  // Foreground messages
  try {
    unsubscribeOnMessage = messaging().onMessage(async remoteMessage => {
      const data = remoteMessage?.data || {};
      if (data?.type === 'incoming_call') {
        const caller = data?.caller || data?.from;
        if (isSuppressed(caller)) {
          return; // ignore suppressed incoming
        }
        showIncomingCallNotification(remoteMessage);
        DeviceEventEmitter.emit('incoming_call', data);
      }
    });
  } catch {}

  // Background handler (will run when app is in background/quit)
  // Note: RN requires this to be set at the root, but we set it here defensively.
  try {
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      const data = remoteMessage?.data || {};
      if (data?.type === 'incoming_call') {
        const caller = data?.caller || data?.from;
        if (isSuppressed(caller)) {
          return; // ignore suppressed incoming
        }
        showIncomingCallNotification(remoteMessage);
      }
    });
  } catch {}
}

export function teardownCallNotifications() {
  try {
    if (unsubscribeOnMessage) {
      unsubscribeOnMessage();
      unsubscribeOnMessage = null;
    }
  } catch {}
  initialized = false;
}