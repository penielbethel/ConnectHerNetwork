import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import socketService from '../services/SocketService';
import ApiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';

type Params = {
  communityId: string;
  communityName: string;
  mode: 'caller' | 'callee';
  type: 'audio' | 'video';
  caller: { username: string; name?: string; avatar?: string };
};

type Participant = {
  username: string;
  name?: string;
  avatar?: string;
  pc?: RTCPeerConnection | null;
  stream?: any;
  muted?: boolean;
};

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

const CommunityCallScreen: React.FC = () => {
  const route = useRoute<RouteProp<{ params: Params }, 'params'>>();
  const navigation = useNavigation();
  const { communityId, communityName, mode, type } = route.params;

  const [me, setMe] = useState<{ username: string; name?: string; avatar?: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isCreator, setIsCreator] = useState<boolean>(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<any>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidate[]>>({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('currentUser');
        const u = raw ? JSON.parse(raw) : null;
        setMe(u ? { username: u.username, name: u.name, avatar: u.avatar } : null);

        // Fetch role info for admin controls
        const api = new ApiService();
        const members = await api.getCommunityMembers(communityId);
        const myRole = members.find((m: any) => m.username === u?.username);
        setIsAdmin(!!myRole?.isAdmin);
        setIsCreator(!!myRole?.isCreator);
      } catch (e) {
        // ignore
      }
    })();

    setup()
      .catch(err => {
        console.error('Group call setup error', err);
        Alert.alert('Call Error', 'Group call setup encountered an issue.');
      });

    return () => {
      mounted = false;
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

    // Join call room
    if (me?.username) {
      socketService.joinGroupCall({
        username: me.username,
        communityId,
        communityName,
        name: me.name || me.username,
        avatar: me.avatar,
      });
    }

    const sock = socketService.getSocket();

    // Participants list
    sock?.on('group-call-participants', ({ participants: list }: any) => {
      const mapped: Participant[] = (list || []).map((p: any) => ({ username: p.username, name: p.name, avatar: p.avatar }));
      setParticipants(prev => {
        // Keep existing streams if present
        const currentMap: Record<string, Participant> = {};
        for (const p of prev) currentMap[p.username] = p;
        const merged = mapped.map(p => ({ ...p, stream: currentMap[p.username]?.stream, pc: currentMap[p.username]?.pc }));
        return merged.filter(p => p.username !== me?.username);
      });

      // For each remote, create a PC if none and initiate offer if my username is lexicographically smaller
      for (const remote of mapped) {
        if (remote.username === me?.username) continue;
        if (!pcsRef.current[remote.username]) {
          const pc = new RTCPeerConnection({ iceServers });
          pcsRef.current[remote.username] = pc;
          // add local tracks
          stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));
          pc.ontrack = (event: any) => {
            const [trackStream] = event.streams;
            setParticipants(prev => prev.map(p => (p.username === remote.username ? { ...p, stream: trackStream } : p)));
          };
          pc.onicecandidate = (e: any) => {
            if (e.candidate && me?.username) {
              socketService.emit('ice-candidate', {
                from: me.username,
                to: remote.username,
                communityId,
                candidate: e.candidate,
              });
            }
          };

          if ((me?.username || '') < remote.username) {
            // Initiate offer from lower-username side
            (async () => {
              const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
              await pc.setLocalDescription(offer);
              socketService.emit('offer', {
                from: me?.username,
                to: remote.username,
                communityId,
                offer,
                type,
              });
            })().catch(err => console.error('offer error', err));
          }
        }
      }
    });

    // Peer signaling
    sock?.on('offer', async ({ from, offer }: any) => {
      try {
        const pc = pcsRef.current[from] || new RTCPeerConnection({ iceServers });
        pcsRef.current[from] = pc;
        // add local tracks
        localStream?.getTracks()?.forEach((t: any) => pc.addTrack(t, localStream));
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
        await pc.setLocalDescription(answer);
        socketService.emit('answer', { from: me?.username, to: from, communityId, answer });
        // Flush any pending ICE candidates buffered before remote description
        const pending = pendingCandidatesRef.current[from] || [];
        for (const c of pending) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch (e) {
            console.warn('flush candidate error', e);
          }
        }
        pendingCandidatesRef.current[from] = [];
      } catch (err) {
        console.error('on offer error', err);
      }
    });

    sock?.on('answer', async ({ from, answer }: any) => {
      try {
        const pc = pcsRef.current[from];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          // Flush any pending ICE candidates buffered before remote description
          const pending = pendingCandidatesRef.current[from] || [];
          for (const c of pending) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
              console.warn('flush candidate error', e);
            }
          }
          pendingCandidatesRef.current[from] = [];
        }
      } catch (err) {
        console.error('on answer error', err);
      }
    });

    sock?.on('ice-candidate', async ({ from, candidate }: any) => {
      try {
        const pc = pcsRef.current[from];
        if (pc) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            // Buffer candidates until remoteDescription is set
            if (!pendingCandidatesRef.current[from]) pendingCandidatesRef.current[from] = [];
            pendingCandidatesRef.current[from].push(candidate);
          }
        } else {
          // No PC yet: buffer
          if (!pendingCandidatesRef.current[from]) pendingCandidatesRef.current[from] = [];
          pendingCandidatesRef.current[from].push(candidate);
        }
      } catch (err) {
        console.error('on candidate error', err);
      }
    });

    sock?.on('group-call-left', ({ username }: any) => {
      const pc = pcsRef.current[username];
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.close();
        delete pcsRef.current[username];
      }
      setParticipants(prev => prev.filter(p => p.username !== username));
    });
  };

  const toggleMuteSelf = () => {
    const enabled = localStream?.getAudioTracks?.()?.[0]?.enabled;
    const next = !enabled;
    localStream?.getAudioTracks?.()?.forEach((t: any) => (t.enabled = next));
  };

  const adminToggleMute = (target: Participant) => {
    if (!isCreator && !isAdmin) {
      Alert.alert('Not allowed', 'Only creator or admins can mute others.');
      return;
    }
    socketService.emit('toggle-mute-status', {
      communityId,
      target: target.username,
      action: target.muted ? 'unmute' : 'mute',
    });
    setParticipants(prev => prev.map(p => (p.username === target.username ? { ...p, muted: !p.muted } : p)));
  };

  const endCall = () => {
    if (me?.username) {
      socketService.leaveGroupCall({ communityId, username: me.username });
    }
    try {
      const api = new ApiService();
      // Log call end tied to the current user for personal call history
      if (me?.username) {
        api.logCall(me.username, me.username, 'ended', type, 0).catch(() => {});
      }
    } catch (_) {}
    navigation.goBack();
  };

  const cleanup = () => {
    Object.values(pcsRef.current).forEach(pc => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
    });
    pcsRef.current = {} as any;
    localStream?.getTracks()?.forEach((t: any) => t.stop());
    setLocalStream(null);
    setParticipants([]);
  };

  const renderParticipant = ({ item }: { item: Participant }) => (
    <View style={styles.participantRow}>
      {item.avatar ? (
        <Image source={{ uri: item.avatar }} style={styles.participantAvatar} />
      ) : (
        <View style={[styles.participantAvatar, styles.avatarPlaceholder]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.participantName}>{item.name || item.username}</Text>
        <Text style={styles.participantStatus}>{item.muted ? 'Muted' : 'Live'}</Text>
      </View>
      {(isCreator || isAdmin) && (
        <TouchableOpacity style={[styles.btn, item.muted ? styles.unmute : styles.mute]} onPress={() => adminToggleMute(item)}>
          <Text style={styles.btnText}>{item.muted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>{communityName}</Text>
        <TouchableOpacity style={styles.endBtn} onPress={endCall}>
          <Text style={styles.endText}>End</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.grid}>
        {type === 'video' && localStream ? (
          <RTCView streamURL={localStream?.toURL()} style={styles.local} mirror={true} />
        ) : (
          <Text style={styles.callText}>Voice call in progress…</Text>
        )}
        <FlatList
          data={participants}
          keyExtractor={(p) => p.username}
          renderItem={renderParticipant}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={{ padding: 12 }}
        />
      </View>
      <View style={styles.bottomBar}>
        <TouchableOpacity style={[styles.btn, styles.primary]} onPress={toggleMuteSelf}>
          <Text style={styles.btnText}>Toggle Mute</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { ...globalStyles.flexRowBetween, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  endBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#d32f2f', borderRadius: 20 },
  endText: { color: '#fff', fontWeight: '600' },
  grid: { flex: 1, backgroundColor: colors.background },
  local: { width: '40%', height: '40%', position: 'absolute', bottom: 20, right: 20, borderRadius: 8 },
  callText: { color: colors.text, fontSize: 16, padding: 12 },
  bottomBar: { ...globalStyles.flexRowCenter, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24 },
  primary: { backgroundColor: colors.primary },
  btnText: { color: '#fff', fontWeight: '600' },
  participantRow: { ...globalStyles.flexRowBetween, alignItems: 'center', paddingVertical: 8 },
  participantAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  avatarPlaceholder: { backgroundColor: '#333' },
  participantName: { color: colors.text, fontSize: 14 },
  participantStatus: { color: colors.textMuted, fontSize: 12 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});

export default CommunityCallScreen;