import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Pressable,
  Vibration,
  Share,
  Keyboard,
  BackHandler,
  DeviceEventEmitter,
  Modal,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import Video from 'react-native-video';
import {useRoute, useNavigation, useIsFocused, RouteProp} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import FAIcon from 'react-native-vector-icons/FontAwesome5';
import {launchImageLibrary, launchCamera} from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import apiService from '../services/ApiService';
import socketService from '../services/SocketService';
import {colors, globalStyles} from '../styles/globalStyles';
import audioRecorderService from '../services/AudioRecorder';
import ChatUnreadService from '../services/ChatUnreadService';
import { PermissionsManager } from '../utils/permissions';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import IncomingCallModal from '../components/IncomingCallModal';
import { initCallNotifications } from '../services/CallNotifications';
import RecordingWaveform from '../components/RecordingWaveform';
import RNFS from 'react-native-fs';
import Clipboard from '@react-native-clipboard/clipboard';
import { saveMediaToDevice } from '../utils/mediaSaver';

interface Message {
  _id: string;
  sender: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file';
  file?: {
    url: string;
    name: string;
    size: number;
    type: string;
  };
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  reply?: string;
  replyFrom?: string;
  replyToId?: string;
  isForwarded?: boolean;
}

interface User {
  username: string;
  name: string;
  avatar: string;
}

type ConversationRouteParams = {
  chatId: string;
  recipientUsername: string;
  recipientName: string;
  recipientAvatar: string;
};

const {height: screenHeight} = Dimensions.get('window');

const ConversationScreen = () => {
  // Pending media selection and caption for multi-send
  const [pendingMedia, setPendingMedia] = useState<Array<{ uri: string; type?: string; name?: string; size?: number }>>([]);
  const [pendingCaption, setPendingCaption] = useState('');
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const route = useRoute<RouteProp<{params: ConversationRouteParams}, 'params'>>();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const flatListRef = useRef<FlatList>(null);
  
  const {chatId, recipientUsername, recipientName, recipientAvatar} = route.params;
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [recipientTyping, setRecipientTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  // Compose context
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordTimeMs, setRecordTimeMs] = useState(0);
  const [recordFileUri, setRecordFileUri] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
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
      await loadMessages();
    } catch (e) {
    } finally {
      try { spinLoopRef.current?.stop(); } catch {}
      logoSpin.setValue(0);
      setRefreshing(false);
    }
  };
  // Audio playback state
  const audioPlayerRef = useRef<AudioRecorderPlayer | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playPosition, setPlayPosition] = useState<number>(0);
  const [playDuration, setPlayDuration] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  // Incoming call state
  const [incomingVisible, setIncomingVisible] = useState(false);
  const [incomingCaller, setIncomingCaller] = useState('');
  const [incomingAvatar, setIncomingAvatar] = useState<string | undefined>(undefined);
  const [incomingType, setIncomingType] = useState<'audio' | 'video'>('audio');
  const emojis: string[] = ['😀','😂','😍','👍','🙏','🎉','😎','❤️','🔥','🥳','😢','🤔','👏','💯'];
  const handleEmojiSelect = (emoji: string) => {
    setMessageText(prev => prev + emoji);
  };

  useEffect(() => {
    loadCurrentUser();
    loadMessages();
    setupSocketListeners();
    // Initialize call notifications channel and listeners
    initCallNotifications();
    const incomingSub = DeviceEventEmitter.addListener('incoming_call', (data: any) => {
      const caller = data?.caller || data?.from || recipientUsername;
      setIncomingCaller(caller);
      setIncomingAvatar(data?.avatar);
      setIncomingType((data?.callType === 'video') ? 'video' : 'audio');
      setIncomingVisible(true);
    });
    
    return () => {
      // Cleanup socket listeners
      const socket = socketService.getSocket();
      if (socket) {
        socket.off('connect');
        socket.off('disconnect');
        socket.off('newMessage');
        socket.off('messageEdited');
        socket.off('messageDeleted');
        socket.off('typing');
        socket.off('stopTyping');
        socket.off('user-online');
        socket.off('user-offline');
        socket.off('update-online-users');
      }
      // Stop typing and clear timers
      try { socketService.stopTyping(recipientUsername); } catch {}
      if (typingInterval.current) { clearInterval(typingInterval.current as any); typingInterval.current = null; }
      if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; }
      try { incomingSub.remove(); } catch {}
    };
  }, []);

  // Setup audio player and playback listener
  useEffect(() => {
    const player = new AudioRecorderPlayer();
    audioPlayerRef.current = player;
    try { player.removePlayBackListener(); } catch {}
    const sub = player.addPlayBackListener((e: any) => {
      setPlayPosition(e?.currentPosition || 0);
      setPlayDuration(e?.duration || 0);
      if ((e?.currentPosition || 0) >= (e?.duration || 0) && playingId) {
        setPlayingId(null);
        setIsPaused(false);
        try { player.stopPlayer(); } catch {}
      }
    });
    return () => {
      try { player.stopPlayer(); } catch {}
      try { player.removePlayBackListener(); } catch {}
    };
  }, []);

  // Prevent input bar from hanging: track keyboard and consume back when visible
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (keyboardVisible) {
        Keyboard.dismiss();
        setShowEmojiPanel(false);
        return true;
      }
      return false;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      backSub.remove();
    };
  }, [keyboardVisible]);

  // Reload messages whenever this screen gains focus
  useEffect(() => {
    if (isFocused) {
      loadMessages();
    }
  }, [isFocused, chatId]);

  // Manage active chat and clear its unread count while focused
  useEffect(() => {
    if (isFocused && chatId) {
      try {
        ChatUnreadService.setActiveChat(chatId);
        ChatUnreadService.clear(chatId);
      } catch (_) {}
    } else {
      try { ChatUnreadService.setActiveChat(null); } catch (_) {}
    }
  }, [isFocused, chatId]);

  // Load starred message ids per chat
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(`starred:${chatId}`);
        setStarredIds(raw ? JSON.parse(raw) : []);
      } catch (_e) {}
    })();
  }, [chatId]);

  const loadCurrentUser = async () => {
    try {
      const userData = await AsyncStorage.getItem('currentUser');
      if (userData) {
        setCurrentUser(JSON.parse(userData));
      }
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const loadMessages = async () => {
    try {
      // Backend expects recipient username for message history
      const response = await apiService.getMessages(recipientUsername);
      if (response?.success && Array.isArray((response as any).messages)) {
        const raw = (response as any).messages as any[];
        const normalized = raw.map(m => normalizeMessage(m));
        // Ensure chronological order: oldest at top, newest at bottom
        normalized.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        setMessages(normalized);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const normalizeMessage = (m: any): Message => {
    let text: string = (m?.text || m?.content || '').trim();
    const created: string = m?.createdAt || m?.timestamp || new Date().toISOString();
    const media = Array.isArray(m?.media) ? m.media : [];
    const hasAudio = !!m?.audio && String(m.audio).trim().length > 0;
    const replyText: string = (m?.reply || m?.replyText || '').trim();
    const replyFrom: string | undefined = m?.replyFrom || undefined;
    const replyToId: string | undefined = m?.replyToId || m?.replyTo || undefined;

    const FORWARD_MARKER = '[forwarded]';
    const forwarded = text.startsWith(FORWARD_MARKER);
    if (forwarded) {
      text = text.slice(FORWARD_MARKER.length).trim();
    }

    if (media.length > 0) {
      const first = media[0];
      const url: string = first?.secure_url || first?.url || first;
      const typeLower = String(first?.type || first?.resource_type || '').toLowerCase();
      const isVideo = typeLower.includes('video');
      const isAudio = typeLower.includes('audio');
      const isDocument = typeLower.includes('application') || typeLower.includes('pdf') || typeLower.includes('text');
      if (isVideo) {
        return {
          _id: m?._id || String(created),
          sender: m?.sender,
          content: forwarded ? 'Video' : (text || 'Video'),
          type: 'video',
          file: url ? { url, name: (first?.name || first?.original_filename || 'media'), size: (first?.bytes || first?.size || 0), type: String(first?.type || typeLower).toLowerCase() } : undefined,
          timestamp: created,
          status: 'sent',
          reply: replyText || undefined,
          replyFrom,
          replyToId,
          isForwarded: forwarded || undefined,
        };
      }
      if (isAudio) {
        return {
          _id: m?._id || String(created),
          sender: m?.sender,
          content: 'Voice note',
          type: 'audio',
          file: url ? { url, name: (first?.name || first?.original_filename || 'audio'), size: (first?.bytes || first?.size || 0), type: String(first?.type || typeLower).toLowerCase() } : undefined,
          timestamp: created,
          status: 'sent',
          reply: replyText || undefined,
          replyFrom,
          replyToId,
          isForwarded: forwarded || undefined,
        };
      }
      if (isDocument) {
        return {
          _id: m?._id || String(created),
          sender: m?.sender,
          content: forwarded ? 'File' : (text || 'File'),
          type: 'file',
          file: url ? { url, name: (first?.name || first?.original_filename || 'file'), size: (first?.bytes || first?.size || 0), type: String(first?.type || typeLower).toLowerCase() } : undefined,
          timestamp: created,
          status: 'sent',
          reply: replyText || undefined,
          replyFrom,
          replyToId,
          isForwarded: forwarded || undefined,
        };
      }
      // Default to image when type is unknown
      return {
        _id: m?._id || String(created),
        sender: m?.sender,
        content: forwarded ? 'Photo' : (text || 'Photo'),
        type: 'image',
        file: url ? { url, name: (first?.name || first?.original_filename || 'image'), size: (first?.bytes || first?.size || 0), type: String(first?.type || typeLower).toLowerCase() } : undefined,
        timestamp: created,
        status: 'sent',
        reply: replyText || undefined,
        replyFrom,
        replyToId,
        isForwarded: forwarded || undefined,
      };
    }

    if (hasAudio) {
      return {
        _id: m?._id || String(created),
        sender: m?.sender,
        content: 'Voice note',
        type: 'audio',
        timestamp: created,
        status: 'sent',
        reply: replyText || undefined,
        replyFrom,
        replyToId,
        isForwarded: forwarded || undefined,
      };
    }

    return {
      _id: m?._id || String(created),
      sender: m?.sender,
      content: text,
      type: 'text',
      timestamp: created,
      status: 'sent',
      reply: replyText || undefined,
      replyFrom,
      replyToId,
      isForwarded: forwarded || undefined,
    };
  };

  const setupSocketListeners = () => {
    const socket = socketService.getSocket();
    if (socket) {
      // Hyper-sensitive presence on socket connect/disconnect
      socket.on('connect', () => {
        const nowOnline = socketService.isOnline(recipientUsername);
        setIsOnline(!!nowOnline);
        if (!nowOnline) {
          setHeaderStatus('Offline');
          fetchLastSeen(recipientUsername);
        } else {
          setHeaderStatus('');
        }
      });

      socket.on('disconnect', () => {
        setIsOnline(false);
        setRecipientTyping(false);
        setHeaderStatus('Offline');
      });

      // Track global online users for "last seen" updates
      socket.on('update-online-users', (onlineUsers: string[]) => {
        const isRecipientOnline = onlineUsers?.includes?.(recipientUsername);
        setIsOnline(!!isRecipientOnline);
        if (!isRecipientOnline) {
          // Fetch last seen when user goes offline
          setHeaderStatus('Offline');
          fetchLastSeen(recipientUsername);
        } else {
          setHeaderStatus('');
        }
      });

      // Backend emits 'newMessage' with the saved message document
      socket.on('newMessage', (message: any) => {
        const msg = normalizeMessage(message);
        const involvesRecipient = msg.sender === recipientUsername || msg.sender === currentUser?.username;
        if (involvesRecipient) {
          // Deduplicate optimistic message: if last message matches sender+content, replace it
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (
              last &&
              last.sender === msg.sender &&
              last.content === (message?.text || msg.content)
            ) {
              const copy = prev.slice(0, -1);
              return [...copy, msg];
            }
            return [...prev, msg];
          });
          scrollToBottom();
        }
      });

      // Live update edited messages from server
      socket.on('messageEdited', (data: any) => {
        const editedId = data?.id || data?.messageId || data?._id;
        const newText = data?.text || data?.content || '';
        if (!editedId) return;
        setMessages(prev => prev.map(m => (m._id === String(editedId) ? { ...m, content: newText } : m)));
      });

      // Mark deleted messages (for everyone) in the thread
      socket.on('messageDeleted', (data: any) => {
        const deletedId = data?.id || data?.messageId || data?._id;
        if (!deletedId) return;
        setMessages(prev => prev.map(m => (m._id === String(deletedId) ? { ...m, content: 'This message was deleted' } : m)));
      });

      socket.on('typing', (data: { from?: string; username?: string; chatId?: string; to?: string }) => {
        const who = data.username || data.from;
        const to = data.to;
        if ((who === recipientUsername) || (to === currentUser?.username)) {
          setRecipientTyping(true);
        }
      });

      socket.on('stopTyping', (data: { from?: string; username?: string; chatId?: string; to?: string }) => {
        const who = data.username || data.from;
        const to = data.to;
        if ((who === recipientUsername) || (to === currentUser?.username)) {
          setRecipientTyping(false);
        }
      });

      socket.on('user-online', (username: string) => {
        if (username === recipientUsername) {
          setIsOnline(true);
          setHeaderStatus('');
        }
      });

      socket.on('user-offline', (username: string) => {
        if (username === recipientUsername) {
          setIsOnline(false);
          setHeaderStatus('Offline');
          fetchLastSeen(recipientUsername);
        }
      });
    }
  };

  // Hyper-sensitive presence: initial hydration on mount and when recipient changes
  useEffect(() => {
    const onlineInitial = socketService.isOnline(recipientUsername);
    setIsOnline(!!onlineInitial);
    if (!onlineInitial) {
      setHeaderStatus('Offline');
      fetchLastSeen(recipientUsername);
    } else {
      setHeaderStatus('');
    }
  }, [recipientUsername]);

  // Join room once current user is known
  useEffect(() => {
    if (currentUser?.username) {
      try {
        socketService.joinRoom(currentUser.username, recipientUsername);
      } catch (_e) {}
    }
  }, [currentUser?.username, recipientUsername]);

  const fetchLastSeen = async (username: string) => {
    try {
      const res = await apiService.getLastSeen(username as any);
      const lastSeenIso: string | undefined = (res as any)?.lastSeen;
      if (lastSeenIso) {
        const ts = new Date(lastSeenIso);
        const now = new Date();
        const diff = Math.floor((now.getTime() - ts.getTime()) / 1000);
        let timeStr = 'a while ago';
        if (diff < 60) timeStr = `${diff}s ago`;
        else if (diff < 3600) timeStr = `${Math.floor(diff / 60)}m ago`;
        else if (diff < 86400) timeStr = `${Math.floor(diff / 3600)}h ago`;
        else timeStr = `${Math.floor(diff / 86400)}d ago`;
        setHeaderStatus(`Last seen: ${timeStr}`);
      }
    } catch (_e) {
      // ignore
    }
  };

  const [headerStatus, setHeaderStatus] = useState<string>('Offline');

  // Only auto-scroll once on initial open; further navigation is user-controlled
  const didInitialAutoScroll = useRef(false);
  const scrollToBottomOnce = useCallback(() => {
    if (didInitialAutoScroll.current) return;
    didInitialAutoScroll.current = true;
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
    }, 0);
  }, []);

  // Scroll to bottom helper used after sending and receiving messages
  const scrollToBottom = useCallback(() => {
    // Defer to next frame to let list update layout
    requestAnimationFrame(() => {
      try {
        flatListRef.current?.scrollToEnd({ animated: true });
      } catch (_e) {}
    });
  }, []);

  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [showScrollControls, setShowScrollControls] = useState<boolean>(false);

  const scrollToMessageId = useCallback((id: string) => {
    // Prefer index-based scrolling for accuracy across dynamic item heights
    const index = messages.findIndex(m => m._id === id);
    if (index >= 0) {
      try {
        flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
      } catch (_e) {
        // Fallback to offset if index scroll throws due to unknown layouts
        const y = itemPositions.current[id];
        if (typeof y === 'number') {
          flatListRef.current?.scrollToOffset({ offset: Math.max(y - 20, 0), animated: true });
        }
      }
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1600);
    } else {
      // If message isn't found, attempt offset map
      const y = itemPositions.current[id];
      if (typeof y === 'number') {
        flatListRef.current?.scrollToOffset({ offset: Math.max(y - 20, 0), animated: true });
        setHighlightedId(id);
        setTimeout(() => setHighlightedId(null), 1600);
      }
    }
  }, [messages]);

