import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import socketService from '../services/SocketService';
import { colors, globalStyles } from '../styles/globalStyles';
import InCallManager from 'react-native-incall-manager';
import apiService from '../services/ApiService';
import { suppressIncomingFrom } from '../utils/callGuard';
import PushNotification from 'react-native-push-notification';
import Icon from 'react-native-vector-icons/MaterialIcons';

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
  const [callType, setCallType] = useState<'audio' | 'video'>(type);
  const [speakerOn, setSpeakerOn] = useState<boolean>(true);
  const [callConnected, setCallConnected] = useState<boolean>(false);
  // Callee profile for audio UI
  const [peerName, setPeerName] = useState<string>('');
  const [peerAvatar, setPeerAvatar] = useState<string>('');
  // Outgoing ringback tone
  const ringAudioRef = useRef<any>(null);
  const ringListenerRef = useRef<any>(null);

  const startRingback = async () => {
  try {
    if (!ringAudioRef.current) ringAudioRef.current = new AudioRecorderPlayer();
    const url = apiService.normalizeAvatar('/connectring.mp3');
    await ringAudioRef.current.startPlayer(url);
    ringAudioRef.current.setVolume(1.0);
    ringListenerRef.current = ringAudioRef.current.addPlayBackListener((e: any) => {
      if (e?.current_position >= e?.duration) {
        ringAudioRef.current?.startPlayer(url);
      }
      return;
    });
  } catch (err) {
    console.warn('Ringback start failed', err);
  }
};

const stopRingback = async () => {
  try {
    if (ringListenerRef.current && ringAudioRef.current) {
      ringAudioRef.current.removePlayBackListener(ringListenerRef.current);
      ringListenerRef.current = null;
    } else if (ringAudioRef.current?.removePlayBackListener) {
      ringAudioRef.current.removePlayBackListener();
    }
    await ringAudioRef.current?.stopPlayer();
  } catch (_) {}
};

