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
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
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
import RNFS from 'react-native-fs'
import { WebView } from 'react-native-webview'
import AudioRecorderPlayer from 'react-native-audio-recorder-player'
import { saveMediaToDevice } from '../utils/mediaSaver'
import PushNotificationService from '../services/pushNotifications'
import CommunityUnreadService from '../services/CommunityUnreadService'
import NotificationPlugin from '../plugins/notification'
import SoundService from '../services/SoundService'

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
  replyToId?: string;
}

const CommunityChatScreen: React.FC = () => {
  const route = useRoute<RouteProp<RouteParams, 'params'>>();
  const navigation = useNavigation();
  const { communityId, communityName } = route.params;

// Focus-based unread handling: set active, clear on enter, reset on leave
useFocusEffect(
  React.useCallback(() => {
    try {
      CommunityUnreadService.setActiveCommunity(String(communityId));
      CommunityUnreadService.clear(String(communityId));
    } catch (_) {}
    return () => {
      try { CommunityUnreadService.setActiveCommunity(null); } catch (_) {}
    };
  }, [communityId])
);
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
  const [editCommunityModalVisible, setEditCommunityModalVisible] = useState(false);
  const [editCommunityName, setEditCommunityName] = useState('');
  const [editCommunityDescription, setEditCommunityDescription] = useState('');
  const [editCommunityImage, setEditCommunityImage] = useState<string | null>(null);
  const [isSavingCommunityEdit, setIsSavingCommunityEdit] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [atTop, setAtTop] = useState(true);
  const [showScrollControls, setShowScrollControls] = useState(false);
  const scrollControlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const currentUserRef = useRef<{ username: string; name?: string; avatar?: string } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const itemPositions = useRef<Record<string, number>>({});
const [refreshing, setRefreshing] = useState(false);
const logoSpin = useRef(new Animated.Value(0)).current;
const spinLoopRef = useRef<Animated.CompositeAnimation | null>(null);
const spin = logoSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
const logoSource = require('../../public/logo.png');
const onRefresh = async () => {
  setRefreshing(true);
  try {
    spinLoopRef.current = Animated.loop(
      Animated.timing(logoSpin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    spinLoopRef.current.start();
  } catch {}
  try {
    await Promise.all([loadCommunityData(), loadMessages()]);
  } catch (e) {
  } finally {
    try { spinLoopRef.current?.stop(); } catch {}
    logoSpin.setValue(0);
    setRefreshing(false);
  }
};
// Emoji reaction state
const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);
const [messageReactions, setMessageReactions] = useState<Record<string, string[]>>({});
const reactionEmojis = ['😀','😂','😍','👍','🙏','🎉','😢','🤔','🔥','🎯','👏','🙌','🥳','😮','😡','👀','💯','🤝','🫶','💡','❓','✅','❌','🍀','🌟','🚀','📌','💬','🔁','🍕','☕','🌈','🐶','🐱'];
const openReactionTray = (id: string) => setReactionTargetId(id);
const closeReactionTray = () => setReactionTargetId(null);
const removeReaction = (id: string, emoji: string) => {
  setMessageReactions(prev => {
    const list = prev[id] || [];
    const next = list.filter(e => e !== emoji);
    const { [id]: _drop, ...rest } = prev;
    return next.length ? { ...rest, [id]: next } : rest;
  });
};
const playReactionPop = async () => {
  try { await SoundService.playPop('react'); } catch (_e) {}
};
const pickReaction = (id: string, emoji: string) => {
  setMessageReactions(prev => {
    const list = prev[id] || [];
    const exists = list.includes(emoji);
    const next = exists ? list.filter(e => e !== emoji) : [...list, emoji];
    if (!exists) { try { playReactionPop(); } catch {} }
    return { ...prev, [id]: next };
  });
  setReactionTargetId(null);

  // Send push notification to message author (if not self)
  try {
    const targetMsg = messages.find(m => m._id === id);
    const sender = targetMsg?.sender;
    const authorUsername = typeof sender === 'string' ? sender : (sender as any)?.username;
    const me = currentUser;
    if (authorUsername && me?.username && authorUsername !== me.username) {
      const payload = {
        toUsername: String(authorUsername),
        title: String(me.name || me.username),
        body: `reacted to your message on "${communityName || 'a community'}".`,
        type: 'community_reaction',
        data: {
          communityId: String(communityId),
          communityName: String(communityName || ''),
          peerUsername: String(me.username),
          peerName: String(me.name || me.username),
          peerAvatar: String(me.avatar || ''),
          reactorName: String(me.name || me.username),
          senderName: String(me.name || me.username),
        },
      };
      (async () => {
        try {
          const token = await (apiService as any)['getAuthToken']?.();
          await fetch('https://connecther.network/api/notifications/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(payload),
          });
        } catch (_e) {}
      })();
    }
  } catch (_e) {}
};
  // Media preview & download state
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: 'image' | 'video' | 'audio' | 'document' | 'file'; filename: string } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  // Derived privileges & lock state
  const meUsername = currentUser?.username;
  const meIsAdminOrCreator = !!members.find(m => m.username === meUsername && (m.isAdmin || m.isCreator));
  const isGroupLocked = !!(community?.isLocked || community?.locked || (community?.status === 'locked'));

  useEffect(() => {
    if (editModalVisible && actionTarget) {
      setEditText(actionTarget.text || '');
    }
  }, [editModalVisible, actionTarget]);

  useEffect(() => {
    if (editCommunityModalVisible && community) {
      setEditCommunityName(community.name || '');
      setEditCommunityDescription(community.description || '');
      setEditCommunityImage(community.avatar || null);
    }
  }, [editCommunityModalVisible, community]);

  // Voice note state
  const [isRecording, setIsRecording] = useState(false);
  const [recordTimeMs, setRecordTimeMs] = useState(0);
  const [recordFileUri, setRecordFileUri] = useState<string | null>(null);
  const audioPlayerRef = useRef<AudioRecorderPlayer | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playPosition, setPlayPosition] = useState<number>(0);
  const [playDuration, setPlayDuration] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const emojis: string[] = ['😀','😂','😍','👍','🙏','🎉','😎','❤️','🔥','🥳','😢','🤔','👏','💯','💖','🥰','😘','💥','✨'];
  const handleEmojiSelect = (emoji: string) => {
    setInputText(prev => prev + emoji);
  };

  // Helpers: media preview & download
  const getFilenameFromUrl = (url: string) => {
    try {
      const u = new URL(url);
      const pathname = u.pathname || '';
      const name = pathname.split('/').pop() || `file_${Date.now()}`;
      return decodeURIComponent(name);
    } catch (_) {
      const parts = url.split('?')[0].split('/');
      return parts[parts.length - 1] || `file_${Date.now()}`;
    }
  };

  const guessMediaType = (m: { url: string; type?: string }): 'image' | 'video' | 'audio' | 'document' | 'file' => {
    const t = (m.type || '').toLowerCase();
    if (t.startsWith('image')) return 'image';
    if (t.startsWith('video')) return 'video';
    if (t.startsWith('audio')) return 'audio';
    if (t === 'application/pdf') return 'document';
    if (
      t.startsWith('application/vnd.openxmlformats') ||
      t === 'application/msword' ||
      t === 'application/vnd.ms-excel' ||
      t === 'application/vnd.ms-powerpoint' ||
      t.startsWith('text/')
    ) return 'document';
    const ext = m.url.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif|mp4|mov|webm|mkv|mp3|m4a|aac|wav|ogg|pdf|doc|docx|ppt|pptx|xls|xlsx|txt)$/)?.[1];
    if (ext && ['jpg','jpeg','png','webp','gif'].includes(ext)) return 'image';
    if (ext && ['mp4','mov','webm','mkv'].includes(ext)) return 'video';
    if (ext && ['mp3','m4a','aac','wav','ogg'].includes(ext)) return 'audio';
    if (ext && ['pdf','doc','docx','ppt','pptx','xls','xlsx','txt'].includes(ext)) return 'document';
    return 'document';
  };

  const openMediaPreview = (media: { url: string; type?: string }) => {
    const type = guessMediaType(media);
    const filename = getFilenameFromUrl(media.url);
    setPreviewMedia({ url: media.url, type, filename });
  };

  const ensureStoragePermission = async () => {
    try {
      const res = await PermissionsManager.requestStoragePermission();
      return !!res?.granted;
    } catch (_) {
      return true; // best-effort
    }
  };

  const mimeFromExt = (ext: string) => {
    const map: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
      pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain'
    };
    return map[ext] || 'application/octet-stream';
  };

  const downloadMedia = async (media: { url: string; type?: string }) => {
    const allowed = Platform.OS === 'android' ? await ensureStoragePermission() : true;
    if (!allowed) {
      Alert.alert('Permission required', 'Storage permission is needed to save media.');
      return;
    }

    const type = guessMediaType(media);
    const filename = getFilenameFromUrl(media.url);
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const token = await (apiService as any)['getAuthToken']?.();
      const needsAuth = (() => {
        try {
          const target = new URL(media.url);
          const apiOrigin = new URL((apiService as any).baseUrl || 'https://connecther.network/api').origin;
          const rootOrigin = new URL((apiService as any).rootUrl || 'https://connecther.network').origin;
          const sameHost = (target.origin === apiOrigin || target.origin === rootOrigin);
          return sameHost && target.pathname.startsWith('/api');
        } catch {
          return false;
        }
      })();
      const res = await saveMediaToDevice({
        url: media.url,
        type,
        filename,
        headers: needsAuth && token ? { Authorization: `Bearer ${token}` } : undefined,
        onProgress: (p) => setDownloadProgress(Math.max(0, Math.min(100, p)))
      });

      if (res.success) {
        if (Platform.OS === 'android' && res.path) {
          Alert.alert('Saved', `Saved to ${res.path}`);
        } else if (Platform.OS === 'ios' && res.openedShareSheet) {
          // Share sheet handles user save action on iOS
        } else if (res.path) {
          Alert.alert('Saved', `Downloaded to ${res.path}`);
        }
      } else {
        Alert.alert('Download failed', res.message || 'Unable to save file');
      }
    } catch (e: any) {
      Alert.alert('Download error', e?.message || 'Could not save file.');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  useEffect(() => {
    const title =
      editCommunityModalVisible
        ? (editCommunityName?.trim()
            ? `# ${editCommunityName}`
            : (community?.name
                ? `# ${community?.name}`
                : communityName
                  ? `# ${communityName}`
                  : 'Community Chat'))
        : (community?.name
            ? `# ${community?.name}`
            : communityName
              ? `# ${communityName}`
              : 'Community Chat');
    navigation.setOptions({
      headerTitle: title,
      headerTitleStyle: editCommunityModalVisible ? { color: '#FF1493' } : { color: colors.text },
    });
  }, [community?.name, communityName, editCommunityModalVisible, editCommunityName, navigation]);

  // Auto-close header menu after 3 seconds if unused
  useEffect(() => {
    if (menuVisible) {
      const t = setTimeout(() => setMenuVisible(false), 3000);
      return () => clearTimeout(t);
    }
  }, [menuVisible]);

  // Keep a ref to currentUser to avoid stale closures in socket handlers
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

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

      const normalized = normalizeMessage(msg);
      const senderUsername = typeof normalized.sender === 'string' ? normalized.sender : normalized.sender?.username;
      const cu = currentUserRef.current;
      const isFromMe = !!(cu?.username && senderUsername && String(senderUsername) === String(cu.username));

      setMessages(prev => {
        const exists = prev.some(m => m._id === msg?._id);
        if (exists) return prev;
        return [...prev, normalized];
      });

      if (!isFromMe) {
        const title = communityName ? `# ${communityName}` : 'Community Message';
        const body = normalized.text?.length ? normalized.text : (normalized.media?.length ? 'New attachment' : 'New message');
        try {
          PushNotificationService.getInstance().showLocalNotification({
            title,
            body,
            channelId: 'connecther_messages',
            vibrate: true,
            priority: 'max',
            importance: 'max',
            playSound: true,
            data: { type: 'community_message', communityId: String(communityId) },
          });
          try { NotificationPlugin.wakeUpScreen(); } catch (_) {}
        } catch (_) {}
      }

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

  // Edit community helpers
  const openEditCommunity = () => {
    setEditCommunityName(community?.name || '');
    setEditCommunityDescription(community?.description || '');
    setEditCommunityImage(community?.avatar || null);
    setEditCommunityModalVisible(true);
  };

  const handleSelectCommunityImage = () => {
    launchImageLibrary(
      {
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 800,
        maxHeight: 800,
      },
      (response) => {
        try {
          if (response?.assets && response.assets[0]) {
            setEditCommunityImage(response.assets[0].uri || null);
          }
        } catch (_) {}
      }
    );
  };

  const handleSaveCommunityEdit = async () => {
    if (!meIsAdminOrCreator) {
      Alert.alert('Forbidden', 'Only admins or the creator can edit this community.');
      return;
    }
    const name = (editCommunityName || '').trim();
    const description = (editCommunityDescription || '').trim();
    if (!name) {
      Alert.alert('Invalid', 'Name is required');
      return;
    }
    setIsSavingCommunityEdit(true);
    try {
      let avatarUrl: string | undefined = undefined;
      if (editCommunityImage) {
        const isRemote = /^https?:\/\//i.test(editCommunityImage);
        if (isRemote) {
          avatarUrl = editCommunityImage;
        } else {
          try {
            const uploadRes = await apiService.uploadImage(editCommunityImage);
            avatarUrl = (uploadRes as any)?.url || undefined;
          } catch (e) {
            console.warn('Avatar upload failed; continuing without avatar', e);
          }
        }
      }
      const res = await apiService.editCommunity(communityId, {
        name,
        description,
        avatar: avatarUrl,
      });
      if ((res as any)?.success) {
        await loadCommunityData();
        setEditCommunityModalVisible(false);
        Alert.alert('Updated', 'Community details saved');
      } else {
        Alert.alert('Failed', (res as any)?.message || 'Unable to update community');
      }
    } catch (e: any) {
      console.error('Edit community error:', e);
      Alert.alert('Error', e?.response?.data?.message || 'Failed to update community');
    } finally {
      setIsSavingCommunityEdit(false);
    }
  };

  const scrollToEnd = () => {
    try {
      flatListRef.current?.scrollToEnd({ animated: true });
    } catch (_) {}
  };

  const scrollToTop = () => {
    try {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (_) {}
  };

  const scrollToMessageId = (id?: string) => {
    if (!id) return;
    const idx = messages.findIndex(m => m._id === id);
    if (idx >= 0 && flatListRef.current) {
      try {
        flatListRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 });
      } catch (_e) {
        const y = itemPositions.current[id];
        if (typeof y === 'number') {
          try {
            flatListRef.current.scrollToOffset({ offset: Math.max(0, y - 60), animated: true });
          } catch (_) {}
        }
      }
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1600);
      return;
    }
    const y = itemPositions.current[id];
    if (typeof y === 'number' && flatListRef.current) {
      try {
        flatListRef.current.scrollToOffset({ offset: Math.max(0, y - 60), animated: true });
      } catch (_) {}
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1600);
    }
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
      replyToId: m?.replyToId || m?.replyTo || (m?.reply?.replyToId || m?.reply?.replyTo) || undefined,
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
    if (isGroupLocked && !meIsAdminOrCreator) {
      Alert.alert('Group locked', 'Only admins can send messages right now.');
      return;
    }
    setInputText('');
    const nowIso = new Date().toISOString();
    let optimisticId: string | null = null;
    try {
      const sender = currentUser ? { username: currentUser.username, name: currentUser.name, avatar: (apiService as any)['normalizeAvatar']?.(currentUser.avatar) || currentUser.avatar } : undefined;
      const optimistic = normalizeMessage({ sender, text, time: nowIso, media: [] });
      optimisticId = optimistic._id;
      setMessages(prev => {
        const next = [...prev, optimistic];
        const seen = new Set<string>();
        const dedup: CommunityMessage[] = [];
        for (const m of next) {
          if (!seen.has(m._id)) { seen.add(m._id); dedup.push(m); }
        }
        return dedup;
      });
      // Emit socket event immediately for snappy UX
      if (currentUser?.username) {
        socketService.sendCommunityMessage({ room: communityId, from: currentUser.username, message: text, replyTo: replyTo || undefined });
      }
      setReplyTo(null);
      scrollToEnd();
      try { SoundService.playPop('send'); } catch (_) {}

      // Persist to API afterward
      const res = await apiService.sendCommunityTextMessage(communityId, text, replyTo || undefined);
      const saved = (res as any)?.message || res;
      const normalized = normalizeMessage(saved);
      setMessages(prev => {
        const filtered = optimisticId ? prev.filter(m => m._id !== optimisticId) : prev;
        const next = [...filtered, normalized];
        const seen = new Set<string>();
        const dedup: CommunityMessage[] = [];
        for (const m of next) {
          if (!seen.has(m._id)) { seen.add(m._id); dedup.push(m); }
        }
        return dedup;
      });
    } catch (e) {
      if (optimisticId) {
        setMessages(prev => prev.filter(m => m._id !== optimisticId!));
      }
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

  // Day divider helpers
  const isSameDay = (a: Date, b: Date) => {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  };

  const formatDayLabel = (d: Date) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (isSameDay(d, today)) return 'Today';
    if (isSameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
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

  useEffect(() => {
    const p = new AudioRecorderPlayer();
    audioPlayerRef.current = p;
    return () => {
      try { p.stopPlayer(); } catch (_) {}
      try { p.removePlayBackListener(); } catch (_) {}
      audioPlayerRef.current = null;
    };
  }, []);

  const toggleAudioPlayback = async (url: string, id: string) => {
    try {
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new AudioRecorderPlayer();
      }
      const player = audioPlayerRef.current!;
      if (playingId === id) {
        if (isPaused) {
          await player.resumePlayer();
          setIsPaused(false);
        } else {
          await player.pausePlayer();
          setIsPaused(true);
        }
        return;
      }
      try {
        await player.stopPlayer();
        player.removePlayBackListener();
      } catch (_) {}
      setPlayingId(id);
      setIsPaused(false);
      setPlayPosition(0);
      setPlayDuration(0);
      await player.startPlayer(url);
      player.addPlayBackListener((e: any) => {
        const pos = e?.currentPosition || 0;
        const dur = e?.duration || 0;
        setPlayPosition(pos);
        setPlayDuration(dur);
        if (pos >= dur && dur > 0) {
          setPlayingId(null);
          setIsPaused(false);
          try { player.stopPlayer(); } catch (_) {}
          try { player.removePlayBackListener(); } catch (_) {}
        }
      });
    } catch (err) {
      console.error('toggleAudioPlayback error', err);
      Alert.alert('Playback error', 'Could not play audio.');
    }
  };

  const sendVoiceNote = async () => {
    try {
      if (isGroupLocked && !meIsAdminOrCreator) {
        Alert.alert('Group locked', 'Only admins can send messages right now.');
        return;
      }
      let uri = recordFileUri;
      if (isRecording) {
        uri = await audioRecorderService.stopRecording();
        setIsRecording(false);
      }
      if (!uri) return;

      // Optimistic message with local audio URI
      const localUri = (uri.startsWith('file://') || uri.startsWith('content://')) ? uri : `file://${uri}`;
      const nowIso = new Date().toISOString();
      const sender = currentUser ? { username: currentUser.username, name: currentUser.name, avatar: (apiService as any)['normalizeAvatar']?.(currentUser.avatar) || currentUser.avatar } : undefined;
      const optimistic = normalizeMessage({ sender, text: '', time: nowIso, media: [{ url: localUri, type: 'audio' }] });
      const optimisticId = optimistic._id;
      setMessages(prev => {
        const next = [...prev, optimistic];
        const seen = new Set<string>();
        const dedup: CommunityMessage[] = [];
        for (const m of next) { if (!seen.has(m._id)) { seen.add(m._id); dedup.push(m); } }
        return dedup;
      });
      // Socket-first emit without files (for snappy UX)
      if (currentUser?.username) {
        socketService.sendCommunityMessage({ room: communityId, from: currentUser.username, message: '', replyTo: replyTo || undefined });
      }
      scrollToEnd();
      try { SoundService.playPop('send'); } catch (_) {}

      // Upload audio file to get persistent URL
      const audioFile = {
        uri: localUri,
        type: 'audio/m4a',
        name: `voice-note-${Date.now()}.m4a`,
      } as any;
      setUploadProgress(prev => ({ ...prev, [localUri]: 0 }));
      const uploadResponse = await apiService.uploadFile(
        { uri: audioFile.uri, type: audioFile.type, name: audioFile.name } as any,
        'audio',
        (p: number) => setUploadProgress(prev => ({ ...prev, [localUri]: Math.max(0, Math.min(100, Math.floor(p))) }))
      );
      setUploadProgress(prev => ({ ...prev, [localUri]: 100 }));
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
        setMessages(prev => prev.filter(m => m._id !== optimisticId));
        Alert.alert('Upload failed', 'Could not send voice note.');
        return;
      }

      // Persist community message with uploaded media URLs
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
      setMessages(prev => {
        const filtered = prev.filter(m => m._id !== optimisticId);
        const next = [...filtered, normalized];
        const seen = new Set<string>();
        const dedup: CommunityMessage[] = [];
        for (const m of next) { if (!seen.has(m._id)) { seen.add(m._id); dedup.push(m); } }
        return dedup;
      });
      setReplyTo(null);
      // Emit socket event with uploaded URLs
      const fromUser = username || currentUser?.username;
      if (fromUser) {
        socketService.sendCommunityMessage({ room: communityId, from: fromUser, message: normalized.text || '', files: uploaded, replyTo: replyTo || undefined });
      }
      // Trigger push notifications for media/audio message
      try {
        await apiService.triggerCommunityMessageNotifications(String(communityId), normalized.text || '', normalized._id, uploaded as any);
      } catch (notifyErr) {
        if (__DEV__) console.debug('triggerCommunityMessageNotifications (audio) failed:', notifyErr);
      }
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
      if (isGroupLocked && !meIsAdminOrCreator) {
        Alert.alert('Group locked', 'Only admins can send messages right now.');
        return;
      }
      if (!currentUser?.username) return;

      // Optimistic message first using local URIs
      const nowIso = new Date().toISOString();
      const sender = currentUser ? { username: currentUser.username, name: currentUser.name, avatar: (apiService as any)['normalizeAvatar']?.(currentUser.avatar) || currentUser.avatar } : undefined;
      const localMedia = fileUris.map((uri) => {
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
        const kind: 'image' | 'video' | 'audio' | 'document' = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'document';
        const localUrl = (uri.startsWith('file://') || uri.startsWith('content://')) ? uri : `file://${uri}`;
        return { url: localUrl, type: kind };
      });
      const optimistic = normalizeMessage({ sender, text: caption || '', time: nowIso, media: localMedia });
      const optimisticId = optimistic._id;
      setMessages(prev => {
        const next = [...prev, optimistic];
        const seen = new Set<string>();
        const dedup: CommunityMessage[] = [];
        for (const m of next) { if (!seen.has(m._id)) { seen.add(m._id); dedup.push(m); } }
        return dedup;
      });
      // Socket emit deferred until after upload to avoid duplicates
      scrollToEnd();
      try { SoundService.playPop('send'); } catch (_) {}

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
        const localUrl = (uri.startsWith('file://') || uri.startsWith('content://')) ? uri : `file://${uri}`;
        setUploadProgress(prev => ({ ...prev, [localUrl]: 0 }));
        const res = await apiService.uploadFile({ uri, name, type }, kind, (p: number) =>
          setUploadProgress(prev => ({ ...prev, [localUrl]: Math.max(0, Math.min(100, Math.floor(p))) }))
        );
        setUploadProgress(prev => ({ ...prev, [localUrl]: 100 }));
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
        // Remove optimistic message on failure
        setMessages(prev => prev.filter(m => m._id !== optimisticId));
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
      setMessages(prev => {
        const filtered = prev.filter(m => m._id !== optimisticId);
        const next = [...filtered, normalized];
        const seen = new Set<string>();
        const dedup: CommunityMessage[] = [];
        for (const m of next) {
          if (!seen.has(m._id)) { seen.add(m._id); dedup.push(m); }
        }
        return dedup;
      });
      setReplyTo(null);
      // Emit socket event to notify others in the community (with uploaded URLs)
      const fromUser2 = username || currentUser?.username;
      if (fromUser2) {
        socketService.sendCommunityMessage({ room: communityId, from: fromUser2, message: caption || normalized.text || '', files: uploaded, replyTo: replyTo || undefined });
      }
      // Trigger push notifications for media/audio message
      try {
        await apiService.triggerCommunityMessageNotifications(String(communityId), caption || normalized.text || '', normalized._id, uploaded as any);
      } catch (notifyErr) {
        if (__DEV__) console.debug('triggerCommunityMessageNotifications (media) failed:', notifyErr);
      }
      scrollToEnd();
    } catch (e) {
      console.error('sendMediaWithCaption error:', e);
      Alert.alert('Upload failed', 'Could not send media.');
    }
  };

  const handleAttachMedia = async () => {
    try {
      if (isGroupLocked && !meIsAdminOrCreator) {
        Alert.alert('Group locked', 'Only admins can attach media right now.');
        return;
      }
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
      if (isGroupLocked && !meIsAdminOrCreator) {
        Alert.alert('Group locked', 'Only admins can attach files right now.');
        return;
      }
      const picks = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        allowMultiSelection: true,
        copyTo: 'cachesDirectory',
      });
      const uris = picks
        .map(p => (p.fileCopyUri || p.uri))
        .filter((u): u is string => !!u);
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

  const handleLockGroup = async () => {
    try {
      if (!meIsAdminOrCreator) {
        Alert.alert('Not allowed', 'Only the creator or admins can lock the group.');
        return;
      }
      await (apiService as any).lockCommunity(communityId);
      await loadCommunityData();
      Alert.alert('Locked', 'The group is now locked.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not lock the group.');
    } finally {
      setMenuVisible(false);
    }
  };

  const handleUnlockGroup = async () => {
    try {
      if (!meIsAdminOrCreator) {
        Alert.alert('Not allowed', 'Only the creator or admins can unlock the group.');
        return;
      }
      await (apiService as any).unlockCommunity(communityId);
      await loadCommunityData();
      Alert.alert('Unlocked', 'The group is now unlocked.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not unlock the group.');
    } finally {
      setMenuVisible(false);
    }
  };

  const renderItem = ({ item, index }: { item: CommunityMessage; index: number }) => {
    const isMine = (currentUser?.username && (item.sender as any)?.username === currentUser.username) || false;
    const avatar = (item.sender as any)?.avatar;
    return (
      <>
        {(() => {
          const itemDate = new Date(item.time);
          const prev = index > 0 ? messages[index - 1] : null;
          const prevDate = prev ? new Date(prev.time) : null;
          const showDay = index === 0 || (prevDate && !isSameDay(itemDate, prevDate));
          if (!showDay) return null;
          return (
            <View style={styles.dayDivider}>
              <Text style={styles.dayDividerText}>{formatDayLabel(itemDate)}</Text>
            </View>
          );
        })()}
        <TouchableOpacity
          activeOpacity={0.95}
          onLongPress={() => openReactionTray(item._id)}
          onPress={() => { reactionTargetId ? closeReactionTray() : (setActionTarget(item), setActionsVisible(true)); }}
          onLayout={(e) => { itemPositions.current[item._id] = e.nativeEvent.layout.y; }}
          style={[styles.msg, isMine ? styles.msgMine : styles.msgTheirs, highlightedId === item._id ? styles.msgHighlighted : undefined]}
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
          {item.replyToId ? (() => {
            const parent = messages.find(m => m._id === item.replyToId);
            const parentSenderName =
              parent && typeof parent.sender !== 'string'
                ? (parent.sender.name || parent.sender.username)
                : (typeof parent?.sender === 'string' ? parent?.sender : undefined);
            return (
              <TouchableOpacity style={styles.replyPreview} onPress={() => scrollToMessageId(item.replyToId)}>
                {!!parentSenderName && <Text style={styles.replyPreviewTitle}>Reply to {parentSenderName}</Text>}
                {!!parent?.text && <Text style={styles.replyPreviewText} numberOfLines={2}>{parent!.text}</Text>}
              </TouchableOpacity>
            );
          })() : null}
          {item.text ? <Text style={styles.msgText}>{item.text}</Text> : null}
          {Array.isArray(item.media) && item.media.length > 0 ? (
            <View style={styles.mediaRow}>
              {item.media.map((media, index) => {
                const type = guessMediaType(media);
                const id = `${item._id}-m-${index}`;
                if (type === 'audio') {
                  const progressPercent = playDuration > 0 && playingId === id ? Math.min(100, Math.floor((playPosition / playDuration) * 100)) : 0;
                  const isPlayingThis = playingId === id && !isPaused;
                  const uploadPercent = uploadProgress[media.url] ?? 0;
                  return (
                    <View key={id} style={styles.mediaItem}>
                      <View style={styles.audioContainer}>
                        <TouchableOpacity style={[styles.audioPlayBtn, isPlayingThis ? { backgroundColor: '#4CAF50' } : null]} onPress={() => toggleAudioPlayback(media.url, id)}>
                          <Icon name={isPlayingThis ? 'pause' : 'play-arrow'} size={22} color={'#fff'} />
                        </TouchableOpacity>
                        <View style={styles.audioContent}>
                          {uploadPercent > 0 && uploadPercent < 100 ? (
                            <View style={styles.audioUploadBar}>
                              <View style={[styles.audioUploadProgress, { width: `${uploadPercent}%` }]} />
                            </View>
                          ) : null}
                          {isPlayingThis ? (
                            <View style={styles.audioWave}>
                              {[0,1,2,3,4,5,6,7].map(i => {
                                const height = 6 + 8 * Math.abs(Math.sin(((playingId === id ? playPosition : 0) / 150) + i));
                                return <View key={i} style={[styles.audioWaveBar, { height }]} />;
                              })}
                            </View>
                          ) : null}
                          <View style={styles.audioProgressBar}>
                            <View style={[styles.audioProgress, { width: `${progressPercent}%` }]} />
                          </View>
                          <Text style={styles.audioTime}>{formatRecordTime(playingId === id ? playPosition : 0)} / {formatRecordTime(playingId === id ? playDuration : 0)}</Text>
                        </View>
                        <View style={styles.audioActions}>
                          <TouchableOpacity style={styles.audioDownloadBtn} onPress={() => downloadMedia({ url: media.url, type: 'audio' })}>
                            <Icon name="file-download" size={18} color={'#fff'} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                }
                if (type === 'document') {
                  const fname = getFilenameFromUrl(media.url);
                  const percent = uploadProgress[media.url] ?? 0;
                  return (
                    <View key={id} style={styles.mediaItem}>
                      <View style={[styles.docTile, percent > 0 && percent < 100 ? { opacity: 0.7 } : undefined]}>
                        <View style={styles.docIcon}>
                          <Icon name="description" size={22} color={colors.primary} />
                        </View>
                        <View style={styles.docContent}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={styles.docName} numberOfLines={1}>{fname || 'Document'}</Text>
                            {percent > 0 && percent < 100 ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                          </View>
                          {percent > 0 && percent < 100 ? (
                            <View style={styles.docProgressBar}>
                              <View style={[styles.docProgress, { width: `${percent}%` }]} />
                            </View>
                          ) : null}
                        </View>
                        <TouchableOpacity style={styles.docDownloadBtn} onPress={() => downloadMedia({ url: media.url, type: 'document' })}>
                          <Icon name="file-download" size={18} color={'#fff'} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }
                return (
                  <View key={id} style={styles.mediaItem}>
                    <TouchableOpacity onPress={() => openMediaPreview(media)} style={styles.mediaThumbWrapper} activeOpacity={0.85}>
                      <Image source={{ uri: media.thumbnailUrl || media.url }} style={styles.mediaThumb} />
                      {uploadProgress[media.url] > 0 && uploadProgress[media.url] < 100 ? (
                        <View style={styles.mediaUploadOverlay}>
                          <View style={styles.mediaUploadProgressBar}>
                            <View style={[styles.mediaUploadProgress, { width: `${uploadProgress[media.url]}%` }]} />
                          </View>
                          <Text style={styles.mediaUploadText}>{uploadProgress[media.url]}%</Text>
                        </View>
                      ) : null}
                      <TouchableOpacity style={styles.mediaDownloadBtn} onPress={() => downloadMedia(media)}>
                        <Icon name="download" size={18} color={'#fff'} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : null}
          {Array.isArray(messageReactions[item._id]) && messageReactions[item._id].length ? (
            <View style={styles.reactionBadge}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {messageReactions[item._id].map(e => (
                  <TouchableOpacity key={e} style={styles.reactionBadgeEmoji} onPress={() => removeReaction(item._id, e)}>
                    <Text style={styles.reactionBadgeText}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}
          {reactionTargetId === item._id ? (
            <View pointerEvents="box-none" style={[styles.reactionTray, isMine ? styles.reactionTrayRight : styles.reactionTrayLeft]}>
              {reactionEmojis.map(e => (
                <TouchableOpacity key={e} style={styles.reactionItem} onPress={() => pickReaction(item._id, e)}>
                  <Text style={styles.reactionText}>{e}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.reactionMore} onPress={() => { closeReactionTray(); setActionTarget(item); setActionsVisible(true); }}>
                <Icon name="more-horiz" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
          ) : null}
        </TouchableOpacity>
      </>
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
          {meIsAdminOrCreator ? (
            <TouchableOpacity onPress={openEditCommunity} activeOpacity={0.7}>
              <Text style={[styles.headerTitle, editCommunityModalVisible ? { color: '#FF1493' } : null]}>
                {editCommunityModalVisible
                  ? (editCommunityName?.trim()
                      ? `# ${editCommunityName}`
                      : (community?.name
                          ? `# ${community?.name}`
                          : communityName
                            ? `# ${communityName}`
                            : 'Community Chat'))
                  : (community?.name
                      ? `# ${community?.name}`
                      : communityName
                        ? `# ${communityName}`
                        : 'Community Chat')}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.headerTitle, editCommunityModalVisible ? { color: '#FF1493' } : null]}>
              {editCommunityModalVisible
                ? (editCommunityName?.trim()
                    ? `# ${editCommunityName}`
                    : (community?.name
                        ? `# ${community?.name}`
                        : communityName
                          ? `# ${communityName}`
                          : 'Community Chat'))
                : (community?.name
                    ? `# ${community?.name}`
                    : communityName
                      ? `# ${communityName}`
                      : 'Community Chat')}
            </Text>
          )}
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
          <View style={styles.statsChip}>
            <Icon name={isGroupLocked ? 'lock' : 'lock-open'} size={14} color={colors.primary} style={styles.statsIcon} />
            <Text style={styles.headerStatsText}>{isGroupLocked ? 'Locked' : 'Unlocked'}</Text>
          </View>
        </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.actionBtn}>
            <Icon name="more-vert" size={22} color="#E9EDEF" />
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={["transparent"]}
            progressBackgroundColor="transparent"
          />
        }
        ListHeaderComponent={() =>
          refreshing ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Animated.Image source={logoSource} style={{ width: 28, height: 28, transform: [{ rotate: spin }] }} />
            </View>
          ) : null
        }
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const threshold = 24;
          const isBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - threshold;
          const isTop = contentOffset.y <= threshold;
          atBottomRef.current = isBottom;
          setAtBottom(isBottom);
          setAtTop(isTop);
          setShowScrollControls(true);
          if (scrollControlsTimeout.current) { try { clearTimeout(scrollControlsTimeout.current); } catch (_) {} }
          scrollControlsTimeout.current = setTimeout(() => { setShowScrollControls(false); }, 1500);
        }}
      />

      {showScrollControls && (
        <View style={{ position: 'absolute', right: 12, bottom: 86, alignItems: 'center' }}>
          {!atTop && (
            <TouchableOpacity onPress={scrollToTop} style={{ backgroundColor: '#0B2141', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 24, elevation: 2 }}>
              <Icon name="keyboard-arrow-up" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          {!atBottom && (
            <TouchableOpacity onPress={scrollToEnd} style={{ marginTop: 10, backgroundColor: '#0B2141', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 24, elevation: 2 }}>
              <Icon name="keyboard-arrow-down" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {!!replyTo && (
        <View style={styles.replyPill}>
          <Text style={styles.replyPillText}>Replying to message</Text>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Icon name="close" size={16} color={'#fff'} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttachMedia} disabled={isGroupLocked && !meIsAdminOrCreator}>
          <Icon name="attach-file" size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.emojiBtn} onPress={() => { if (isGroupLocked && !meIsAdminOrCreator) { Alert.alert('Group locked', 'Only admins can use emojis right now.'); return; } setEmojiVisible(v => !v); }}>
          <Icon name="insert-emoticon" size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.emojiBtn} onPress={() => { if (isGroupLocked && !meIsAdminOrCreator) { Alert.alert('Group locked', 'Only admins can record right now.'); return; } (isRecording ? stopRecording() : startRecording()); }}>
          <Icon name={isRecording ? 'stop-circle' : 'mic'} size={22} color={colors.text} />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder={isGroupLocked && !meIsAdminOrCreator ? 'Group is locked' : 'Type a message'}
          placeholderTextColor={colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          editable={!(isGroupLocked && !meIsAdminOrCreator)}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendText} disabled={isGroupLocked && !meIsAdminOrCreator}>
          <Icon name="send" size={20} color={'#E9EDEF'} />
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.emojiTray} contentContainerStyle={styles.emojiTrayContent}>
          {emojis.map((e) => (
            <TouchableOpacity key={e} style={styles.emojiItem} onPress={() => handleEmojiSelect(e)}>
              <Text style={styles.emojiText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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
            {meIsAdminOrCreator && (
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); openEditCommunity(); }}>
                <Icon name="edit" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Edit community</Text>
              </TouchableOpacity>
            )}
            {meIsAdminOrCreator && (
              isGroupLocked ? (
                <TouchableOpacity style={styles.menuItem} onPress={handleUnlockGroup}>
                  <Icon name="lock-open" size={18} color={colors.text} />
                  <Text style={styles.menuItemText}>Unlock group</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.menuItem} onPress={handleLockGroup}>
                  <Icon name="lock" size={18} color={colors.text} />
                  <Text style={styles.menuItemText}>Lock group</Text>
                </TouchableOpacity>
              )
            )}
            <TouchableOpacity style={styles.menuItem} onPress={handleClearMyMessages}>
              <Icon name="delete-sweep" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Clear my messages</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit community modal */}
      <Modal visible={editCommunityModalVisible} transparent animationType="slide" onRequestClose={() => setEditCommunityModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Community</Text>
              <TouchableOpacity onPress={() => setEditCommunityModalVisible(false)}>
                <Icon name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
              <TouchableOpacity onPress={handleSelectCommunityImage} style={{ alignSelf: 'center', marginBottom: 16 }}>
                {editCommunityImage ? (
                  <Image source={{ uri: editCommunityImage }} style={{ width: 100, height: 100, borderRadius: 50 }} />
                ) : (
                  <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="add-a-photo" size={24} color={colors.text} />
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>Add photo</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { color: '#FF1493' }]}
                value={editCommunityName}
                onChangeText={setEditCommunityName}
                placeholder="Community name"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={[styles.input, { marginTop: 10, color: '#FF1493', minHeight: 80, textAlignVertical: 'top' }]}
                value={editCommunityDescription}
                onChangeText={setEditCommunityDescription}
                placeholder="Description"
                placeholderTextColor={colors.textMuted}
                multiline
              />
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.shareInviteBtn} onPress={handleSaveCommunityEdit} disabled={isSavingCommunityEdit}>
                <Icon name="save" size={18} color={'#fff'} />
                <Text style={styles.shareInviteText}>{isSavingCommunityEdit ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
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

      {/* Media full preview */}
      <Modal visible={!!previewMedia} transparent animationType="fade" onRequestClose={() => setPreviewMedia(null)}>
        <View style={styles.avatarBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{previewMedia?.filename || 'Preview'}</Text>
              <TouchableOpacity onPress={() => setPreviewMedia(null)}>
                <Icon name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1, padding: 10 }}>
              {previewMedia?.type === 'image' && previewMedia?.url ? (
                <Image source={{ uri: previewMedia.url }} style={{ width: '100%', height: '80%', borderRadius: 8 }} resizeMode="contain" />
              ) : previewMedia?.type === 'video' && previewMedia?.url ? (
                <WebView source={{ html: `<html><body style=\"margin:0;background:#000\"><video src=\"${previewMedia.url}\" controls autoplay style=\"width:100%;height:100%\"></video></body></html>` }} style={{ flex: 1 }} />
              ) : previewMedia?.type === 'audio' && previewMedia?.url ? (
                <WebView source={{ html: `<html><body style=\"margin:0;background:#000\"><audio src=\"${previewMedia.url}\" controls autoplay style=\"width:100%\"></audio></body></html>` }} style={{ flex: 1 }} />
              ) : (
                <Text style={styles.modalTitle}>No preview available</Text>
              )}
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.shareInviteBtn} onPress={() => { if (previewMedia) downloadMedia({ url: previewMedia.url, type: previewMedia.type }); }}>
                <Icon name="download" size={18} color={'#fff'} />
                <Text style={styles.shareInviteText}>{isDownloading ? `Downloading ${downloadProgress}%` : 'Download'}</Text>
              </TouchableOpacity>
            </View>
          </View>
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
            {!!(currentUser?.username && ((typeof actionTarget?.sender === 'string' ? actionTarget?.sender : (actionTarget?.sender as any)?.username) === currentUser.username)) && (
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
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setActionsVisible(false);
                try {
                  const text = (actionTarget?.text || '').trim();
                  let payload = text;
                  if (!payload && Array.isArray(actionTarget?.media) && actionTarget.media.length) {
                    payload = actionTarget.media.map(m => m.url).join('\n');
                  }
                  const Clipboard = require('@react-native-clipboard/clipboard').default;
                  if (Clipboard && typeof Clipboard.setString === 'function') {
                    Clipboard.setString(payload || '');
                    Alert.alert('Copied', 'Content copied to clipboard');
                  } else {
                    Alert.alert('Clipboard unavailable', payload || 'Nothing to copy');
                  }
                } catch (e) {
                  Alert.alert('Clipboard error', 'Unable to copy content');
                }
              }}
            >
              <Icon name="content-copy" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setActionsVisible(false);
                try {
                  const parts: string[] = [];
                  if (actionTarget?.text) parts.push(actionTarget.text);
                  if (Array.isArray(actionTarget?.media) && actionTarget.media.length) {
                    parts.push('Media:');
                    parts.push(...actionTarget.media.map(m => m.url));
                  }
                  const msg = parts.join('\n');
                  await Share.share({ message: msg });
                } catch (_) {}
              }}
            >
              <Icon name="share" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Share</Text>
            </TouchableOpacity>
            {Array.isArray(actionTarget?.media) && actionTarget?.media?.length ? (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={async () => {
                  setActionsVisible(false);
                  try {
                    for (const m of actionTarget!.media!) {
                      await downloadMedia(m);
                    }
                  } catch (_) {}
                }}
              >
                <Icon name="download" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Download attachment{(actionTarget?.media?.length || 0) > 1 ? 's' : ''}</Text>
              </TouchableOpacity>
            ) : null}
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
                style={[styles.input, { color: '#FF1493', minHeight: 80, textAlignVertical: 'top' }]}
                value={editText}
                onChangeText={setEditText}
                multiline
                autoFocus
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
   msgHighlighted: {
     borderColor: colors.primary,
     borderWidth: 2,
   },
   replyPreview: {
     marginTop: 6,
     paddingHorizontal: 8,
     paddingVertical: 6,
     borderRadius: 10,
     backgroundColor: 'rgba(255,255,255,0.06)',
     borderLeftWidth: 3,
     borderLeftColor: colors.primary,
   },
   replyPreviewTitle: {
     fontSize: 11,
     color: colors.textMuted,
     marginBottom: 2,
   },
   replyPreviewText: {
     fontSize: 13,
     color: colors.text,
   },
   replyPreviewMediaRow: {
     flexDirection: 'row',
     marginTop: 4,
   },
   replyPreviewMediaThumb: {
     width: 20,
     height: 20,
     borderRadius: 4,
     backgroundColor: '#333',
     marginRight: 4,
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
  mediaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  mediaItem: {
    marginRight: 8,
    marginBottom: 6,
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 8,
    padding: 4,
    flexShrink: 1,
    maxWidth: 320,
  },
  audioPlayBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  audioContent: {
    flex: 1,
    minWidth: 120,
  },
  audioUploadBar: {
    height: 3,
    backgroundColor: '#555',
    borderRadius: 2,
    overflow: 'hidden',
    width: '100%',
    marginBottom: 4,
  },
  audioUploadProgress: {
    height: 3,
    backgroundColor: '#7bd88f',
  },
  audioProgressBar: {
    height: 3,
    backgroundColor: '#444',
    borderRadius: 2,
    overflow: 'hidden',
    width: '100%',
  },
  audioProgress: {
    height: 3,
    backgroundColor: colors.primary,
  },
  audioWave: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 16,
    gap: 3,
    marginVertical: 4,
  },
  audioWaveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  audioTime: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 10,
  },
  audioActions: {
    marginLeft: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  audioDownloadBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaThumbWrapper: {
    position: 'relative',
  },
  mediaDownloadBtn: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaUploadOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  mediaUploadProgressBar: {
    height: 4,
    width: '80%',
    backgroundColor: '#666',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  mediaUploadProgress: {
    height: 4,
    backgroundColor: colors.primary,
  },
  mediaUploadText: {
    color: '#fff',
    fontSize: 12,
  },

  // New day divider styles
  dayDivider: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f1f1f3',
    marginVertical: 10,
  },
  dayDividerText: {
    fontSize: 12,
    color: '#666',
  },

  // New document tile styles
  docTile: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#f7f7fa',
    borderWidth: 1,
    borderColor: '#e6e6ef',
    marginTop: 8,
  },
  docIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#e9f2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  docContent: {
    flex: 1,
  },
  docName: {
    fontSize: 14,
    color: '#333',
  },
  docProgressBar: {
    height: 4,
    backgroundColor: '#e5e5e5',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
  },
  docProgress: {
    height: 4,
    backgroundColor: colors.primary,
  },
  docDownloadBtn: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },

  emojiTray: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
    backgroundColor: '#1f1f1f',
    maxHeight: 60,
  },
  emojiTrayContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  emojiItem: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: 8,
  },
  emojiText: {
    fontSize: 20,
    color: colors.text,
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
  // Emoji reaction styles
  reactionTray: {
    position: 'absolute',
    top: -44,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 12,
    zIndex: 1000,
  },
  reactionTrayLeft: { left: 8 },
  reactionTrayRight: { right: 8 },
  reactionItem: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginHorizontal: 2,
    marginVertical: 2,
    borderRadius: 12,
    backgroundColor: colors.secondary,
  },
  reactionText: {
    fontSize: 16,
  },
  reactionMore: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginLeft: 4,
    borderRadius: 12,
    backgroundColor: colors.secondary,
  },
  reactionBadge: {
    position: 'absolute',
    right: 10,
    bottom: -8,
    backgroundColor: '#2A3942',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#26353B',
    zIndex: 1000,
    elevation: 12,
  },
  reactionBadgeText: {
    fontSize: 14,
  },
  reactionBadgeEmoji: {
    marginHorizontal: 2,
  },
});

export default CommunityChatScreen;