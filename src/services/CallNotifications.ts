import { Platform, DeviceEventEmitter } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import PushNotification, { Importance } from 'react-native-push-notification';

// Align with existing app channel naming if present
const CALLS_CHANNEL_ID = 'connecther_calls';

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

function showIncomingCallNotification(payload: any) {
  const caller = payload?.caller || payload?.from || 'Unknown';
  const type: 'audio' | 'video' = (payload?.callType === 'video') ? 'video' : 'audio';
  PushNotification.localNotification({
    channelId: CALLS_CHANNEL_ID,
    title: `Incoming ${type} call`,
    message: `${caller} is calling...`,
    playSound: true,
    soundName: 'connectring.mp3',
    vibrate: true,
    priority: 'max',
    visibility: 'public',
    allowWhileIdle: true,
    fullScreenIntent: true,
    invokeApp: true,
    userInfo: { type: 'incoming_call', caller, callType: type },
  });
}

export async function initCallNotifications() {
  if (Platform.OS === 'android') {
    createCallsChannel();
  }
  try {
    await messaging().requestPermission();
  } catch {}

  // Foreground messages
  messaging().onMessage(async remoteMessage => {
    const data = remoteMessage?.data || {};
    if (data?.type === 'incoming_call') {
      showIncomingCallNotification(data);
      DeviceEventEmitter.emit('incoming_call', data);
    }
  });

  // Background handler (will run when app is in background/quit)
  // Note: RN requires this to be set at the root, but we set it here defensively.
  try {
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      const data = remoteMessage?.data || {};
      if (data?.type === 'incoming_call') {
        showIncomingCallNotification(data);
      }
    });
  } catch {}
}