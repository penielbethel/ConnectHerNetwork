import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import socketService from '../services/SocketService';
import ApiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';
import InCallManager from 'react-native-incall-manager';
import PushNotificationService from '../services/pushNotifications';

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
  // Track local negotiation state per peer to avoid glare
  const makingOfferRef = useRef<Record<string, boolean>>({});
  // Add call duration state and refs
  const [duration, setDuration] = useState<string>('00:00');
  const callStartRef = useRef<number>(Date.now());
  const durationTimerRef = useRef<any>(null);

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

    // Start duration timer
    durationTimerRef.current = setInterval(() => {
      setDuration(formatDuration(Date.now() - callStartRef.current));
    }, 1000);

    return () => {
      mounted = false;
      cleanup();
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setup = async () => {
    // mark start time for timer
    callStartRef.current = Date.now();
    const constraints = {
      audio: true,
      video: type === 'video' ? { facingMode: 'user' } : false,
    } as any;

    const stream = await mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);

    // Route audio to speaker and set call audio mode
    try {
      InCallManager.start({ media: type === 'video' ? 'video' : 'audio' });
      InCallManager.setForceSpeakerphoneOn(true);
      InCallManager.setKeepScreenOn(true);
    } catch (_) {}

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
    sock?.on('group-call-participants', (payload: any) => {
      const list = Array.isArray(payload) ? payload : (payload?.participants ?? payload ?? []);
      const mapped: Participant[] = (list || []).map((p: any) => ({ username: p.username, name: p.name, avatar: p.avatar }));
      setParticipants(prev => {
        // Keep existing streams if present
        const currentMap: Record<string, Participant> = {};
        for (const p of prev) currentMap[p.username] = p;
        const merged = mapped.map(p => ({ ...p, stream: currentMap[p.username]?.stream, pc: currentMap[p.username]?.pc }));
        return merged.filter(p => p.username !== me?.username);
      });

      // Stop any lingering ringing for this community when participants are present
      try {
        if ((mapped || []).length > 0) {
          // @ts-ignore
          PushNotificationService.getInstance().stopRinging(String(communityId));
        }
      } catch (_) {}

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
              try {
                makingOfferRef.current[remote.username] = true;
                const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
                await pc.setLocalDescription(offer);
                makingOfferRef.current[remote.username] = false;
                socketService.emit('offer', {
                  from: me?.username,
                  to: remote.username,
                  communityId,
                  sdp: offer,
                  type,
                });
              } catch (err) {
                makingOfferRef.current[remote.username] = false;
                console.error('offer error', err);
              }
            })();
          }
        }
      }
    });

    // Peer signaling
    sock?.on('offer', async ({ from, offer, sdp }: any) => {
      try {
        const pc = pcsRef.current[from] || new RTCPeerConnection({ iceServers });
        pcsRef.current[from] = pc;
        // add local tracks
        localStream?.getTracks()?.forEach((t: any) => pc.addTrack(t, localStream));
        // Safeguard: accept both 'offer' and 'sdp' keys
        const rawOffer = offer ?? sdp;
        const remoteOffer = rawOffer && rawOffer.sdp ? { type: rawOffer.type || 'offer', sdp: rawOffer.sdp } : rawOffer;
        if (!remoteOffer || !remoteOffer.sdp) {
          console.warn('invalid offer payload', rawOffer);
          return;
        }

        const polite = (me?.username || '') > from; // arbitrarily choose polite side
        const offerCollision = makingOfferRef.current[from] || pc.signalingState !== 'stable';

        if (offerCollision) {
          if (!polite) {
            console.warn('Ignoring offer due to glare (impolite side).');
            return;
          }
          try {
            await pc.setLocalDescription({ type: 'rollback' } as any);
          } catch (e) {
            console.warn('rollback failed', e);
          }
        }

        await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
        const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: type === 'video' });
        await pc.setLocalDescription(answer);
        socketService.emit('answer', { from: me?.username, to: from, communityId, sdp: answer });
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

    sock?.on('answer', async ({ from, answer, sdp }: any) => {
      try {
        const pc = pcsRef.current[from];
        if (!pc) return;
        // Safeguard: accept both 'answer' and 'sdp' keys
        const rawAnswer = answer ?? sdp;
        const remoteAnswer = rawAnswer && rawAnswer.sdp ? { type: rawAnswer.type || 'answer', sdp: rawAnswer.sdp } : rawAnswer;
        if (!remoteAnswer || !remoteAnswer.sdp) {
          console.warn('invalid answer payload', rawAnswer);
          return;
        }

        if (pc.signalingState !== 'have-local-offer') {
          console.warn('Unexpected answer in state', pc.signalingState);
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
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
        console.error('on answer error', err);
      }
    });

    sock?.on('ice-candidate', async ({ from, candidate }: any) => {
      try {
        const pc = pcsRef.current[from];
        if (!pc) {
          // Buffer the candidate until PC is created and remote description is set
          pendingCandidatesRef.current[from] = [ ...(pendingCandidatesRef.current[from] || []), candidate ];
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('ice candidate error', err);
      }
    });

    // 🔇 Mute status updates broadcasted by server
    sock?.on('toggle-mute-status', ({ username, isMuted }: any) => {
      try {
        setParticipants(prev => prev.map(p => (p.username === username ? { ...p, muted: !!isMuted } : p)));
        if (me?.username === username) {
          localStream?.getAudioTracks?.()?.forEach((t: any) => (t.enabled = !isMuted));
        }
      } catch (err) {
        console.warn('toggle-mute-status handler error', err);
      }
    });

    // 🔒 Force-applied mute for target user
    sock?.on('force-mute-status', ({ isMuted }: any) => {
      try {
        localStream?.getAudioTracks?.()?.forEach((t: any) => (t.enabled = !isMuted));
      } catch (err) {
        console.warn('force-mute-status handler error', err);
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

  // Admin: Mute all / Unmute all
  const muteAll = () => {
    if (!isCreator && !isAdmin) {
      Alert.alert('Not allowed', 'Only creator or admins can mute all.');
      return;
    }
    participants.forEach(p => {
      socketService.emit('toggle-mute-status', { communityId, target: p.username, action: 'mute' });
    });
    setParticipants(prev => prev.map(p => ({ ...p, muted: true })));
  };

  const unmuteAll = () => {
    if (!isCreator && !isAdmin) {
      Alert.alert('Not allowed', 'Only creator or admins can unmute all.');
      return;
    }
    participants.forEach(p => {
      socketService.emit('toggle-mute-status', { communityId, target: p.username, action: 'unmute' });
    });
    setParticipants(prev => prev.map(p => ({ ...p, muted: false })));
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
    try { PushNotificationService.getInstance().stopRinging(String(communityId)); } catch (_) {}
    try { PushNotificationService.getInstance().stopAllRinging(); } catch (_) {}
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
    try { InCallManager.stop(); } catch (_) {}
  };

  const renderParticipant = ({ item }: { item: Participant }) => (
    <View style={styles.participantTile}>
      {type === 'video' && item.stream ? (
        <RTCView streamURL={item.stream?.toURL()} style={styles.remoteTile} />
      ) : (
        <View style={styles.audioTile}>
          {item.avatar ? (
            <Image source={{ uri: item.avatar }} style={styles.participantAvatar} />
          ) : (
            <View style={[styles.participantAvatar, styles.avatarPlaceholder]} />
          )}
          <Text style={styles.participantName}>{item.name || item.username}</Text>
          <Text style={styles.participantStatus}>{item.muted ? 'Muted' : 'Live'}</Text>
        </View>
      )}
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
        <View style={styles.timerBadge}><Text style={styles.timerText}>{duration}</Text></View>
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
          numColumns={2}
          columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: 12 }}
          contentContainerStyle={{ paddingVertical: 12 }}
        />
      </View>
      <View style={styles.controlBar}>
        <TouchableOpacity style={[styles.control, styles.controlPrimary]} onPress={toggleMuteSelf}>
          <Text style={styles.controlLabel}>Mic</Text>
        </TouchableOpacity>
        {(isCreator || isAdmin) && (
          <View style={styles.adminControls}>
            <TouchableOpacity style={[styles.control, styles.controlSecondary]} onPress={muteAll}>
              <Text style={styles.controlLabel}>Mute All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.control, styles.controlSecondary]} onPress={unmuteAll}>
              <Text style={styles.controlLabel}>Unmute All</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity style={[styles.control, styles.controlDanger]} onPress={endCall}>
          <Text style={styles.controlLabel}>✖</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { ...globalStyles.flexRowBetween, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  timerBadge: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  timerText: { color: colors.textMuted, fontWeight: '600' },
  endBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#d32f2f', borderRadius: 20 },
  endText: { color: '#fff', fontWeight: '600' },
  grid: { flex: 1, backgroundColor: colors.background },
  local: { width: '40%', height: '40%', position: 'absolute', bottom: 20, right: 20, borderRadius: 8 },
  callText: { color: colors.text, fontSize: 16, padding: 12 },
  controlBar: { ...globalStyles.flexRowBetween, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  adminControls: { ...globalStyles.flexRowCenter },
  control: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 },
  controlPrimary: { backgroundColor: colors.primary },
  controlSecondary: { backgroundColor: colors.card },
  controlDanger: { backgroundColor: '#d32f2f' },
  controlLabel: { color: '#fff', fontWeight: '700' },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24 },
  primary: { backgroundColor: colors.primary },
  btnText: { color: '#fff', fontWeight: '600' },
  participantTile: { width: '48%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.card, marginBottom: 12 },
  remoteTile: { width: '100%', height: '100%' },
  audioTile: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  participantAvatar: { width: 44, height: 44, borderRadius: 22, marginBottom: 8 },
  avatarPlaceholder: { backgroundColor: '#333' },
  participantName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  participantStatus: { color: colors.textMuted, fontSize: 12 },
  // Styles for per-participant mute/unmute buttons (used above)
  mute: { backgroundColor: colors.card },
  unmute: { backgroundColor: colors.primary },
});

export default CommunityCallScreen;

// Utility: format mm:ss from milliseconds
const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};