const handleSendMessage = async () => {
  const text = messageText.trim();
  if (!text && pendingMedia.length === 0) return;

  // Stop typing immediately when sending
  if (isTyping) {
    try { socketService.stopTyping(recipientUsername); } catch (_) {}
    if (typingInterval.current) { clearInterval(typingInterval.current as any); typingInterval.current = null; }
    if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; }
    setIsTyping(false);
  }

    // Editing existing text message
    if (editingId) {
      try {
        await apiService.editMessage(editingId, text);
        setMessages(prev => prev.map(m => (m._id === editingId ? { ...m, content: text } : m)));
        setEditingId(null);
        setMessageText('');
      } catch (error) {
        console.error('Error editing message:', error);
        Alert.alert('Error', 'Failed to edit message');
      }
      return;
    }

  // If there are pending media, send them with optional caption
  if (pendingMedia.length > 0) {
    try {
      const uploaded: Array<{ url: string; public_id?: string; name?: string; type?: string }> = [];
      for (const file of pendingMedia) {
        const kind = file.type?.startsWith('image/') ? 'image' : file.type?.startsWith('video/') ? 'video' : file.type?.startsWith('audio/') ? 'audio' : 'document';
        const uploadResponse = await apiService.uploadFile(
          { uri: file.uri, type: file.type as string, name: (file.name || 'upload') as string } as any,
          kind,
          (p: number) => {
            setUploadProgress(prev => ({ ...prev, [file.uri]: p }));
          }
        );
        if (Array.isArray((uploadResponse as any)?.files)) {
          const filesArr = ((uploadResponse as any).files as any[]);
          filesArr.forEach((f: any) => uploaded.push({
            url: f?.url || f?.secure_url,
            public_id: f?.public_id,
            name: f?.name || 'media',
            // Prefer MIME if provided by server, fallback to selected kind
            type: f?.type || kind,
          }));
          setUploadProgress(prev => ({ ...prev, [file.uri]: 100 }));
        } else if (uploadResponse?.success && (uploadResponse as any)?.url) {
          // Fallback: single URL without public_id (avoid persisting without public_id)
          uploaded.push({ url: (uploadResponse as any).url, type: kind });
          setUploadProgress(prev => ({ ...prev, [file.uri]: 100 }));
        }
      }
      if (uploaded.length > 0) {
        // Optimistically render media (first item carries caption if provided)
        const created = new Date().toISOString();
        const optimistic: Message[] = uploaded.map((u, idx) => ({
          _id: (Date.now() + idx).toString(),
          sender: currentUser?.username || '',
          content: idx === 0 ? (pendingCaption || '') : '',
          // Map MIME to display type for UI
          type: String(u.type || '').includes('image') ? 'image' : String(u.type || '').includes('video') ? 'video' : String(u.type || '').includes('audio') ? 'audio' : (u.type === 'image' ? 'image' : u.type === 'video' ? 'video' : u.type === 'audio' ? 'audio' : 'file'),
          file: { url: u.url, name: u.name || 'media', size: 0, type: u.type || '' } as any,
          timestamp: created,
          status: 'sent',
          reply: replyingTo ? (replyingTo.type === 'text' ? replyingTo.content : replyingTo.type === 'image' ? 'Photo' : replyingTo.type === 'video' ? 'Video' : replyingTo.type === 'audio' ? 'Voice note' : 'File') : undefined,
          replyFrom: replyingTo ? (replyingTo.sender || '') : undefined,
          replyToId: replyingTo?._id,
        }));
        setMessages(prev => [...prev, ...optimistic]);
        scrollToBottom();

        // Instant delivery via socket with files + optional caption
        if (currentUser?.username) {
          socketService.sendMessage({
            from: currentUser.username,
            to: recipientUsername,
            message: pendingCaption || '',
            // Send enriched media array for compatibility; keep legacy `files` for receivers expecting it
            media: uploaded as any,
            files: uploaded,
            replyTo: replyingTo?._id,
          } as any);
        }

        // Persist via API (backend accepts `media` array and optional caption)
        await apiService.sendMessage({
          to: recipientUsername,
          message: pendingCaption || '',
          // Include public_id and name to satisfy Message schema
          media: uploaded,
          replyTo: replyingTo?._id,
        } as any);
      }
      setPendingMedia([]);
      setPendingCaption('');
      setUploadProgress({});
      setReplyingTo(null);
      setMessageText('');
      scrollToBottom();
      setShowEmojiPanel(false);
      Keyboard.dismiss();
      try { Vibration.vibrate(10); } catch {}
    } catch (error) {
      console.error('Error sending media message:', error);
      Alert.alert('Error', 'Failed to send media');
    }
    return;
  }

  // New message (optionally with local reply context)
  const tempMessage: Message = {
      _id: Date.now().toString(),
      sender: currentUser?.username || '',
      content: text,
      type: 'text',
      timestamp: new Date().toISOString(),
      status: 'sent',
      // Optimistically attach reply metadata so the tag appears instantly
      reply: replyingTo ? (replyingTo.type === 'text' ? replyingTo.content : replyingTo.type === 'image' ? 'Photo' : replyingTo.type === 'video' ? 'Video' : replyingTo.type === 'audio' ? 'Voice note' : 'File') : undefined,
      replyFrom: replyingTo ? replyingTo.sender : undefined,
      replyToId: replyingTo ? replyingTo._id : undefined,
    };

    setMessages(prev => [...prev, tempMessage]);
    setMessageText('');
    scrollToBottom();
    setShowEmojiPanel(false);
    Keyboard.dismiss();
    // Haptic + subtle click sound on send
    try { Vibration.vibrate(10); } catch {}
    try {
      const player = new AudioRecorderPlayer();
      // Attempt to play short notify sound from server static assets
      await player.startPlayer('https://connecther.network/notify.mp3');
      setTimeout(() => { try { player.stopPlayer(); } catch {} }, 800);
    } catch (_e) {}

  try {
    // Instant delivery via socket for text-only messages
    if (currentUser?.username) {
      socketService.sendMessage({
        from: currentUser.username,
        to: recipientUsername,
        message: text,
        replyTo: replyingTo?._id,
      } as any);
    }

    // Persist via API
    await apiService.sendMessage({
      to: recipientUsername,
      message: text,
      replyTo: replyingTo?._id,
    } as any);
    setReplyingTo(null);
  } catch (error) {
    console.error('Error sending message:', error);
    Alert.alert('Error', 'Failed to send message');
  }
};

  // Compose helpers to start/clear edit or reply
  const startEdit = (message: Message) => {
    if (message.sender !== currentUser?.username) return; // Only edit own messages
    setEditingId(message._id);
    setMessageText(message.content);
    setShowEmojiPanel(false);
  };

  const startReply = (message: Message) => {
    setReplyingTo(message);
    setShowEmojiPanel(false);
  };

  const clearComposeContext = () => {
    setEditingId(null);
    setReplyingTo(null);
  };

  const typingTimeout = useRef<NodeJS.Timeout | null>(null);
  const typingInterval = useRef<NodeJS.Timeout | null>(null);
  const itemPositions = useRef<Record<string, number>>({});
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
  try {
    const player = new AudioRecorderPlayer();
    await player.startPlayer('https://connecther.network/notify.mp3');
    setTimeout(() => { try { player.stopPlayer(); } catch {} }, 650);
  } catch (_e) {}
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
    const author = targetMsg?.sender;
    const authorUsername = typeof author === 'string' ? author : String(author || '');
    const me = currentUser;
    if (authorUsername && me?.username && authorUsername !== me.username) {
      // Build payload for deep-linking to this chat
      const payload = {
        toUsername: authorUsername,
        title: me.name || me.username,
        body: 'reacted to your message.',
        type: 'reaction',
        data: {
          chatId: String(chatId || ''),
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

  const handleTyping = (text: string) => {
    setMessageText(text);
    const hasText = text.trim().length > 0;

    if (hasText) {
      if (!isTyping) {
        setIsTyping(true);
        socketService.startTyping(recipientUsername);
        // Periodic typing pings while actively typing
        if (typingInterval.current) clearInterval(typingInterval.current as any);
        typingInterval.current = setInterval(() => {
          try { socketService.startTyping(recipientUsername); } catch (_) {}
        }, 1000);
      }
      // Reset stop timer on every keystroke
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
      }
      typingTimeout.current = setTimeout(() => {
        setIsTyping(false);
        if (typingInterval.current) { clearInterval(typingInterval.current as any); typingInterval.current = null; }
        socketService.stopTyping(recipientUsername);
      }, 1500);
    } else {
      // Empty input: stop immediately
      setIsTyping(false);
      if (typingInterval.current) { clearInterval(typingInterval.current as any); typingInterval.current = null; }
      if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; }
      try { socketService.stopTyping(recipientUsername); } catch (_) {}
    }
  };

  const handleMediaPicker = () => {
    setShowMediaPickerModal(true);
  };

  const toggleStar = async (messageId: string) => {
    setStarredIds(prev => {
      const next = prev.includes(messageId)
        ? prev.filter(id => id !== messageId)
        : [...prev, messageId];
      AsyncStorage.setItem(`starred:${chatId}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const deleteForMe = async (message: Message) => {
    try {
      await apiService.deleteMessageForMe(message._id);
      setMessages(prev => prev.filter(m => m._id !== message._id));
    } catch (error) {
      console.error('deleteForMe error:', error);
      Alert.alert('Error', 'Failed to delete message for you');
    }
  };

  const deleteForEveryone = async (message: Message) => {
    try {
      await apiService.deleteMessageForEveryone(message._id);
      setMessages(prev => prev.map(m => (m._id === message._id ? { ...m, content: 'This message was deleted' } : m)));
    } catch (error) {
      console.error('deleteForEveryone error:', error);
      Alert.alert('Error', 'Failed to delete message');
    }
  };

  // Forward message modal state
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTarget, setForwardTarget] = useState('');
  const [forwardSource, setForwardSource] = useState<Message | null>(null);
  const [forwardFriends, setForwardFriends] = useState<Array<{ username: string; name?: string; avatar?: string }>>([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardSearch, setForwardSearch] = useState('');
  // Message actions modal (Android Alert is limited to 3 buttons)
  const [actionsMessage, setActionsMessage] = useState<Message | null>(null);
  const openMessageActions = (msg: Message) => setActionsMessage(msg);
  const closeMessageActions = () => setActionsMessage(null);
  const [showMediaPickerModal, setShowMediaPickerModal] = useState(false);

  const beginForward = (message: Message) => {
    setForwardSource(message);
    setForwardTarget('');
    setShowForwardModal(true);
    (async () => {
      try {
        setForwardLoading(true);
        const resp = await apiService.getFriends();
        const users = (resp?.users || resp?.friends || resp || []).map((f: any) => ({
          username: f?.username || f?.user?.username || f,
          name: f?.name || f?.user?.name,
          avatar: f?.avatar || f?.user?.avatar,
        }));
        setForwardFriends(users);
      } catch (err) {
        console.error('Failed to load friends for forward:', err);
      } finally {
        setForwardLoading(false);
      }
    })();
  };

  const confirmForward = async () => {
    const target = forwardTarget.trim();
    if (!target || !forwardSource) {
      Alert.alert('Forward', 'Please enter a valid username');
      return;
    }
    try {
      const FORWARD_MARKER = '[forwarded]';
      if (forwardSource.type === 'text') {
        await apiService.sendMessage({ to: target, message: `${FORWARD_MARKER} ${forwardSource.content}` } as any);
      } else if (forwardSource.file?.url) {
        const fileType = forwardSource.type === 'image' ? 'image' : forwardSource.type === 'video' ? 'video' : forwardSource.type === 'audio' ? 'audio' : 'document';
        await apiService.sendMessage({ to: target, message: FORWARD_MARKER, files: [{ url: forwardSource.file.url, type: fileType }] as any } as any);
      } else {
        await apiService.sendMessage({ to: target, message: `${FORWARD_MARKER} ${forwardSource.content}` } as any);
      }
      setShowForwardModal(false);
      setForwardSource(null);
      Alert.alert('Forwarded', 'Message forwarded successfully');
    } catch (error) {
      console.error('Error forwarding message:', error);
      Alert.alert('Error', 'Failed to forward message');
    }
  };

  const selectForwardTarget = (username: string) => {
    setForwardTarget(username);
    confirmForward();
  };

  const handleDeleteChat = async () => {
    Alert.alert(
      'Clear Chat',
      'This will remove all messages in this conversation for you. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiService.clearChat(recipientUsername);
              setMessages([]);
              setShowMenu(false);
            } catch (error) {
              console.error('clearChat error:', error);
              Alert.alert('Error', 'Failed to clear chat');
            }
          },
        },
      ]
    );
  };

  const openCamera = async () => {
    try {
      const perm = await PermissionsManager.requestCameraPermission();
      if (!perm.granted) {
        PermissionsManager.showPermissionRationale('camera', () => openCamera());
        return;
      }

      launchCamera({ mediaType: 'photo', quality: 0.8 }, (response) => {
        const asset = response?.assets && response.assets[0];
        if (asset) {
          const mapped = {
            uri: asset.uri!,
            type: asset.type,
            name: asset.fileName,
            size: asset.fileSize,
          };
          setPendingMedia(prev => [...prev, mapped]);
          setShowEmojiPanel(false);
        }
      });
    } catch (err) {
      console.warn('openCamera error:', err);
      Alert.alert('Camera Error', 'Unable to open camera. Please try again.');
    }
  };

  const openGallery = () => {
    launchImageLibrary({ mediaType: 'mixed', quality: 0.8, selectionLimit: 10 }, (response) => {
      const assets = response?.assets || [];
      if (assets.length > 0) {
        const mapped = assets.map(a => ({ uri: a.uri!, type: a.type, name: a.fileName, size: a.fileSize }));
        setPendingMedia(prev => [...prev, ...mapped]);
        setShowEmojiPanel(false);
      }
    });
  };

  const openDocumentPicker = async () => {
    try {
      const results = await DocumentPicker.pickMultiple({ type: [DocumentPicker.types.allFiles] });
      const mapped = (results || []).map((r: any) => ({ uri: r.uri, type: r.type, name: r.name, size: (r as any).size }));
      if (mapped.length) {
        setPendingMedia(prev => [...prev, ...mapped]);
        setShowEmojiPanel(false);
      }
    } catch (error: any) {
      if (DocumentPicker.isCancel(error)) return;
      // Fallback to single pick if multiple is not supported
      try {
        const single = await DocumentPicker.pickSingle({ type: [DocumentPicker.types.allFiles] });
        const mapped = { uri: single.uri, type: single.type, name: (single as any).name, size: (single as any).size };
        setPendingMedia(prev => [...prev, mapped]);
        setShowEmojiPanel(false);
      } catch (err) {
        if (!DocumentPicker.isCancel(err)) {
          console.error('Document picker error:', err);
          Alert.alert('Error', 'Failed to pick document');
        }
      }
    }
  };

  const formatRecordTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const formatBytes = (n?: number) => {
    if (!n || n <= 0) return '';
    const units = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(n) / Math.log(1024));
    const v = n / Math.pow(1024, i);
    return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
  };

  const startRecording = async () => {
    const perm = await PermissionsManager.requestAudioPermission();
    if (!perm.granted) {
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
      await handleFileUpload(audioFile);
    } catch (err) {
      console.error('sendVoiceNote error', err);
      Alert.alert('Error', 'Failed to send voice note');
    } finally {
      setRecordTimeMs(0);
      setRecordFileUri(null);
      setShowEmojiPanel(false);
      Keyboard.dismiss();
    }
  };

  const handleFileUpload = async (file: any) => {
    try {
      const uploadResponse = await apiService.uploadFile(
        {
          uri: file.uri,
          type: file.type,
          name: file.fileName || file.name,
        } as any,
        file.type?.startsWith('image/') ? 'image' : file.type?.startsWith('video/') ? 'video' : file.type?.startsWith('audio/') ? 'audio' : 'document'
      );
      // Prefer server's files array which includes public_id and MIME type
      const filesArr = Array.isArray((uploadResponse as any)?.files) ? (uploadResponse as any).files : [];
      if (filesArr.length > 0) {
        const enriched = filesArr.map((f: any) => ({
          url: f?.url || f?.secure_url,
          public_id: f?.public_id,
          name: f?.name || (file.fileName || file.name || 'media'),
          type: f?.type || file.type,
        }));
        // Persist via API for history
        await apiService.sendMessage({
          to: recipientUsername,
          message: (file.fileName || file.name || ''),
          media: enriched,
        } as any);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      Alert.alert('Error', 'Failed to upload file');
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  };

  const isSameDay = (a: Date, b: Date) => (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );

  const formatDayLabel = (d: Date) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (isSameDay(d, today)) return 'Today';
    if (isSameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  const toggleAudioPlayback = async (msg: Message) => {
    const player = audioPlayerRef.current;
    const url = msg.file?.url;
    if (!player || !url) return;
    try {
      if (playingId === msg._id) {
        if (isPaused) {
          await player.resumePlayer();
          setIsPaused(false);
        } else {
          await player.pausePlayer();
          setIsPaused(true);
        }
      } else {
        try { await player.stopPlayer(); } catch {}
        setPlayingId(msg._id);
        setIsPaused(false);
        setPlayPosition(0);
        setPlayDuration(0);
        await player.startPlayer(url);
      }
    } catch (err) {
      console.error('toggleAudioPlayback error', err);
      Alert.alert('Playback failed', 'Unable to play voice note.');
    }
  };

  const renderMessage = ({item, index}: {item: Message; index: number}) => {
    const isOwnMessage = item.sender === currentUser?.username;

    // Remove horizontal responder capture to keep vertical scroll smooth

    const showMessageActions = () => {
      openMessageActions(item);
    };

    return (
      <> 
        {(() => {
          const itemDate = new Date(item.timestamp);
          const prev = index > 0 ? messages[index - 1] : null;
          const prevDate = prev ? new Date(prev.timestamp) : null;
          const showDay = index === 0 || (prevDate && !isSameDay(itemDate, prevDate));
          if (!showDay) return null;
          return (
            <View style={styles.dayDivider}>
              <Text style={styles.dayDividerText}>{formatDayLabel(itemDate)}</Text>
            </View>
          );
        })()}
        <View style={[
          styles.messageContainer,
          isOwnMessage ? styles.ownMessage : styles.otherMessage
        ]}
          onLayout={(e) => { itemPositions.current[item._id] = e.nativeEvent.layout.y; }}
        >
        <Pressable style={[
          styles.messageBubble,
          isOwnMessage ? styles.ownBubble : styles.otherBubble
          , highlightedId === item._id ? styles.highlightBubble : null
        ]}
          onLongPress={() => openReactionTray(item._id)}
          onPress={() => { reactionTargetId ? closeReactionTray() : showMessageActions(); }}
        >
          {item.isForwarded && (
            <Text style={styles.forwardedTag}>Forwarded</Text>
          )}
          {item.type === 'image' && item.file && (
            <>
              <Image source={{uri: item.file.url}} style={styles.messageImage} />
              <View style={styles.mediaActionsRow}>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleDownload(item.file!)}>
                  <Icon name="download" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>{typeof downloadingMap[item.file!.url] === 'number' ? `Downloading ${Math.round(Math.max(0, Math.min(100, downloadingMap[item.file!.url])))}%` : 'Download'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleShare(item.file!)}>
                  <Icon name="share" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          
          {item.type === 'video' && item.file && (
            <>
              <Pressable style={styles.videoContainer} onPress={() => setPreviewVideoUrl(item.file!.url)}>
                <Video
                  source={{ uri: item.file!.url }}
                  style={styles.videoPreview}
                  paused={true}
                  controls={false}
                  resizeMode="cover"
                />
                <View style={styles.videoOverlay}>
                  <Icon name="play-circle-filled" size={48} color="#fff" />
                </View>
              </Pressable>
              <Text style={styles.fileName}>{item.file.name} {item.file.size ? `• ${formatBytes(item.file.size)}` : ''}</Text>
              <View style={styles.mediaActionsRow}>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleDownload(item.file!)}>
                  <Icon name="download" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>{typeof downloadingMap[item.file!.url] === 'number' ? `Downloading ${Math.round(Math.max(0, Math.min(100, downloadingMap[item.file!.url])))}%` : 'Download'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleShare(item.file!)}>
                  <Icon name="share" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          
          {item.type === 'file' && item.file && (
            <>
              <View style={styles.fileContainer}>
                <Icon name="insert-drive-file" size={24} color={colors.text} />
                <Text style={styles.fileName}>{item.file.name} {item.file.size ? `• ${formatBytes(item.file.size)}` : ''}</Text>
              </View>
              <View style={styles.mediaActionsRow}>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleDownload(item.file!)}>
                  <Icon name="download" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>{typeof downloadingMap[item.file!.url] === 'number' ? `Downloading ${Math.round(Math.max(0, Math.min(100, downloadingMap[item.file!.url])))}%` : 'Download'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleShare(item.file!)}>
                  <Icon name="share" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          
          {item.type === 'audio' && item.file && (
            <>
              <View style={styles.audioContainer}>
                <TouchableOpacity style={styles.audioPlayBtn} onPress={() => toggleAudioPlayback(item)}>
                  <Icon name={playingId === item._id && !isPaused ? 'pause' : 'play-arrow'} size={20} color="#E9EDEF" />
                </TouchableOpacity>
                <View style={{flex: 1}}>
                  {typeof uploadProgress[item.file!.url] === 'number' && uploadProgress[item.file!.url] > 0 && uploadProgress[item.file!.url] < 100 && (
                    <View style={styles.audioUploadBar}>
                      <View style={[styles.audioUploadProgress, { width: `${Math.round(Math.max(0, Math.min(100, uploadProgress[item.file!.url])))}%` }]} />
                    </View>
                  )}
                  <View style={styles.audioProgressBar}>
                    <View style={[styles.audioProgress, { width: `${(playingId === item._id && playDuration ? Math.min(100, Math.max(0, (playPosition / playDuration) * 100)) : 0)}%` }]} />
                  </View>
                  <View style={styles.audioWave}>
                    {Array.from({ length: 16 }).map((_, i) => (
                      <View key={i} style={[styles.audioWaveBar, { height: 6 + (i % 4) * 4 }]} />
                    ))}
                  </View>
                  <Text style={styles.audioTime}>
                    {(playingId === item._id ? formatRecordTime(playPosition) : '00:00')} / {formatRecordTime(playDuration || 0)}
                  </Text>
                  {!!item.file?.name && <Text style={styles.fileName}>{item.file.name}</Text>}
                </View>
              </View>
              <View style={styles.mediaActionsRow}>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleDownload(item.file!)}>
                  <Icon name="download" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>{typeof downloadingMap[item.file!.url] === 'number' ? `Downloading ${Math.round(Math.max(0, Math.min(100, downloadingMap[item.file!.url])))}%` : 'Download'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mediaActionBtn} onPress={() => handleShare(item.file!)}>
                  <Icon name="share" size={18} color={colors.text} />
                  <Text style={styles.mediaActionText}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          
          {/* Star marker */}
          {starredIds.includes(item._id) && (
            <View style={styles.starBadge}>
              <Icon name="star" size={14} color="#ffcc00" />
            </View>
          )}
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
            <View pointerEvents="box-none" style={[styles.reactionTray, isOwnMessage ? styles.reactionTrayRight : styles.reactionTrayLeft]}>
              {reactionEmojis.map(e => (
                <TouchableOpacity key={e} style={styles.reactionItem} onPress={() => pickReaction(item._id, e)}>
                  <Text style={styles.reactionText}>{e}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.reactionMore} onPress={() => { closeReactionTray(); showMessageActions(); }}>
                <Icon name="more-horiz" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
          ) : null}

          {item.replyToId && (
            <TouchableOpacity style={styles.replyPreview} onPress={() => scrollToMessageId(item.replyToId!)}>
              {(() => {
                const parent = messages.find(m => m._id === item.replyToId);
                const title = parent ? (parent.sender === currentUser?.username ? 'You' : parent.sender) : (item.replyFrom || 'Reply');
                const previewText = parent ? (parent.type === 'text' ? parent.content : parent.type === 'image' ? 'Photo' : parent.type === 'video' ? 'Video' : parent.type === 'audio' ? 'Voice note' : 'File') : (item.reply || '');
                return (
                  <>
                    <Text style={styles.replyTitle}>{title}:</Text>
                    <Text style={styles.replyText} numberOfLines={2}>{previewText}</Text>
                  </>
                );
              })()}
            </TouchableOpacity>
          )}

          <Text style={[
            styles.messageText,
            isOwnMessage ? styles.ownMessageText : styles.otherMessageText
          ]}>
            {item.content}
          </Text>
          
          <Text style={[
            styles.messageTime,
            isOwnMessage ? styles.ownMessageTime : styles.otherMessageTime
          ]}>
            {formatTime(item.timestamp)}
          </Text>
        </Pressable>
      </View>
      </>
    );
  };

  // Download a media file with visible progress indicator
  const [downloadingMap, setDownloadingMap] = useState<Record<string, number>>({});
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
  const guessMediaType = (m: { url: string; type?: string }): 'image' | 'video' | 'audio' | 'file' => {
    const t = (m.type || '').toLowerCase();
    if (t.startsWith('image')) return 'image';
    if (t.startsWith('video')) return 'video';
    if (t.startsWith('audio')) return 'audio';
    const ext = m.url.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif|mp4|mov|webm|mkv|mp3|m4a|aac|wav|ogg|pdf|doc|docx|ppt|pptx|xls|xlsx|txt)$/)?.[1];
    if (ext && ['jpg','jpeg','png','webp','gif'].includes(ext)) return 'image';
    if (ext && ['mp4','mov','webm','mkv'].includes(ext)) return 'video';
    if (ext && ['mp3','m4a','aac','wav','ogg'].includes(ext)) return 'audio';
    return 'file';
  };
  const handleDownload = async (file: { url: string; name?: string; type?: string }) => {
    const preferredName = (file.name && file.name.trim().length > 0) ? file.name.trim() : getFilenameFromUrl(file.url);
    const kind = guessMediaType({ url: file.url, type: file.type });
    try {
      setDownloadingMap(prev => ({ ...prev, [file.url]: 0 }));
      const token = await (apiService as any)['getAuthToken']?.();
      const needsAuth = (() => {
        try {
          const target = new URL(file.url);
          const apiOrigin = new URL((apiService as any).baseUrl || 'https://connecther.network/api').origin;
          const rootOrigin = new URL((apiService as any).rootUrl || 'https://connecther.network').origin;
          const sameHost = (target.origin === apiOrigin || target.origin === rootOrigin);
          return sameHost && target.pathname.startsWith('/api');
        } catch {
          return false;
        }
      })();
      const res = await saveMediaToDevice({
        url: file.url,
        type: kind as any,
        filename: preferredName,
        headers: needsAuth && token ? { Authorization: `Bearer ${token}` } : undefined,
        onProgress: (p) => setDownloadingMap(prev => ({ ...prev, [file.url]: p })),
      });
      if (res.success) {
        if (Platform.OS === 'android' && res.path) {
          Alert.alert('Saved', `Saved to ${res.path}`);
        } else if (Platform.OS === 'ios' && res.openedShareSheet) {
          // iOS share sheet opened; user can save to Files/Photos
        } else if (res.path) {
          Alert.alert('Saved', `Downloaded to ${res.path}`);
        }
      } else {
        Alert.alert('Download failed', res.message || 'Unable to save file');
      }
    } catch (err) {
      console.error('handleDownload error:', err);
      Alert.alert('Error', 'Failed to download file');
    } finally {
      setDownloadingMap(prev => ({ ...prev, [file.url]: 100 }));
      setTimeout(() => setDownloadingMap(prev => { const n = { ...prev }; delete n[file.url]; return n; }), 1200);
    }
  };

  // Share media via system share sheet, ensure file attachment on Android
  const handleShare = async (file: { url: string; name?: string; type?: string }) => {
    try {
      const baseName = (file.name && file.name.trim().length > 0) ? file.name.trim() : `media-${Date.now()}`;
      const guessExtFromMime = (mime?: string): string => {
        const m = (mime || '').toLowerCase();
        if (!m) return '';
        if (m === 'application/pdf') return 'pdf';
        if (m.startsWith('image/')) {
          const ext = m.split('/')[1] || 'jpg';
          return ext === 'jpeg' ? 'jpg' : ext;
        }
        if (m.startsWith('video/')) {
          const ext = m.split('/')[1] || 'mp4';
          return ext === 'quicktime' ? 'mov' : ext;
        }
        if (m.startsWith('audio/')) {
          const ext = m.split('/')[1] || 'aac';
          return ext === 'mpeg' ? 'mp3' : ext;
        }
        return '';
      };
      const guessExtFromUrl = (u: string): string => {
        try {
          const clean = u.split('?')[0];
          const parts = clean.split('.');
          const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';
          if (!ext) return '';
          const safe = ext.replace(/[^a-z0-9]/g, '');
          return safe.length > 0 && safe.length <= 5 ? safe : '';
        } catch { return ''; }
      };
      const fetchMime = async (u: string): Promise<string | null> => {
        try {
          // Conditionally include auth for same-host /api endpoints
          const token = await (apiService as any)['getAuthToken']?.();
          const needsAuth = (() => {
            try {
              const target = new URL(u);
              const apiOrigin = new URL((apiService as any).baseUrl || 'https://connecther.network/api').origin;
              const rootOrigin = new URL((apiService as any).rootUrl || 'https://connecther.network').origin;
              const sameHost = (target.origin === apiOrigin || target.origin === rootOrigin);
              return sameHost && target.pathname.startsWith('/api');
            } catch {
              return false;
            }
          })();
          const resp = await fetch(u, { method: 'HEAD', headers: needsAuth && token ? { Authorization: `Bearer ${token}` } : undefined });
          const ct = resp.headers.get('content-type');
          return ct || null;
        } catch {
          return null;
        }
      };
      const remoteMime = await fetchMime(file.url);
      const effectiveMime = (remoteMime || file.type || '');
      const ext = guessExtFromMime(effectiveMime) || guessExtFromUrl(file.url) || 'bin';
      const nameWithExt = (() => {
        const m = baseName.match(/\.([a-z0-9]+)$/i);
        if (m) {
          const currExt = m[1].toLowerCase();
          return currExt === ext ? baseName : baseName.replace(/\.[a-z0-9]+$/i, `.${ext}`);
        }
        return `${baseName}.${ext}`;
      })();

      // Download remote media to a local path first (prefer app documents to avoid scoped storage issues)
      const res = await apiService.downloadFile(file.url, nameWithExt);
      if (res?.success && res?.path) {
        const rawPath = String(res.path);
        const fsPath = rawPath.replace(/^file:\/\//, '');
        const exists = await RNFS.exists(fsPath);
        if (!exists) {
          console.warn('Downloaded file not found at path:', rawPath);
          Alert.alert('Download failed', 'File not found after download');
          return;
        }
        const localPath = Platform.OS === 'android' && !rawPath.startsWith('file://') ? `file://${fsPath}` : rawPath;
        if (Platform.OS === 'android') {
          const RNShare = require('react-native-share').default;
          const mime =
            effectiveMime ||
            (ext === 'jpg' ? 'image/jpeg' :
             ext === 'png' ? 'image/png' :
             ext === 'gif' ? 'image/gif' :
             ext === 'webp' ? 'image/webp' :
             ext === 'heic' ? 'image/heic' :
             ext === 'mp4' ? 'video/mp4' :
             ext === 'mov' ? 'video/quicktime' :
             ext === 'mp3' ? 'audio/mpeg' :
             ext === 'wav' ? 'audio/wav' :
             ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
          const shareUrl = (localPath && typeof localPath === 'string' && localPath.trim().length > 0) ? localPath : file.url;
          if (!shareUrl) {
            Alert.alert('Error', 'Invalid media URL for sharing');
            return;
          }
          try {
            await RNShare.open({ url: shareUrl, type: mime, filename: nameWithExt });
          } catch (e) {
            const emsg = String((e && (e as any).message) || e);
            if (emsg.includes('getScheme') || emsg.includes('EUNSPECIFIED')) {
              // Fallback: share as text link
              await Share.share({ message: file.url, title: file.name || 'Media' });
            } else {
              throw e;
            }
          }
        } else {
          await Share.share({ url: localPath, message: file.url, title: file.name || 'Media' });
        }
      } else {
        Alert.alert('Download failed', 'Unable to prepare file for sharing');
      }
    } catch (err) {
      const msg = String((err && (err as any).message) || err);
      if (msg.includes('User did not share') || msg.includes('E_SHARING_CANCELLED')) {
        console.log('Share cancelled by user');
      } else {
        console.error('handleShare error:', err);
        Alert.alert('Error', 'Failed to share file');
      }
    } finally {
      closeMessageActions();
    }
  };

  // Share an entire message; attach media file when available (Android)
  const shareMessage = async (msg: Message) => {
    try {
      const parts: string[] = [];
      if (msg.content && msg.content.trim().length > 0) {
        parts.push(msg.content);
      }

      // If the message contains a media file, prefer attaching it
      if (msg.file?.url) {
        const file = msg.file;
        const baseName = (file.name && file.name.trim().length > 0) ? file.name.trim() : `media-${Date.now()}`;
        const guessExtFromMime = (mime?: string): string => {
          const m = (mime || '').toLowerCase();
          if (m.startsWith('image/')) {
            const ext = m.split('/')[1] || 'jpg';
            return ext === 'jpeg' ? 'jpg' : ext;
          }
          if (m.startsWith('video/')) return (m.split('/')[1] || 'mp4');
          if (m.startsWith('audio/')) return (m.split('/')[1] || 'aac');
          if (m === 'application/pdf') return 'pdf';
          return '';
        };
        const guessExtFromUrl = (u: string): string => {
          try {
            const clean = u.split('?')[0];
            const partsUrl = clean.split('.');
            const ext = partsUrl.length > 1 ? partsUrl.pop()!.toLowerCase() : '';
            if (!ext) return '';
            const safe = ext.replace(/[^a-z0-9]/g, '');
            return safe.length > 0 && safe.length <= 5 ? safe : '';
          } catch { return ''; }
        };
        const fetchMime = async (u: string): Promise<string | null> => {
          try {
            // Conditionally include auth for same-host /api endpoints
            const token = await (apiService as any)['getAuthToken']?.();
            const needsAuth = (() => {
              try {
                const target = new URL(u);
                const apiOrigin = new URL((apiService as any).baseUrl || 'https://connecther.network/api').origin;
                const rootOrigin = new URL((apiService as any).rootUrl || 'https://connecther.network').origin;
                const sameHost = (target.origin === apiOrigin || target.origin === rootOrigin);
                return sameHost && target.pathname.startsWith('/api');
              } catch {
                return false;
              }
            })();
            const resp = await fetch(u, { method: 'HEAD', headers: needsAuth && token ? { Authorization: `Bearer ${token}` } : undefined });
            const ct = resp.headers.get('content-type');
            return ct || null;
          } catch {
            return null;
          }
        };
        const remoteMime = await fetchMime(file.url);
        const effectiveMime = (remoteMime || file.type || '');
        const ext = guessExtFromMime(effectiveMime) || guessExtFromUrl(file.url) || 'bin';
        const nameWithExt = (() => {
          const m = baseName.match(/\.([a-z0-9]+)$/i);
          if (m) {
            const currExt = m[1].toLowerCase();
            return currExt === ext ? baseName : baseName.replace(/\.[a-z0-9]+$/i, `.${ext}`);
          }
          return `${baseName}.${ext}`;
        })();

        const res = await apiService.downloadFile(file.url, nameWithExt);
        if (res?.success && res?.path) {
          const rawPath = String(res.path);
          const fsPath = rawPath.replace(/^file:\/\//, '');
          const localPath = Platform.OS === 'android' && !rawPath.startsWith('file://') ? `file://${fsPath}` : rawPath;
          if (Platform.OS === 'android') {
            const RNShare = require('react-native-share').default;
            const mime =
              effectiveMime ||
              (ext === 'jpg' ? 'image/jpeg' :
               ext === 'png' ? 'image/png' :
               ext === 'gif' ? 'image/gif' :
               ext === 'webp' ? 'image/webp' :
               ext === 'heic' ? 'image/heic' :
               ext === 'mp4' ? 'video/mp4' :
               ext === 'mov' ? 'video/quicktime' :
               ext === 'mp3' ? 'audio/mpeg' :
               ext === 'wav' ? 'audio/wav' :
               ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');
            await RNShare.open({ url: localPath, type: mime, filename: nameWithExt, message: parts.join('\n') });
            return;
          } else {
            await Share.share({ url: localPath, title: file.name || 'Media', message: parts.join('\n') });
            return;
          }
        }
        // If we couldn't prepare file, fall back to sharing text + link
        parts.push(file.url);
      }

      const payload: any = { message: parts.join('\n') || 'Shared message' };
      if (Platform.OS === 'ios' && msg.file?.url) {
        payload.url = msg.file.url;
        payload.title = msg.file?.name || 'Media';
      } else {
        payload.title = (msg.type === 'text') ? 'Message' : (msg.file?.name || 'Media');
      }
      await Share.share(payload);
    } catch (err) {
      const msg = String((err && (err as any).message) || err);
      if (msg.includes('User did not share') || msg.includes('E_SHARING_CANCELLED')) {
        console.log('shareMessage: user cancelled share');
      } else {
        console.error('shareMessage error:', err);
      }
    } finally {
      closeMessageActions();
    }
  };

  // Copy message text or fallback to file URL
  const copyMessage = (msg: Message) => {
    try {
      const text = (msg.content && msg.content.trim().length > 0)
        ? msg.content
        : (msg.file?.url || '');
      if (!text) {
        Alert.alert('Nothing to copy');
        return;
      }
      Clipboard.setString(text);
      Alert.alert('Copied', 'Content copied to clipboard');
    } catch (err) {
      console.error('copyMessage error:', err);
    } finally {
      closeMessageActions();
    }
  };

  const renderTypingIndicator = () => {
    if (!recipientTyping) return null;
    
    return (
      <View style={[styles.messageContainer, styles.otherMessage]}>
        <View style={[styles.messageBubble, styles.otherBubble, { flexDirection: 'row', alignItems: 'center' }]}>
          <RecordingWaveform active={true} barCount={5} width={40} height={16} color={colors.textMuted} />
          <Text style={[styles.typingText, { marginLeft: 8 }]}>typing…</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={globalStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}>
      {/* Deep pink themed chat background with girly music icons */}
      <View style={styles.chatBackgroundOverlay} pointerEvents="none">
        <View style={styles.chatBackgroundTint} />
        <View style={styles.chatIconGrid}>
          <FAIcon name="music" size={56} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.08, transform: [{ rotate: '6deg' }] }]} />
          <FAIcon name="headphones" size={52} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.07, transform: [{ rotate: '-8deg' }] }]} />
          <FAIcon name="compact-disc" size={50} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.08, transform: [{ rotate: '12deg' }] }]} />
          <FAIcon name="microphone" size={52} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.08, transform: [{ rotate: '-12deg' }] }]} />
          <FAIcon name="heart" size={54} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.07, transform: [{ rotate: '10deg' }] }]} />
          <FAIcon name="star" size={48} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.06, transform: [{ rotate: '-6deg' }] }]} />
          {/* repeat set for fuller background coverage */}
          <FAIcon name="music" size={40} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.06, transform: [{ rotate: '-4deg' }] }]} />
          <FAIcon name="headphones" size={44} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.06, transform: [{ rotate: '8deg' }] }]} />
          <FAIcon name="compact-disc" size={42} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.06, transform: [{ rotate: '-10deg' }] }]} />
          <FAIcon name="microphone" size={44} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.06, transform: [{ rotate: '12deg' }] }]} />
          <FAIcon name="heart" size={40} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.06, transform: [{ rotate: '-6deg' }] }]} />
          <FAIcon name="star" size={38} color="#ffffff" style={[styles.chatBgIcon, { opacity: 0.05, transform: [{ rotate: '6deg' }] }]} />
        </View>
      </View>
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { Keyboard.dismiss(); setShowEmojiPanel(false); navigation.goBack(); }}>
          <Icon name="arrow-back" size={24} color="#E9EDEF" />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.headerInfo}
          onPress={() => navigation.navigate('Profile' as never, {username: recipientUsername} as never)}>
          <View style={styles.headerAvatarContainer}>
            <Image source={{uri: (recipientAvatar && recipientAvatar.trim()) ? recipientAvatar : 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png'}} style={styles.headerAvatar} />
            <View style={[styles.headerOnlineIndicator, !isOnline && { backgroundColor: colors.textMuted }]} />
          </View>
          <View>
            <Text style={styles.headerName}>{recipientName}</Text>
            <Text style={styles.headerStatus}>
              {isOnline ? 'Online now' : headerStatus}
            </Text>
          </View>
        </TouchableOpacity>
        
        <View style={globalStyles.flexRow}>
          <TouchableOpacity
            style={{ marginRight: 12 }}
            onPress={async () => {
              try {
                const stored = await AsyncStorage.getItem('currentUser');
                const me = stored ? JSON.parse(stored) : null;
                const caller = me?.username || '';
                // Trigger server-side call log + FCM wake for receiver
                try {
                  await apiService.post('/calls', { caller, receiver: recipientUsername, status: 'ringing', type: 'video' });
                } catch (_) {}
                // Emit start-call to ensure incoming notification & call state
                try {
                  socketService.startCall({ from: caller, to: recipientUsername, callType: 'video' });
                } catch (_) {}
              } catch (_) {}
              navigation.navigate('Call' as never, { to: recipientUsername, type: 'video', mode: 'caller' } as never);
            }}
          >
            <Icon name="videocam" size={24} color="#E9EDEF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginRight: 12 }}
            onPress={async () => {
              try {
                const stored = await AsyncStorage.getItem('currentUser');
                const me = stored ? JSON.parse(stored) : null;
                const caller = me?.username || '';
                // Trigger server-side call log + FCM wake for receiver
                try {
                  await apiService.post('/calls', { caller, receiver: recipientUsername, status: 'ringing', type: 'audio' });
                } catch (_) {}
                // Emit start-call to ensure incoming notification & call state
                try {
                  socketService.startCall({ from: caller, to: recipientUsername, callType: 'audio' });
                } catch (_) {}
              } catch (_) {}
              navigation.navigate('Call' as never, { to: recipientUsername, type: 'audio', mode: 'caller' } as never);
            }}
          >
            <Icon name="call" size={24} color="#E9EDEF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(prev => !prev)}>
            <Icon name="more-vert" size={24} color="#E9EDEF" />
          </TouchableOpacity>
          {showMenu && (
            <View style={styles.headerMenu}>
              <TouchableOpacity style={styles.headerMenuItem} onPress={handleDeleteChat}>
                <Icon name="delete" size={18} color={colors.text} />
                <Text style={styles.headerMenuText}>Clear Chat</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Full-screen video preview modal */}
      {previewVideoUrl && (
        <Modal visible={!!previewVideoUrl} transparent={true} onRequestClose={() => setPreviewVideoUrl(null)}>
          <View style={styles.fullscreenOverlay}>
            <Video
              source={{ uri: previewVideoUrl }}
              style={styles.fullscreenVideo}
              controls={true}
              resizeMode="contain"
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setPreviewVideoUrl(null)}>
              <Icon name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item._id}
        renderItem={renderMessage}
        style={[styles.messagesList]}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 12 }}
        onContentSizeChange={scrollToBottomOnce}
        onScrollBeginDrag={() => setShowScrollControls(true)}
        onMomentumScrollEnd={() => setTimeout(() => setShowScrollControls(false), 1500)}
        onScroll={() => setShowScrollControls(true)}
        ListFooterComponent={renderTypingIndicator}
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
      />

      {/* Scroll controls (appear only when user is scrolling) */}
      {showScrollControls && (
        <View style={styles.scrollControls} pointerEvents="box-none">
          <TouchableOpacity style={styles.scrollBtn} onPress={() => flatListRef.current?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 })}>
            <Icon name="keyboard-arrow-up" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.scrollBtn} onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}>
            <Icon name="keyboard-arrow-down" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Incoming Call Modal */}
      <IncomingCallModal
        visible={incomingVisible}
        callerName={incomingCaller || recipientName}
        callerAvatar={incomingAvatar || recipientAvatar}
        callType={incomingType}
        onAccept={() => {
          setIncomingVisible(false);
          try {
            socketService.acceptCall({ from: currentUser?.username, to: incomingCaller || recipientUsername });
          } catch (_) {}
          (navigation as any).navigate('Call', { to: incomingCaller || recipientUsername, type: incomingType, mode: 'callee' });
        }}
        onDecline={() => {
          setIncomingVisible(false);
          try {
            socketService.rejectCall({ from: currentUser?.username, to: incomingCaller || recipientUsername });
          } catch (_) {}
        }}
      />

      {/* Reply/Edit banner above input */}
      {(editingId || replyingTo) && (
        <View style={styles.composeBanner}>
          <View style={styles.composeBannerLeft}>
            {editingId ? (
              <Text style={styles.composeBannerTitle}>Editing message</Text>
            ) : replyingTo ? (
              <Text style={styles.composeBannerTitle} numberOfLines={1}>
                Replying to: {replyingTo.content}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={clearComposeContext}>
            <Icon name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Forward modal */}
      {showForwardModal && (
        <View style={styles.forwardModalOverlay}>
          <View style={styles.forwardModal}>
            <Text style={styles.forwardTitle}>Forward message</Text>
            <TextInput
              style={styles.forwardInput}
              placeholder="Search friends"
              placeholderTextColor={colors.textMuted}
              value={forwardSearch}
              onChangeText={setForwardSearch}
            />
            <View style={styles.forwardList}>
              {forwardLoading ? (
                <Text style={styles.forwardLoading}>Loading friends...</Text>
              ) : (
                <FlatList
                  data={forwardFriends.filter(f => (f.username || '').toLowerCase().includes(forwardSearch.toLowerCase()) || (f.name || '').toLowerCase().includes(forwardSearch.toLowerCase()))}
                  keyExtractor={item => item.username}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.forwardItem} onPress={() => selectForwardTarget(item.username)}>
                      <Image source={{ uri: item.avatar || 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png' }} style={styles.forwardAvatar} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.forwardName}>{item.name || item.username}</Text>
                        <Text style={styles.forwardUsername}>@{item.username}</Text>
                      </View>
                      <Icon name="send" size={20} color={colors.text} />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={<Text style={styles.forwardLoading}>No friends found</Text>}
                />
              )}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
              <TouchableOpacity style={styles.forwardCancel} onPress={() => setShowForwardModal(false)}>
                <Text style={{ color: '#000' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Message actions modal */}
      {actionsMessage && (
        <View style={styles.actionsOverlay}>
          <View style={styles.actionsContainer}>
            <Text style={styles.actionsTitle}>Message options</Text>
            <TouchableOpacity style={styles.actionsItem} onPress={() => { startReply(actionsMessage); closeMessageActions(); }}>
              <Icon name="reply" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Reply</Text>
            </TouchableOpacity>
            {actionsMessage.type === 'text' && actionsMessage.sender === currentUser?.username && (
              <TouchableOpacity style={styles.actionsItem} onPress={() => { startEdit(actionsMessage); closeMessageActions(); }}>
                <Icon name="edit" size={18} color={colors.text} />
                <Text style={styles.actionsText}>Edit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionsItem} onPress={() => copyMessage(actionsMessage)}>
              <Icon name="content-copy" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionsItem} onPress={() => shareMessage(actionsMessage)}>
              <Icon name="share" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionsItem} onPress={() => { beginForward(actionsMessage); closeMessageActions(); }}>
              <Icon name="send" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Forward</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionsItem} onPress={() => { toggleStar(actionsMessage._id); closeMessageActions(); }}>
              <Icon name="star" size={18} color={colors.text} />
              <Text style={styles.actionsText}>{starredIds.includes(actionsMessage._id) ? 'Unstar' : 'Star'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionsItem} onPress={() => { deleteForMe(actionsMessage); closeMessageActions(); }}>
              <Icon name="delete" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Delete for me</Text>
            </TouchableOpacity>
            {actionsMessage.sender === currentUser?.username && (
              <TouchableOpacity style={styles.actionsItem} onPress={() => { deleteForEveryone(actionsMessage); closeMessageActions(); }}>
                <Icon name="delete-forever" size={18} color={colors.text} />
                <Text style={styles.actionsText}>Delete for everyone</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionsItem, { justifyContent: 'center' }]} onPress={closeMessageActions}>
              <Text style={[styles.actionsText, { color: colors.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Media Picker Modal */}
      {showMediaPickerModal && (
        <View style={styles.actionsOverlay}>
          <View style={styles.actionsContainer}>
            <Text style={styles.actionsTitle}>Select Media</Text>
            <TouchableOpacity style={styles.actionsItem} onPress={() => { setShowMediaPickerModal(false); openCamera(); }}>
              <Icon name="photo-camera" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionsItem} onPress={() => { setShowMediaPickerModal(false); openGallery(); }}>
              <Icon name="photo-library" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionsItem} onPress={() => { setShowMediaPickerModal(false); openDocumentPicker(); }}>
              <Icon name="insert-drive-file" size={18} color={colors.text} />
              <Text style={styles.actionsText}>Document</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionsItem, { justifyContent: 'center' }]} onPress={() => setShowMediaPickerModal(false)}>
              <Text style={[styles.actionsText, { color: colors.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <TouchableOpacity 
          style={styles.attachButton}
          onPress={handleMediaPicker}>
          <Icon name="attach-file" size={24} color="#8696A0" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.attachButton}
          onPress={() => setShowEmojiPanel(prev => !prev)}>
          <Icon name="emoji-emotions" size={24} color="#8696A0" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.attachButton}
          onPress={isRecording ? stopRecording : startRecording}
        >
          <Icon name={isRecording ? 'stop-circle' : 'mic'} size={24} color="#8696A0" />
        </TouchableOpacity>
        
        <TextInput
          style={styles.textInput}
          placeholder="Type a message..."
          placeholderTextColor={colors.textMuted}
          value={messageText}
          onChangeText={handleTyping}
          multiline
          maxLength={1000}
        />
        
        <TouchableOpacity 
          style={[styles.sendButton, (messageText.trim() || pendingMedia.length > 0) && styles.sendButtonActive]}
          onPress={handleSendMessage}
          disabled={!messageText.trim() && pendingMedia.length === 0}>
          <Icon 
            name="send" 
            size={20} 
            color={(messageText.trim() || pendingMedia.length > 0) ? '#E9EDEF' : '#8696A0'} 
          />
        </TouchableOpacity>
      </View>

      {pendingMedia.length > 0 && (
        <View style={styles.pendingPanel}>
          <Text style={styles.pendingTitle}>Selected media</Text>
          <View style={styles.pendingList}>
            {pendingMedia.map((m, idx) => (
              <View key={`${m.uri}-${idx}`} style={styles.pendingItem}>
                {m.type?.startsWith('image/') ? (
                  <Image source={{ uri: m.uri }} style={styles.pendingThumb} />
                ) : (
                  <View style={styles.pendingThumbIcon}>
                    <Icon name={m.type?.startsWith('video/') ? 'videocam' : m.type?.startsWith('audio/') ? 'audiotrack' : 'insert-drive-file'} size={28} color={colors.text} />
                    <Text style={styles.pendingName} numberOfLines={1}>{m.name || 'file'}</Text>
                  </View>
                )}
                {typeof uploadProgress[m.uri] === 'number' && (
                  <View style={styles.pendingProgressOverlay}>
                    <Text style={styles.pendingProgressText}>{uploadProgress[m.uri]}%</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.pendingRemove} onPress={() => setPendingMedia(prev => prev.filter((_, i) => i !== idx))}>
                  <Icon name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <TextInput
            style={styles.pendingCaption}
            placeholder="Add a caption..."
            placeholderTextColor={colors.textMuted}
            value={pendingCaption}
            onChangeText={setPendingCaption}
            multiline
          />
          <View style={styles.pendingActions}>
            <TouchableOpacity style={styles.pendingCancel} onPress={() => { setPendingMedia([]); setPendingCaption(''); }}>
              <Text style={styles.pendingActionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pendingSend} onPress={handleSendMessage}>
              <Text style={styles.pendingActionText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {isRecording && (
        <View style={styles.recordBar}>
          <Text style={styles.recordText}>Recording {formatRecordTime(recordTimeMs)}</Text>
          <View style={styles.recordActions}>
            <TouchableOpacity style={styles.recordSend} onPress={sendVoiceNote}>
              <Icon name="send" size={20} color="#E9EDEF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.recordCancel} onPress={cancelRecording}>
              <Icon name="close" size={20} color="#E9EDEF" />
            </TouchableOpacity>
          </View>
        </View>
      )}
      {showEmojiPanel && (
        <View style={styles.emojiPanel}>
          {emojis.map(e => (
            <TouchableOpacity key={e} style={styles.emojiItem} onPress={() => handleEmojiSelect(e)}>
              <Text style={{fontSize: 24}}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 10,
    backgroundColor: '#0B141A',
    borderBottomWidth: 1,
    borderBottomColor: '#0B141A',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    // Ensure header and its overlays (menu) sit above message bubbles
    zIndex: 10000,
    elevation: 16,
  },
  headerInfo: {
    ...globalStyles.flexRow,
    flex: 1,
    marginLeft: 15,
  },
  headerAvatarContainer: {
    position: 'relative',
    marginRight: 10,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerOnlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: '#0B141A',
  },
  headerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E9EDEF',
  },
  headerStatus: {
    fontSize: 12,
    color: '#8696A0',
  },
  messagesList: {
    flex: 1,
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
  },
  dayDivider: {
    alignSelf: 'center',
    backgroundColor: '#0B141A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginVertical: 8,
  },
  dayDividerText: {
    color: '#E9EDEF',
    fontSize: 12,
    textAlign: 'center',
  },
  messageContainer: {
    marginVertical: 2,
  },
  ownMessage: {
    alignItems: 'flex-end',
  },
  otherMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 18,
    overflow: 'visible',
  },
  forwardedTag: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 6,
  },
  highlightBubble: {
    borderWidth: 1,
    borderColor: '#00bfff',
    backgroundColor: 'rgba(0, 191, 255, 0.08)'
  },
  ownBubble: {
    backgroundColor: '#005C4B',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#202C33',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  ownMessageText: {
    color: '#E9EDEF',
  },
  otherMessageText: {
    color: '#E9EDEF',
  },
  messageTime: {
    fontSize: 11,
    marginTop: 4,
  },
  ownMessageTime: {
    color: '#8696A0',
    textAlign: 'right',
  },
  otherMessageTime: {
    color: '#8696A0',
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginBottom: 5,
  },
  mediaActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    alignItems: 'center',
  },
  mediaActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#2A3942',
  },
  mediaActionText: {
    marginLeft: 6,
    color: '#E9EDEF',
    fontSize: 13,
  },
  videoContainer: {
    width: 200,
    height: 150,
    backgroundColor: colors.background,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
  },
  fileContainer: {
    ...globalStyles.flexRow,
    alignItems: 'center',
    marginBottom: 5,
  },
  fileName: {
    color: colors.text,
    marginLeft: 8,
    fontSize: 14,
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
    gap: 12,
  },
  audioPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2A3942',
    alignItems: 'center',
    justifyContent: 'center',
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
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A3942',
    overflow: 'hidden',
    marginBottom: 4,
  },
  audioProgress: {
    height: 4,
    backgroundColor: '#00A884',
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
    color: colors.text,
    fontSize: 12,
    marginTop: 2,
  },
  typingText: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  inputContainer: {
    ...globalStyles.flexRow,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 10,
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderTopColor: '#26353B',
    alignItems: 'flex-end',
  },
  attachButton: {
    padding: 8,
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2A3942',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    color: '#E9EDEF',
    fontSize: 16,
    maxHeight: 100,
    backgroundColor: '#2A3942',
  },
  sendButton: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 20,
  },
  sendButtonActive: {
    backgroundColor: '#00A884',
  },
  emojiPanel: {
    ...globalStyles.flexRow,
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#202C33',
    borderTopWidth: 1,
    borderTopColor: '#26353B',
  },
  // Pending media panel styles
  pendingPanel: {
    ...globalStyles.paddingHorizontal,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pendingList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  pendingThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  pendingThumbIcon: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 2,
  },
  pendingProgressOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  pendingSend: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  forwardModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  forwardModal: {
    width: '92%',
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
  },
  forwardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  forwardInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    marginBottom: 8,
  },
  forwardList: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 4,
  },
  forwardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  forwardAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
    backgroundColor: colors.secondary,
  },
  forwardName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  forwardUsername: {
    color: colors.textMuted,
    fontSize: 12,
  },
  forwardLoading: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 10,
  },
  forwardCancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    marginRight: 8,
  },
  forwardSend: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  emojiItem: {
    padding: 8,
    marginRight: 6,
    marginBottom: 6,
    borderRadius: 8,
    backgroundColor: colors.secondary,
  },
  starBadge: {
    position: 'absolute',
    top: 6,
    right: 10,
    backgroundColor: 'transparent',
  },
  bubbleActions: {
    position: 'absolute',
    top: 6,
    right: 6,
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  replyPreview: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#00bfff',
    backgroundColor: 'rgba(0, 191, 255, 0.08)',
    maxWidth: '100%',
  },
  replyTitle: {
    color: '#00bfff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyText: {
    color: colors.text,
    fontSize: 13,
  },
  scrollControls: {
    position: 'absolute',
    right: 16,
    bottom: 90,
    flexDirection: 'column',
    gap: 8,
    zIndex: 1000,
  },
  scrollBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
    zIndex: 1000,
  },
  actionsContainer: {
    backgroundColor: colors.surface,
    padding: 12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  actionsTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  actionsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionsText: {
    marginLeft: 8,
    color: colors.text,
    fontSize: 14,
  },
  headerMenu: {
    position: 'absolute',
    top: 50,
    right: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    minWidth: 160,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 24,
    zIndex: 20000,
  },
  headerMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerMenuText: {
    marginLeft: 8,
    color: colors.text,
  },
  videoContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginTop: 6,
  },
  videoPreview: {
    width: '100%',
    height: '100%',
  },
  videoOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenVideo: {
    width: '100%',
    height: '80%',
    backgroundColor: '#000',
  },
  modalClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 24,
  },
  composeBanner: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  composeBannerLeft: {
    ...globalStyles.flexRow,
    alignItems: 'center',
    flex: 1,
  },
  composeBannerTitle: {
    color: colors.text,
    fontSize: 13,
  },
  recordBar: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  recordText: {
    color: colors.text,
    fontSize: 14,
  },
  recordActions: {
    ...globalStyles.flexRow,
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
    backgroundColor: colors.secondary,
  },
  // Chat background styles
  chatBackgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  chatBackgroundTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
  chatIconGrid: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 20,
    paddingVertical: 30,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'space-around',
    justifyContent: 'space-around',
  },
  chatBgIcon: {
    margin: 12,
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

export default ConversationScreen;
