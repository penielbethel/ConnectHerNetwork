import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import socketService from '../services/SocketService';
import apiService from '../services/ApiService';
import { colors } from '../styles/globalStyles';
import { RootStackParamList } from '../types/navigation';
import { isSuppressed } from '../utils/callGuard';
// Lazily load audio player to avoid constructor issues during navigation/mount

type IncomingCallRoute = RouteProp<RootStackParamList, 'IncomingCall'>;

const IncomingCallScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<IncomingCallRoute>();
  const { caller, type } = route.params;
  const [currentUser, setCurrentUser] = useState<{ username: string; name?: string; avatar?: string } | null>(null);
  const [callerProfile, setCallerProfile] = useState<{ username: string; name?: string; avatar?: string } | null>(null);
  const audioRef = useRef<any>(null);
  const [isRinging, setIsRinging] = useState(true);

  useEffect(() => {
    // Guard: if this caller is suppressed (call just ended), skip showing
    if (isSuppressed(caller)) {
      try { Vibration.cancel(); } catch (_) {}
      try {
        const nav: any = navigation as any;
        if (nav?.canGoBack?.()) {
          nav.goBack();
        } else {
          nav.navigate?.('Dashboard');
        }
      } catch (_) {}
      return;
    }

    (async () => {
      try {
        const raw = await AsyncStorage.getItem('currentUser');
        const user = raw ? JSON.parse(raw) : null;
        setCurrentUser(user);
      } catch (_) {}

      // Fetch caller avatar/name
      try {
        const profile = await apiService.getUserByUsername(caller);
        if (profile) setCallerProfile(profile as any);
      } catch (e) {
        // fallback silently
      }
    })();

    // Gentle vibration to alert
    try { Vibration.vibrate([0, 200, 200, 400], true); } catch (_) {}

    // Start ringtone (lazy import to prevent native constructor errors)
    (async () => {
      try {
        try {
          const mod = require('react-native-audio-recorder-player');
          const exported = mod?.default ?? mod?.AudioRecorderPlayer ?? null;
          if (!audioRef.current && exported) {
            audioRef.current = typeof exported === 'function' ? new exported() : exported;
          }
        } catch (_) {}
        if (!audioRef.current) return;

        const url = apiService.normalizeAvatar('/connectring.mp3');
        await audioRef.current.startPlayer(url);
        try { audioRef.current.setVolume(1.0); } catch (_) {}
        audioRef.current.addPlayBackListener((e: any) => {
          if (!isRinging) return true;
          const duration = Number(e?.duration || 0);
          const pos = Number(e?.currentPosition || 0);
          if (duration > 0 && pos >= duration - 250) {
            try { audioRef.current?.stopPlayer?.(); } catch (_) {}
            try { audioRef.current?.startPlayer?.(url); } catch (_) {}
          }
          return true;
        });
      } catch (err) {
        console.log('Ringtone start failed:', err);
      }
    })();

    return () => {
      try { Vibration.cancel(); } catch (_) {}
      setIsRinging(false);
      try {
        audioRef.current?.stopPlayer?.();
        audioRef.current?.removePlayBackListener?.();
      } catch (_) {}
    };
  }, []);

  const handleAccept = async () => {
    try {
      const from = currentUser?.username || '';
      // Tell server we accept
      socketService.acceptCall({ from, to: caller });
      // Stop alerts: ringtone + vibration
      setIsRinging(false);
      try { Vibration.cancel(); } catch (_) {}
      try {
        audioRef.current?.stopPlayer?.();
        audioRef.current?.removePlayBackListener?.();
      } catch (_) {}
      // Navigate to call screen
      navigation.navigate('Call' as never, { to: caller, type, mode: 'callee' } as never);
      // Optionally log acceptance (server may log separately)
      try {
        await apiService.post('/calls', { caller, receiver: from, status: 'accepted', type });
      } catch (_) {}
    } catch (e) {
      console.log('Accept call failed:', e);
    }
  };

  const handleDecline = async () => {
    try {
      const from = currentUser?.username || '';
      socketService.rejectCall({ from, to: caller });
      // Stop ringtone
      setIsRinging(false);
      try {
        audioRef.current?.stopPlayer?.();
        audioRef.current?.removePlayBackListener?.();
      } catch (_) {}
      // Log declined/missed
      try {
        await apiService.post('/calls', { caller, receiver: from, status: 'declined', type });
      } catch (_) {}
      // Safely navigate away even if there is no back stack
      try {
        const nav: any = navigation as any;
        if (nav?.canGoBack?.()) {
          nav.goBack();
        } else {
          nav.navigate?.('Dashboard');
        }
      } catch (_) {}
    } catch (e) {
      console.log('Decline call failed:', e);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatarWrap}>
          <Icon name={type === 'video' ? 'videocam' : 'call'} size={28} color="#fff" style={{ marginRight: 12 }} />
          <Image source={{ uri: apiService.normalizeAvatar(callerProfile?.avatar) }} style={styles.avatar} />
        </View>
        <Text style={styles.title}>Incoming {type === 'video' ? 'Video' : 'Voice'} Call</Text>
        <Text style={styles.subtitle}>from @{callerProfile?.name || caller}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.button, styles.accept]} onPress={handleAccept}>
            <Icon name="call" color="#fff" size={24} />
            <Text style={styles.btnText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.decline]} onPress={handleDecline}>
            <Icon name="call-end" color="#fff" size={24} />
            <Text style={styles.btnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#00000099',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '85%',
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderColor: '#272727',
    borderWidth: 1,
  },
  avatarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#cccccc',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 24,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 32,
    flex: 1,
    marginHorizontal: 6,
  },
  accept: {
    backgroundColor: '#28a745',
  },
  decline: {
    backgroundColor: '#dc3545',
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default IncomingCallScreen;