import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import socketService from '../services/SocketService';
import { colors, globalStyles } from '../styles/globalStyles';

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
    socket?.on('private-end-call', ({ reason }: any) => {
      Alert.alert('Call Ended', reason || 'ended');
      navigation.goBack();
    });
  };

  const endCall = () => {
    socketService.emit('private-end-call', { to });
    navigation.goBack();
  };

  const cleanup = () => {
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
        <TouchableOpacity style={styles.endButton} onPress={endCall}>
          <Text style={styles.endText}>End Call</Text>
        </TouchableOpacity>
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
    ...globalStyles.flexRowCenter,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
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