import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import socketService from '../services/SocketService';
import { colors, globalStyles } from '../styles/globalStyles';
import InCallManager from 'react-native-incall-manager';
import apiService from '../services/ApiService';
import { suppressIncomingFrom } from '../utils/callGuard';
import PushNotification from 'react-native-push-notification';

type CallParams = {
  to: string;
  type: 'audio' | 'video';
  mode?: 'caller' | 'callee';
};

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

const CallScreen = () => {
  const route = useRoute<RouteProp<{ params: CallParams }, 'params'>>();
  const navigation = useNavigation();
  const { to, type, mode = 'caller' } = route.params;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [username, setUsername] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [durationSec, setDurationSec] = useState<number>(0);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('currentUser');
        const u = raw ? JSON.parse(raw) : null;
        setUsername(u?.username || '');
      } catch (_) {}
    })();

    setup()
      .catch(err => {
        console.error('Call setup error', err);
        Alert.alert('Call Error', 'Call setup encountered an issue. Retrying/continuing…');
      });

    return () => {
      isMounted = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setup = async () => {
    const constraints = {
      audio: true,
      video: type === 'video' ? { facingMode: 'user' } : false,
    } as any;

    const stream = await mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);

    // Start duration timer
    startTimeRef.current = Date.now();
    try { if (timerRef.current) clearInterval(timerRef.current); } catch (_) {}
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDurationSec(secs);
    }, 1000);

    // Ensure audio routed to speaker and call audio mode
    try {
      InCallManager.start({ media: type === 'video' ? 'video' : 'audio' });
      InCallManager.setForceSpeakerphoneOn(true);
      InCallManager.setKeepScreenOn(true);
    } catch (_) {}

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    // Add local tracks
    stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));

    // Remote stream
    pc.ontrack = (event: any) => {
      const [trackStream] = event.streams;
      setRemoteStream(trackStream);
    };

    pc.onicecandidate = (e: any) => {
      if (e.candidate) {
        socketService.emit('private-ice-candidate', {
          from: username,
          to,
          candidate: e.candidate,
        });
      }
    };

    const socket = socketService.getSocket();

    if (mode === 'caller') {
      // Initiate offer as caller
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
      await pc.setLocalDescription(offer);
      socketService.emit('private-offer', {
        from: username,
        to,
        offer,
        type,
      });
    } else {
      // Callee listens for offer and responds with answer
      socket?.on('private-offer', async ({ offer }: any) => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
          await pc.setLocalDescription(answer);
          socketService.emit('private-answer', { from: username, to, answer });
        } catch (err) {
          console.error('callee flow error', err);
        }
      });
    }

    // Common listeners for both caller and callee
    socket?.on('private-answer', async ({ answer }: any) => {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('setRemoteDescription error', err);
      }
    });
    socket?.on('private-ice-candidate', async ({ candidate }: any) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('addIceCandidate error', err);
      }
    });
    socket?.on('private-end-call', ({ reason, from }: any) => {
      // Suppress any stray incoming_call from this peer for a short window
      try { suppressIncomingFrom(from || to, 5000); } catch (_) {}
      Alert.alert('Call Ended', reason || 'ended');
      const nav: any = navigation as any;
      if (nav?.canGoBack?.()) {
        nav.goBack();
      } else {
        nav.navigate?.('Dashboard');
      }
    });
  };

  const toggleMute = () => {
    try {
      const next = !isMuted;
      setIsMuted(next);
      const s = localStream;
      if (s) {
        s.getAudioTracks()?.forEach((t: any) => {
          t.enabled = !next;
        });
      }
      try { InCallManager.setMicrophoneMute(next); } catch (_) {}
    } catch (_) {}
  };

  const endCall = async () => {
    try {
      socketService.emit('private-end-call', { from: username, to });
    } catch (_) {}

    // Prevent re-opening incoming call: briefly suppress and clear notifications
    try { suppressIncomingFrom(mode === 'caller' ? to : username, 5000); } catch (_) {}
    try { PushNotification.cancelAllLocalNotifications(); } catch (_) {}

    // Log call end with duration
    try {
      const duration = Math.max(durationSec, 0);
      const caller = mode === 'caller' ? username : to;
      const receiver = mode === 'caller' ? to : username;
      await apiService.post('/calls', { caller, receiver, status: 'ended', type, duration });
    } catch (_) {}

    const nav: any = navigation as any;
    if (nav?.canGoBack?.()) {
      nav.goBack();
    } else {
      nav.navigate?.('Dashboard');
    }
  };

  const cleanup = () => {
    try { if (timerRef.current) clearInterval(timerRef.current); } catch (_) {}
    const pc = pcRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      pcRef.current = null;
    }
    localStream?.getTracks()?.forEach((t: any) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    try { InCallManager.stop(); } catch (_) {}
  };

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const hh = h > 0 ? String(h).padStart(2, '0') + ':' : '';
    return `${hh}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.videoArea}>
        {type === 'video' && localStream ? (
          <RTCView streamURL={localStream?.toURL()} style={styles.local} mirror={true} />
        ) : (
          <Text style={styles.callText}>Voice call in progress…</Text>
        )}
        {remoteStream && (
          <RTCView streamURL={remoteStream?.toURL()} style={styles.remote} />
        )}
      </View>
      <View style={styles.controls}>
        <Text style={styles.durationText}>Duration: {formatDuration(durationSec)}</Text>
        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.muteButton} onPress={toggleMute}>
            <Text style={styles.muteText}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.endButton} onPress={endCall}>
            <Text style={styles.endText}>End Call</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  videoArea: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  local: {
    width: '40%',
    height: '40%',
    position: 'absolute',
    bottom: 20,
    right: 20,
    borderRadius: 8,
  },
  remote: {
    width: '100%',
    height: '100%',
  },
  callText: {
    color: colors.text,
    fontSize: 16,
  },
  controls: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  controlsRow: {
    ...globalStyles.flexRowCenter,
    justifyContent: 'space-between',
    marginTop: 12,
  },
  durationText: {
    color: colors.text,
    fontWeight: '600',
  },
  muteButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: '#455a64',
  },
  muteText: {
    color: colors.text,
    fontWeight: 'bold',
  },
  endButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: '#d32f2f',
  },
  endText: {
    color: colors.text,
    fontWeight: 'bold',
  },
});

export default CallScreen;