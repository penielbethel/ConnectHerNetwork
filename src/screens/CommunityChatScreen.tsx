import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Share,
  Keyboard,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import apiService from '../services/ApiService';
import socketService from '../services/SocketService';
import { colors, globalStyles } from '../styles/globalStyles';
import { Linking, Alert } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import audioRecorderService from '../services/AudioRecorder';
import { PermissionsManager } from '../utils/permissions';
import RecordingWaveform from '../components/RecordingWaveform';

type RouteParams = {
  params: {
    communityId: string;
    communityName?: string;
  };
};

interface CommunityMessage {
  _id: string;
  communityId: string;
  sender: { username: string; name?: string; avatar?: string } | string;
  text: string;
  media?: Array<{ url: string; type?: string; thumbnailUrl?: string }>;
  time: string;
}

const CommunityChatScreen: React.FC = () => {
  const route = useRoute<RouteProp<RouteParams, 'params'>>();
  const navigation = useNavigation();
  const { communityId, communityName } = route.params;
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [currentUser, setCurrentUser] = useState<{ username: string; name?: string; avatar?: string } | null>(null);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const [community, setCommunity] = useState<any>(null);
  const [members, setMembers] = useState<Array<{ username: string; name?: string; avatar?: string; isAdmin?: boolean; isCreator?: boolean }>>([]);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [attachMenuVisible, setAttachMenuVisible] = useState(false);
  const [emojiVisible, setEmojiVisible] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<CommunityMessage | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editText, setEditText] = useState('');
  const [avatarPreviewVisible, setAvatarPreviewVisible] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  // Voice note state
  const [isRecording, setIsRecording] = useState(false);
  const [recordTimeMs, setRecordTimeMs] = useState(0);
  const [recordFileUri, setRecordFileUri] = useState<string | null>(null);
  const emojis: string[] = ['😀','😂','😍','👍','🙏','🎉','😎','❤️','🔥','🥳','😢','🤔','👏','💯'];
  const handleEmojiSelect = (emoji: string) => {
    setInputText(prev => prev + emoji);
  };

  useEffect(() => {
    navigation.setOptions({
      headerTitle: communityName ? `# ${communityName}` : 'Community Chat',
    });
  }, [communityName, navigation]);

  // Auto-close header menu after 3 seconds if unused
  useEffect(() => {
    if (menuVisible) {
      const t = setTimeout(() => setMenuVisible(false), 3000);
      return () => clearTimeout(t);
    }
  }, [menuVisible]);

  useEffect(() => {
    (async () => {
      try {
        const userStr = await AsyncStorage.getItem('currentUser');
        const user = userStr ? JSON.parse(userStr) : null;
        setCurrentUser(user);
      } catch (_) {}
      await Promise.all([loadMessages(), loadCommunityData()]);
      // Join socket room for this community to receive live updates
      try {
        socketService.joinCommunity(communityId);
      } catch (_) {}
    })();

    const handler = (msg: any) => {
      // Only handle messages for this community
      const mid = msg?.communityId || msg?.community || route.params.communityId;
      if (String(mid) !== String(communityId)) return;
      setMessages(prev => {
        const exists = prev.some(m => m._id === msg?._id);
        if (exists) return prev;
        const normalized = normalizeMessage(msg);
        return [...prev, normalized];
      });
      if (atBottomRef.current) {
        scrollToEnd();
      }
    };

    socketService.on('community-message', handler);
    return () => {
      try {
        socketService.off('community-message', handler);
        socketService.leaveCommunity(communityId);
      } catch (_) {}
    };
  }, [communityId]);

  const loadCommunityData = async () => {
    try {
      const info = await apiService.getCommunity(communityId);
      setCommunity(info?.community || info);
    } catch (e) {
      // ignore
    }
    try {
      const res = await apiService.getCommunityMembers(communityId);
      setMembers(res?.members || []);
    } catch (e) {
      setMembers([]);
    }
  };

  const scrollToEnd = () => {
    try {
      flatListRef.current?.scrollToEnd({ animated: true });
    } catch (_) {}
  };

  const normalizeMessage = (m: any): CommunityMessage => {
    const senderObj = typeof m?.sender === 'string' ? { username: m.sender } : (m?.sender || {});
    const generatedId = `${m?._id || ''}`.trim() || `${communityId}-${m?.time || Date.now()}-${Math.round(Math.random()*1e9)}`;
    return {
      _id: generatedId,
      communityId: m?.communityId || communityId,
      sender: {
        username: senderObj?.username || senderObj?.name || 'unknown',
        name: senderObj?.name || senderObj?.username,
        avatar: senderObj?.avatar,
      },
      text: m?.text || m?.content || '',
      media: apiService['normalizeMedia'] ? (apiService as any)['normalizeMedia'](m?.media) : (Array.isArray(m?.media) ? m.media : []),
      time: m?.time || m?.createdAt || new Date().toISOString(),
    };
  };

  const loadMessages = async () => {
    try {
      const res = await apiService.getCommunityMessages(communityId);
      const raw = (res as any)?.messages || [];
      // Normalize and de-duplicate by _id to avoid duplicate FlatList keys
      const list = raw.map(normalizeMessage);
      const dedupMap = new Map<string, CommunityMessage>();
      for (const msg of list) {
        if (!dedupMap.has(msg._id)) {
          dedupMap.set(msg._id, msg);
        }
      }
      setMessages(Array.from(dedupMap.values()));
      setTimeout(scrollToEnd, 200);
    } catch (e) {
      // swallow
    }
  };

  const handleShareInvite = async () => {
    try {
      const link = `https://connecther.network/accept.html?id=${encodeURIComponent(communityId)}`;
      const message = communityName
        ? `Join ${communityName} on ConnectHer: ${link}`
        : `Join this community on ConnectHer: ${link}`;
      await Share.share({ message });
    } catch (_) {}
  };

  const handleToggleAdmin = async (member: { username: string; isAdmin?: boolean }) => {
    try {
      const me = currentUser?.username;
      const meIsCreator = !!members.find((m) => m.username === me && m.isCreator);
      if (!meIsCreator) {
        Alert.alert('Not allowed', 'Only the community creator can change admin roles.');
        return;
      }
      if (member.isAdmin) {
        await apiService.demoteCommunityMember(communityId, member.username);
      } else {
        await apiService.promoteCommunityMember(communityId, member.username);
      }
      await loadCommunityData();
    } catch (e) {
      // ignore
    }
  };

  const handleVoiceGroupCall = async () => {
    try {
      if (!currentUser?.username) return;
      const memberUsernames = Array.isArray((community as any)?.members)
        ? (community as any).members
        : members.map(m => m.username);
      socketService.startGroupCall({
        from: currentUser.username,
        communityId,
        communityName: communityName || (community?.name || ''),
        members: memberUsernames,
        type: 'audio',
      });
      // Trigger FCM push to notify background users
      try {
        await (apiService as any).notifyCommunityGroupCallStart(communityId, currentUser.username, 'audio');
      } catch (_) {}
      // Navigate to dedicated RN call screen as caller
      // @ts-ignore
      navigation.navigate('CommunityCall', {
        communityId,
        communityName: communityName || (community?.name || ''),
        mode: 'caller',
        type: 'audio',
        caller: { username: currentUser.username, name: currentUser.name, avatar: currentUser.avatar },
      });
    } catch (e) {
      // ignore
    }
  };

  const handleVideoGroupCall = async () => {
    try {
      if (!currentUser?.username) return;
      const memberUsernames = Array.isArray((community as any)?.members)
        ? (community as any).members
        : members.map(m => m.username);
      socketService.startGroupCall({
        from: currentUser.username,
        communityId,
        communityName: communityName || (community?.name || ''),
        members: memberUsernames,
        type: 'video',
      });
      try {
        await (apiService as any).notifyCommunityGroupCallStart(communityId, currentUser.username, 'video');
      } catch (_) {}
      // @ts-ignore
      navigation.navigate('CommunityCall', {
        communityId,
        communityName: communityName || (community?.name || ''),
        mode: 'caller',
        type: 'video',
        caller: { username: currentUser.username, name: currentUser.name, avatar: currentUser.avatar },
      });
    } catch (e) {
      // ignore
    }
  };

  const sendText = async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    try {
      const res = await apiService.sendCommunityTextMessage(communityId, text, replyTo || undefined);
      const saved = (res as any)?.message || res;
      const normalized = normalizeMessage(saved);
      setMessages(prev => [...prev, normalized]);
      setReplyTo(null);
      scrollToEnd();
    } catch (e) {
      Alert.alert('Send failed', 'Could not send message.');
    }
  };

  // Voice notes
  const formatRecordTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const requestAudioPermission = async () => {
    try {
      const perm = await PermissionsManager.requestAudioPermission();
      return !!perm?.granted;
    } catch (e) {
      return false;
    }
  };

  const startRecording = async () => {
    const allowed = Platform.OS === 'android' ? await requestAudioPermission() : true;
    if (!allowed) {
      Alert.alert('Permission required', 'Microphone access is needed to record voice notes.');
      return;
    }
    try {
      audioRecorderService.onUpdate((_, pos) => setRecordTimeMs(pos));
      const uri = await audioRecorderService.startRecording();
      setRecordFileUri(uri);
      setIsRecording(true);
    } catch (err) {
      console.error('startRecording error', err);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    try {
      const uri = await audioRecorderService.stopRecording();
      setRecordFileUri(uri || recordFileUri);
      setIsRecording(false);
    } catch (err) {
      console.error('stopRecording error', err);
    }
  };

  const cancelRecording = async () => {
    try {
      await audioRecorderService.cancelRecording();
    } catch {}
    setIsRecording(false);
    setRecordTimeMs(0);
    setRecordFileUri(null);
  };

  const sendVoiceNote = async () => {
    try {
      let uri = recordFileUri;
      if (isRecording) {
        uri = await audioRecorderService.stopRecording();
        setIsRecording(false);
      }
      if (!uri) return;
      const audioFile = {
        uri: uri.startsWith('file://') ? uri : `file://${uri}`,
        type: 'audio/m4a',
        name: `voice-note-${Date.now()}.m4a`,
      } as any;
      const uploadResponse = await apiService.uploadFile(
        {
          uri: audioFile.uri,
          type: audioFile.type,
          name: audioFile.name,
        } as any,
        'audio'
      );
      const uploaded: Array<{ url: string; type?: string; name?: string }> = [];
      if (Array.isArray((uploadResponse as any)?.files)) {
        ((uploadResponse as any).files as any[]).forEach((f: any) => {
          const url = f?.secure_url || f?.url || (f?.path ? String(f.path) : '');
          if (url) uploaded.push({ url, type: f?.type, name: f?.name });
        });
      } else if ((uploadResponse as any)?.url) {
        uploaded.push({ url: (uploadResponse as any).url, type: 'audio' });
      }
      if (uploaded.length === 0) {
        Alert.alert('Upload failed', 'Could not send voice note.');
        return;
      }
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      const name = current?.name || `${current?.firstName || ''} ${current?.surname || ''}`.trim() || username;
      const formData = new FormData();
      if (username) {
        formData.append('sender', JSON.stringify({ username, name, avatar: (apiService as any)['normalizeAvatar']?.(current?.avatar) || current?.avatar }));
      }
      formData.append('time', new Date().toISOString());
      if (replyTo) formData.append('replyTo', replyTo);
      formData.append('media', JSON.stringify(uploaded));
      const resp = await (apiService as any).makeRequest(`/communities/${encodeURIComponent(communityId)}/messages`, {
        method: 'POST',
        body: formData,
      });
      const saved = (resp as any)?.message || resp;
      const normalized = normalizeMessage(saved);
      setMessages(prev => [...prev, normalized]);
      setReplyTo(null);
      scrollToEnd();
    } catch (e) {
      console.error('sendVoiceNote error:', e);
      Alert.alert('Upload failed', 'Could not send voice note.');
    } finally {
      setRecordTimeMs(0);
      setRecordFileUri(null);
      setEmojiVisible(false);
      Keyboard.dismiss();
    }
  };

  const sendMediaWithCaption = async (fileUris: string[], caption?: string) => {
    try {
      if (!currentUser?.username) return;
      // Step 1: Upload each file to get persistent URLs (server expects media array, not raw files)
      const uploaded: Array<{ url: string; type?: string; name?: string }> = [];
      for (let idx = 0; idx < fileUris.length; idx++) {
        const uri = fileUris[idx];
        const guessedExt = uri?.toLowerCase().match(/\.(mp4|mov|webm|jpg|jpeg|png|webp|mp3|wav|m4a|aac|pdf|docx|pptx|xlsx|txt)$/)?.[1] || 'bin';
        const mimeMap: any = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
          mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
          mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
          pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', bin: 'application/octet-stream'
        };
        const type = mimeMap[guessedExt] || 'application/octet-stream';
        const kind: 'image' | 'video' | 'audio' | 'document' =
          type.startsWith('image/') ? 'image' :
          type.startsWith('video/') ? 'video' :
          type.startsWith('audio/') ? 'audio' : 'document';

        const name = `file_${idx}.${guessedExt}`;
        const res = await apiService.uploadFile({ uri, name, type }, kind);
        if (Array.isArray((res as any)?.files)) {
          ((res as any).files as any[]).forEach((f: any) => {
            const url = f?.secure_url || f?.url || (f?.path ? String(f.path) : '')
            if (url) uploaded.push({ url, type: f?.type, name: f?.name });
          });
        } else if ((res as any)?.url) {
          uploaded.push({ url: (res as any).url, type: kind });
        }
      }

      if (uploaded.length === 0) {
        Alert.alert('Upload failed', 'Could not send media.');
        return;
      }

      // Step 2: Send a community message with media array
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      const name = current?.name || `${current?.firstName || ''} ${current?.surname || ''}`.trim() || username;

      const formData = new FormData();
      if (username) {
        formData.append('sender', JSON.stringify({ username, name, avatar: (apiService as any)['normalizeAvatar']?.(current?.avatar) || current?.avatar }));
      }
      formData.append('time', new Date().toISOString());
      if (caption) formData.append('text', caption);
      if (replyTo) formData.append('replyTo', replyTo);
      formData.append('media', JSON.stringify(uploaded));

      const resp = await (apiService as any).makeRequest(`/communities/${encodeURIComponent(communityId)}/messages`, {
        method: 'POST',
        body: formData,
      });
      const saved = (resp as any)?.message || resp;
      const normalized = normalizeMessage(saved);
      setMessages(prev => [...prev, normalized]);
      setReplyTo(null);
      scrollToEnd();
    } catch (e) {
      console.error('sendMediaWithCaption error:', e);
      Alert.alert('Upload failed', 'Could not send media.');
    }
  };

  const handleAttachMedia = async () => {
    try {
      const res = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 5,
        quality: 0.7,
      });
      if (res.didCancel) return;
      const assets = res.assets || [];
      const uris = assets.map(a => a.uri).filter(Boolean) as string[];
      if (uris.length === 0) return;
      await sendMediaWithCaption(uris);
    } catch (e) {
      Alert.alert('Picker error', 'Failed to select media.');
    }
  };

  const handleAttachFiles = async () => {
    try {
      const picks = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        allowMultiSelection: true,
      });
      const uris = picks.map(p => p.uri).filter(Boolean);
      if (uris.length) await sendMediaWithCaption(uris);
    } catch (e: any) {
      if (DocumentPicker.isCancel(e)) return;
      Alert.alert('Picker error', 'Failed to select files/audio.');
    }
  };

  const handleClearMyMessages = async () => {
    try {
      const username = currentUser?.username;
      if (!username) {
        Alert.alert('Unavailable', 'Could not determine your user.');
        return;
      }
      await (apiService as any).makeRequest(`/communities/${encodeURIComponent(communityId)}/clear`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      setMessages([]);
      Alert.alert('Cleared', 'Your view of this chat was cleared.');
    } catch (e: any) {
      const msg = e?.message || 'Failed to clear messages.';
      Alert.alert('Error', msg);
    } finally {
      setMenuVisible(false);
    }
  };

  const renderItem = ({ item }: { item: CommunityMessage }) => {
    const isMine = (currentUser?.username && (item.sender as any)?.username === currentUser.username) || false;
    const avatar = (item.sender as any)?.avatar;
    return (
      <TouchableOpacity
        activeOpacity={0.95}
        onLongPress={() => { setActionTarget(item); setActionsVisible(true); }}
        style={[styles.msg, isMine ? styles.msgMine : styles.msgTheirs]}
      >
        <View style={styles.msgHeader}>
          {!isMine ? (
            <View style={styles.senderRow}>
              {avatar ? <Image source={{ uri: avatar }} style={styles.senderAvatar} /> : 
                <View style={[styles.senderAvatar, styles.senderAvatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{((item.sender as any)?.name || (item.sender as any)?.username || '?')[0]}</Text>
                </View>
              }
              <Text style={styles.senderName}>{(item.sender as any)?.name || (item.sender as any)?.username}</Text>
            </View>
          ) : (
            <Text style={styles.senderName}>You</Text>
          )}
          <Text style={styles.msgTime}>{new Date(item.time).toLocaleTimeString()}</Text>
        </View>
        {item.text ? <Text style={styles.msgText}>{item.text}</Text> : null}
        {Array.isArray(item.media) && item.media.length > 0 ? (
          <FlatList
            data={item.media}
            horizontal
            keyExtractor={(m, idx) => `${item._id}-m-${idx}`}
            renderItem={({ item: media }) => (
              <TouchableOpacity onPress={() => Linking.openURL(media.url)}>
                <Image source={{ uri: media.thumbnailUrl || media.url }} style={styles.mediaThumb} />
              </TouchableOpacity>
            )}
            style={{ marginTop: 6 }}
            showsHorizontalScrollIndicator={false}
          />
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView style={globalStyles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTopRow}>
            {community?.avatar ? (
              <TouchableOpacity onPress={() => setAvatarPreviewVisible(true)}>
                <Image source={{ uri: community.avatar }} style={styles.communityAvatar} />
                <View style={styles.avatarBadge} />
              </TouchableOpacity>
            ) : (
              <View style={[styles.communityAvatar, styles.communityAvatarPlaceholder]}>
                <Icon name="group" size={20} color={colors.primary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{communityName ? `# ${communityName}` : 'Community Chat'}</Text>
              {!!community?.purpose || !!community?.description ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {(community?.purpose || community?.description || '').toString()}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.headerStatsRow}>
            <View style={styles.statsChip}>
              <Icon name="people" size={14} color={colors.primary} style={styles.statsIcon} />
              <Text style={styles.headerStatsText}>{members.length}</Text>
            </View>
            <View style={styles.statsChip}>
              <Icon name="star" size={14} color={colors.primary} style={styles.statsIcon} />
              <Text style={styles.headerStatsText}>{members.filter(m => m.isAdmin || m.isCreator).length}</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.actionBtn}>
            <Icon name="more-vert" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const paddingToBottom = 24; // threshold
          const isBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - paddingToBottom;
          atBottomRef.current = isBottom;
          setAtBottom(isBottom);
        }}
      />

      {!!replyTo && (
        <View style={styles.replyPill}>
          <Text style={styles.replyPillText}>Replying to message</Text>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Icon name="close" size={16} color={'#fff'} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttachMedia}>
          <Icon name="attach-file" size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.emojiBtn} onPress={() => setEmojiVisible(v => !v)}>
          <Icon name="insert-emoticon" size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.emojiBtn} onPress={isRecording ? stopRecording : startRecording}>
          <Icon name={isRecording ? 'stop-circle' : 'mic'} size={22} color={colors.text} />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          placeholderTextColor={colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendText}>
          <Icon name="send" size={20} color={'#fff'} />
        </TouchableOpacity>
      </View>

      {isRecording && (
        <View style={styles.recordBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <RecordingWaveform active width={140} height={24} color={colors.primary} />
            <Text style={[styles.recordText, { marginLeft: 10 }]}>Recording {formatRecordTime(recordTimeMs)}</Text>
          </View>
          <View style={styles.recordActions}>
            <TouchableOpacity style={styles.recordSend} onPress={sendVoiceNote}>
              <Icon name="send" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.recordCancel} onPress={cancelRecording}>
              <Icon name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {emojiVisible && (
        <View style={styles.emojiTray}>
          {emojis.map((e) => (
            <TouchableOpacity key={e} style={styles.emojiItem} onPress={() => handleEmojiSelect(e)}>
              <Text style={styles.emojiText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Members & Admin management modal */}
      <Modal visible={showMembersModal} transparent animationType="slide" onRequestClose={() => setShowMembersModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Members</Text>
              <TouchableOpacity onPress={() => setShowMembersModal(false)}>
                <Icon name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={members}
              keyExtractor={(m) => m.username}
              renderItem={({ item: m }) => (
                <View style={styles.memberRow}>
                  {m.avatar ? (
                    <Image source={{ uri: m.avatar }} style={styles.memberAvatar} />
                  ) : (
                    <View style={[styles.memberAvatar, styles.communityAvatarPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{m.name || m.username}</Text>
                    <Text style={styles.memberRole}>
                      {m.isCreator ? 'Creator' : m.isAdmin ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                  {!m.isCreator && (
                    <TouchableOpacity
                      style={[styles.promoteBtn, m.isAdmin ? styles.demoteBtn : styles.promoteBtn]}
                      onPress={() => handleToggleAdmin(m)}
                    >
                      <Text style={styles.promoteBtnText}>{m.isAdmin ? 'Remove admin' : 'Make admin'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.shareInviteBtn} onPress={() => handleShareInvite()}>
                <Icon name="person-add" size={18} color={'#fff'} />
                <Text style={styles.shareInviteText}>Share invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Header options menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.menuBackdrop}>
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); handleVoiceGroupCall(); }}>
              <Icon name="call" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Voice call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); handleVideoGroupCall(); }}>
              <Icon name="videocam" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Video call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); handleShareInvite(); }}>
              <Icon name="share" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Share invite</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setShowMembersModal(true); }}>
              <Icon name="group" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Members</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleClearMyMessages}>
              <Icon name="delete-sweep" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Clear my messages</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Avatar full preview */}
      <Modal visible={avatarPreviewVisible} transparent animationType="fade" onRequestClose={() => setAvatarPreviewVisible(false)}>
        <View style={styles.avatarBackdrop}>
          <TouchableOpacity style={styles.avatarBackdrop} onPress={() => setAvatarPreviewVisible(false)}>
            {community?.avatar ? (
              <Image source={{ uri: community.avatar }} style={styles.avatarPreviewImage} />
            ) : null}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Message actions modal */}
      <Modal visible={actionsVisible} transparent animationType="fade" onRequestClose={() => setActionsVisible(false)}>
        <View style={styles.menuBackdrop}>
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setActionsVisible(false);
                if (actionTarget?._id) setReplyTo(actionTarget._id);
              }}
            >
              <Icon name="reply" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Reply</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setActionsVisible(false);
                setEditText(actionTarget?.text || '');
                setEditModalVisible(true);
              }}
            >
              <Icon name="edit" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setActionsVisible(false);
                try {
                  if (!actionTarget?._id) return;
                  await (apiService as any).deleteCommunityMessageForMe(communityId, actionTarget._id, currentUser?.username);
                  setMessages(prev => prev.filter(m => m._id !== actionTarget._id));
                } catch (e) {
                  Alert.alert('Failed', 'Could not delete message for you.');
                }
              }}
            >
              <Icon name="delete" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Delete for me</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setActionsVisible(false);
                try {
                  if (!actionTarget?._id) return;
                  await (apiService as any).deleteCommunityMessageForEveryone(communityId, actionTarget._id);
                  setMessages(prev => prev.filter(m => m._id !== actionTarget._id));
                } catch (e) {
                  Alert.alert('Failed', 'Could not delete for everyone.');
                }
              }}
            >
              <Icon name="delete-forever" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Delete for everyone</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit message modal */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Message</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Icon name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
              <TextInput
                style={styles.input}
                value={editText}
                onChangeText={setEditText}
                multiline
                placeholder="Update your message"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.shareInviteBtn} onPress={async () => {
                try {
                  if (!actionTarget?._id) return;
                  await (apiService as any).editCommunityMessage(communityId, actionTarget._id, editText);
                  setMessages(prev => prev.map(m => m._id === actionTarget._id ? { ...m, text: editText } : m));
                  setEditModalVisible(false);
                } catch (e) {
                  Alert.alert('Failed', 'Could not edit message.');
                }
              }}>
                <Icon name="save" size={18} color={'#fff'} />
                <Text style={styles.shareInviteText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  headerBar: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: colors.cardBackground,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
  headerCenter: {
    flex: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  communityAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: colors.cardBackground,
  },
  communityAvatarPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  headerStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  statsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 8,
  },
  statsIcon: {
    marginRight: 4,
  },
  headerStatsText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  headerDot: {
    marginHorizontal: 6,
    color: colors.textMuted,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    padding: 6,
    borderRadius: 16,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  menuCard: {
    marginTop: 50,
    marginRight: 8,
    backgroundColor: '#1f1f1f',
    borderRadius: 10,
    minWidth: 160,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  menuItemText: {
    color: colors.text,
    fontSize: 14,
  },
  listContent: {
    padding: 10,
  },
  msg: {
    marginVertical: 4,
    maxWidth: '85%',
    borderRadius: 16,
    padding: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  msgMine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary + '30',
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: colors.primary + '50',
  },
  msgTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  msgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  senderAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 6,
  },
  senderAvatarPlaceholder: {
    backgroundColor: colors.primary + '50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  senderName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  msgTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  msgText: {
    marginTop: 6,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  mediaThumb: {
    width: 100,
    height: 80,
    borderRadius: 6,
    marginRight: 6,
    backgroundColor: '#111',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  input: {
    flex: 1,
    backgroundColor: '#1f1f1f',
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
    backgroundColor: '#1f1f1f',
  },
  recordText: {
    color: colors.text,
    fontSize: 14,
  },
  recordActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordSend: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  recordCancel: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 20,
    backgroundColor: '#333',
  },
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1f1f1f',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '70%',
    paddingBottom: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  modalTitle: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  memberAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 10,
    backgroundColor: '#111',
  },
  memberName: {
    color: colors.text,
    fontSize: 14,
  },
  memberRole: {
    color: colors.textMuted,
    fontSize: 12,
  },
  promoteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  demoteBtn: {
    backgroundColor: '#7b1fa2',
  },
  promoteBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#333',
  },
  modalFooter: {
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  shareInviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: 10,
  },
  shareInviteText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 6,
  },
  avatarBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarPreviewImage: {
    width: '85%',
    height: '85%',
    resizeMode: 'contain',
    borderRadius: 12,
    backgroundColor: '#000',
  },
});

export default CommunityChatScreen;