// Buffer ICE candidates until remote description is set
const pendingIceRef = useRef<any[]>([]);
const addIceCandidateSafe = async (candidate: any) => {
  const pc = pcRef.current;
  if (!pc) return;
  if (!pc.remoteDescription) {
    pendingIceRef.current.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('addIceCandidate error', err);
  }
};
const flushPendingIce = async () => {
  const pc = pcRef.current;
  if (!pc || !pc.remoteDescription) return;
  const candidates = pendingIceRef.current;
  pendingIceRef.current = [];
  for (const c of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (err) {
      console.error('flush addIceCandidate error', err);
    }
  }
};
useEffect(() => {
    let isMounted = true;
    (async () => {
    try {
      const raw = await AsyncStorage.getItem('currentUser');
      const u = raw ? JSON.parse(raw) : null;
      setUsername(u?.username || '');
    } catch (_) {}

    // Fetch callee profile for audio UI
    try {
      const prof: any = await apiService.getUserByUsername(to);
      if (prof) {
        setPeerName(prof?.name || prof?.username || to);
        setPeerAvatar(prof?.avatar || '');
      } else {
        setPeerName(to);
      }
    } catch (_) {
      setPeerName(to);
    }
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
      video: callType === 'video' ? { facingMode: 'user' } : false,
    } as any;

    const stream = await mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);

    // Ensure audio routed to speaker and call audio mode (no timer until connected)
    try {
      InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
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
      if (!callConnected) {
        startCallTimerIfNeeded();
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected' || state === 'completed') {
        try { stopRingback(); } catch (_) {}
        if (!callConnected) {
          startCallTimerIfNeeded();
        }
      }
    };

    pc.onicecandidate = (e: any) => {
      if (e.candidate) {
        socketService.emit('private-ice-candidate', {
          from: username,
          to,
          candidate: e.candidate,
        });
        // Bridge for web clients
        socketService.emit('ice-candidate', {
          to,
          from: username,
          candidate: e.candidate,
        });
      }
    };

    const socket = socketService.getSocket();

    if (mode === 'caller') {
      // Caller: play ringback and wait for callee to accept
      await startRingback();
      socket?.on('call-accepted', async ({ from }: any) => {
        try {
          // Proceed only if the acceptance is from our peer
          if (from !== to) return;
          await stopRingback();
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: callType === 'video' });
          await pc.setLocalDescription(offer);
          socketService.emit('private-offer', {
            from: username,
            to,
            offer,
            type: callType,
          });
          // Bridge to web clients
          socketService.emit('offer', { to, from: username, sdp: offer.sdp });
        } catch (err) {
          console.error('offer after accept error', err);
        }
      });
    } else {
      // Callee listens for offer and responds with answer
      socket?.on('private-offer', async ({ offer, type: incomingType }: any) => {
        try {
          if (incomingType && incomingType !== callType) {
            setCallType(incomingType);
            if (incomingType === 'video') {
              const vStream = await mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } } as any);
              setLocalStream(vStream);
              vStream.getTracks().forEach((t: any) => pc.addTrack(t, vStream));
            }
          }
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          await flushPendingIce();
          const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: (incomingType || callType) === 'video' });
          await pc.setLocalDescription(answer);
          socketService.emit('private-answer', { from: username, to, answer });
        socketService.emit('answer', { to, from: username, sdp: answer.sdp });
        } catch (err) {
          console.error('callee flow error', err);
        }
      });
    }

    // Common listeners for both caller and callee
    socket?.on('private-answer', async ({ answer }: any) => {
      try {
        await stopRingback();
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingIce();
      } catch (err) {
        console.error('setRemoteDescription error', err);
      }
    });
    socket?.on('private-ice-candidate', async ({ candidate }: any) => {
      try {
        await addIceCandidateSafe(candidate);
      } catch (err) {
        console.error('addIceCandidate error', err);
      }
    });

    // Cross-compat: support generic web RTC events
    socket?.on('offer', async ({ sdp, from }: any) => {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        await flushPendingIce();
        const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: callType === 'video' });
        await pc.setLocalDescription(answer);
        socketService.emit('answer', { to: from, from: username, sdp: answer.sdp });
      } catch (err) {
        console.error('web offer handler error', err);
      }
    });
    socket?.on('answer', async ({ sdp }: any) => {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
        await flushPendingIce();
      } catch (err) {
        console.error('web answer handler error', err);
      }
    });
    socket?.on('ice-candidate', async ({ candidate }: any) => {
      try {
        await addIceCandidateSafe(candidate);
      } catch (err) {
        console.error('web ice handler error', err);
      }
    });

    socket?.on('private-end-call', ({ reason, from }: any) => {
      try { suppressIncomingFrom(from || to, 15000); } catch (_) {}
      try { stopRingback(); } catch (_) {}
      Alert.alert('Call Ended', reason || 'ended');
      const nav: any = navigation as any;
      if (nav?.canGoBack?.()) {
        nav.goBack();
      } else {
        nav.navigate?.('Dashboard');
      }
    });
  };

  const startCallTimerIfNeeded = () => {
    if (callConnected) return;
    setCallConnected(true);
    startTimeRef.current = Date.now();
    try { if (timerRef.current) clearInterval(timerRef.current); } catch (_) {}
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDurationSec(secs);
    }, 1000);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    try { InCallManager.setForceSpeakerphoneOn(next); } catch (_) {}
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

  const switchToVideo = async () => {
    if (callType === 'video') return;
    setCallType('video');
    try {
      const pc = pcRef.current;
      if (!pc) return;
      const vStream = await mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } } as any);
      setLocalStream(vStream);
      vStream.getTracks().forEach((t: any) => pc.addTrack(t, vStream));
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      socketService.emit('private-offer', { from: username, to, offer, type: 'video' });
    } catch (err) {
      console.error('switchToVideo error', err);
    }
  };

  const endCall = async () => {
    try {
      socketService.emit('private-end-call', { from: username, to });
    } catch (_) {}

    // Prevent re-opening incoming call: briefly suppress and clear notifications
    try { suppressIncomingFrom(to, 15000); } catch (_) {}
    try { PushNotification.cancelAllLocalNotifications(); } catch (_) {}

    // Log call end with duration
    try {
      const duration = Math.max(durationSec, 0);
      const caller = mode === 'caller' ? username : to;
      const receiver = mode === 'caller' ? to : username;
      await apiService.post('/calls', { caller, receiver, status: 'ended', type: callType, duration });
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
    // Remove socket listeners to prevent leaks
    try {
      const sock = socketService.getSocket();
      sock?.off('call-accepted');
      sock?.off('decline-call');
      sock?.off('private-offer');
      sock?.off('private-answer');
      sock?.off('private-ice-candidate');
      sock?.off('offer');
      sock?.off('answer');
      sock?.off('ice-candidate');
    } catch (_) {}
    // Reset pending ICE
    pendingIceRef.current = [];
    try { stopRingback(); } catch (_) {}
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
          <View style={styles.audioArea}>
            {!callConnected ? (
              <View style={styles.audioHeader}>
                {peerAvatar ? (
                  <Image source={{ uri: apiService.normalizeAvatar(peerAvatar) }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder} />
                )}
                <Text style={styles.peerName}>{peerName || to}</Text>
                <Text style={styles.subText}>{mode === 'caller' ? 'Ringing…' : 'Connecting…'}</Text>
              </View>
            ) : (
              <Text style={styles.callText}>Voice call connected</Text>
            )}
          </View>
        )}
        {remoteStream && (
          <RTCView streamURL={remoteStream?.toURL()} style={styles.remote} />
        )}
      </View>
      <View style={styles.controls}>
        <Text style={styles.durationText}>{callConnected ? `Duration: ${formatDuration(durationSec)}` : 'Ringing…'}</Text>
        <View style={styles.controlsBar}>
          <TouchableOpacity style={styles.controlIcon}>
            <Icon name="more-horiz" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlIcon} onPress={switchToVideo} disabled={callType === 'video'}>
            <Icon name="videocam" size={28} color={callType === 'video' ? '#9aa0a6' : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlIcon} onPress={toggleSpeaker}>
            <Icon name={speakerOn ? 'volume-up' : 'volume-off'} size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlIcon} onPress={toggleMute}>
            <Icon name={isMuted ? 'mic-off' : 'mic'} size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlIcon, styles.hangIcon]} onPress={endCall}>
            <Icon name="call-end" size={30} color="#fff" />
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
  audioArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  audioHeader: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 12,
    backgroundColor: '#222',
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 12,
    backgroundColor: '#333',
  },
  peerName: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  subText: {
    fontSize: 14,
    color: colors.mutedText,
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
  controlsBar: {
    ...globalStyles.flexRowCenter,
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
    marginTop: 16,
    backgroundColor: '#1e1f24',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  controlIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2d31',
    marginHorizontal: 8,
    marginVertical: 6,
  },
  hangIcon: {
    backgroundColor: '#d32f2f',
  },
});

export default CallScreen;