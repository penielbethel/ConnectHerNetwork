import React, {useState, useEffect, useCallback, useRef, useContext} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Animated,
  Easing,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Dimensions,
  FlatList,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Video from 'react-native-video';
import { Share } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

import DocumentPicker from 'react-native-document-picker';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import FAIcon from 'react-native-vector-icons/FontAwesome5';
import { getFlagEmojiForLocation } from '../utils/flags';
import { debounce } from 'lodash';
import apiService from '../services/ApiService';
import socketService from '../services/SocketService';
import {colors, globalStyles} from '../styles/globalStyles';
import LinkedText from '../components/LinkedText';
import { ThemeContext } from '../context/ThemeContext';
import SoundService from '../services/SoundService';

const DashboardScreen = () => {
  const [showMediaPickerModal, setShowMediaPickerModal] = React.useState(false);
  const [authorRoles, setAuthorRoles] = React.useState<Record<string, string>>({});

  // Theme
  const { theme } = useContext(ThemeContext);
  const navigation = useNavigation();

  // Screen dimensions for media layout
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;
  const mediaWidth = Math.round(screenWidth * 0.8);
const [successSoundUrl, setSuccessSoundUrl] = React.useState<string | null>(null);

const audioPlayerRef = React.useRef<AudioRecorderPlayer | null>(null);
const playSuccessSound = async () => {
  const candidates = ['deliver.MP3', 'deliver.mp3', 'notify.mp3', 'connectring.mp3'];
  try {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new AudioRecorderPlayer();
    }
    const player = audioPlayerRef.current!;
    try {
      await player.stopPlayer();
      player.removePlayBackListener();
    } catch (_) {}

    for (const name of candidates) {
      const url = apiService.normalizeAvatar(name);
      try {
        await player.startPlayer(url);
        try { await player.setVolume(1.0); } catch (_) {}
        player.addPlayBackListener((e: any) => {
          const pos = e?.currentPosition || 0;
          const dur = e?.duration || 0;
          if (pos >= dur && dur > 0) {
            try { player.stopPlayer(); } catch (_) {}
            try { player.removePlayBackListener(); } catch (_) {}
          }
        });
        return; // audio success
      } catch (err) {
        console.warn('playSuccessSound candidate failed', name, err);
        try { await player.stopPlayer(); } catch (_) {}
        try { player.removePlayBackListener(); } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('playSuccessSound failed', err);
  }

  // Fallback: play via hidden Video element to ensure success
  try {
    const url = apiService.normalizeAvatar(candidates[0]);
    setSuccessSoundUrl(url);
  } catch (e) {
    console.warn('fallback video play failed', e);
  }
};

  // Feed and user state
  const [posts, setPosts] = React.useState<Post[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const logoSpin = React.useRef(new Animated.Value(0)).current;
  const spinLoopRef = React.useRef<Animated.CompositeAnimation | null>(null);
  const spin = logoSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const logoSource = require('../../public/logo.png');
  const [currentUser, setCurrentUser] = React.useState<any>(null);
  const [suggestedUsers, setSuggestedUsers] = React.useState<any[]>([]);
  const [isFirstTimeUser, setIsFirstTimeUser] = React.useState(false);
  const [showWelcomeBanner, setShowWelcomeBanner] = React.useState(false);

  // UI state
  const [showQuickMenu, setShowQuickMenu] = React.useState(false);
  const [imagePreviewSource, setImagePreviewSource] = React.useState<string | null>(null);
  const [imagePreviewVisible, setImagePreviewVisible] = React.useState(false);
  const [mediaPreviewVisible, setMediaPreviewVisible] = React.useState(false);
  const [previewPost, setPreviewPost] = React.useState<Post | null>(null);
  const [previewIndex, setPreviewIndex] = React.useState(0);
  const [originalPostsById, setOriginalPostsById] = React.useState<Record<string, Post>>({});
  const [isPosting, setIsPosting] = React.useState(false);
  const [isResharing, setIsResharing] = React.useState(false);

  // Composer state
  const [newPostContent, setNewPostContent] = React.useState('');
  const [newPostFiles, setNewPostFiles] = React.useState<Array<{ url: string; type?: string; name?: string; thumbnailUrl?: string }>>([]);
  const [mentionResults, setMentionResults] = React.useState<any[]>([]);
  const [showMentionSuggestions, setShowMentionSuggestions] = React.useState(false);
  const [mentionQuery, setMentionQuery] = React.useState('');
  const [composerFocused, setComposerFocused] = React.useState(false);
  const [showComposer, setShowComposer] = React.useState(false);
  const [uploadingMedia, setUploadingMedia] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);

  // Post UI state
  const [expandedCaptions, setExpandedCaptions] = React.useState<Record<string, boolean>>({});
  const [expandedComments, setExpandedComments] = React.useState<Record<string, boolean>>({});
  const [commentTextByPost, setCommentTextByPost] = React.useState<Record<string, string>>({});
  const [submittingCommentByPost, setSubmittingCommentByPost] = React.useState<Record<string, boolean>>({});

  // Reshare state
  const [resharingPost, setResharingPost] = React.useState<Post | null>(null);
  const [reshareCaption, setReshareCaption] = React.useState('');
  const [reshareModalVisible, setReshareModalVisible] = React.useState(false);

  // Saves and notifications
  const [savedPostIds, setSavedPostIds] = React.useState<Set<string>>(new Set());
  const [hasNewNotif, setHasNewNotif] = React.useState(false);

  // Edit post state
  const [editModalVisible, setEditModalVisible] = React.useState(false);
  const [editingPostId, setEditingPostId] = React.useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = React.useState('');

  const handleAddFriend = async (u: string) => {
    try {
      await apiService.addFriend(u);
    } catch (error) {
      console.error('Error adding friend:', error);
    }
  };

  React.useEffect(() => {
    const loadRoles = async () => {
      try {
        const usernames = Array.from(
          new Set((posts || []).map(p => p?.author?.username).filter(Boolean))
        ) as string[];
        if (usernames.length === 0) return;
        const fetched = await Promise.all(
          usernames.map(async (u) => {
            try {
              const user = await apiService.getUserByUsername(u);
              const role: string = String((user as any)?.role || '').toLowerCase();
              return { u, role };
            } catch (_e) {
              return { u, role: '' };
            }
          })
        );
        setAuthorRoles(prev => {
          const next: Record<string, string> = { ...prev };
          for (const { u, role } of fetched) {
            if (u) next[u] = role;
          }
          return next;
        });
      } catch (_err) {
        // ignore role enrichment failures
      }
    };
    if (posts && posts.length > 0) loadRoles();
  }, [posts]);

  // Auto-hide quick options menu after 3 seconds of inactivity
  useEffect(() => {
    if (showQuickMenu) {
      const timer = setTimeout(() => setShowQuickMenu(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showQuickMenu]);

  const getAvatarUri = (uri?: string) => {
    if (uri && uri.trim()) return uri;
    return 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png';
  };

  const deriveVideoThumbnail = (url: string): string | undefined => {
    try {
      const u = new URL(url);
      if (!u.hostname.includes('res.cloudinary.com')) return undefined;
      return url.replace(/\.[a-z0-9]+$/i, '.jpg');
    } catch (_e) {
      return undefined;
    }
  };

  const openImagePreview = (url: string) => {
    setImagePreviewSource(url);
    setImagePreviewVisible(true);
  };

  const closeImagePreview = () => {
    setImagePreviewVisible(false);
    setImagePreviewSource(null);
  };

  const openMediaPreview = (post: Post, startIndex: number) => {
    setPreviewPost(post);
    setPreviewIndex(startIndex);
    setMediaPreviewVisible(true);
  };

  const handleMentionPress = async (query: string) => {
    try {
      const results = await apiService.searchUsers(query);
      const users: any[] = (results as any)?.users || (Array.isArray(results) ? results : []);
      const match = users.find(u => (u?.username || '').toLowerCase() === query.toLowerCase()) || users[0];
      const username = match?.username || query;
      navigation.navigate('Profile' as never, { username } as never);
    } catch (e) {
      navigation.navigate('Profile' as never, { username: query } as never);
    }
  };

  const closeMediaPreview = () => {
    setMediaPreviewVisible(false);
    setPreviewPost(null);
    setPreviewIndex(0);
  };

  // Ensure preview starts on the tapped media without white screen
  const previewListRef = useRef<FlatList<any>>(null);
  useEffect(() => {
    if (mediaPreviewVisible) {
      // Scroll after modal mounts to avoid initialScrollIndex rendering issues
      requestAnimationFrame(() => {
        try {
          previewListRef.current?.scrollToIndex({ index: previewIndex, animated: false });
        } catch (_e) {
          previewListRef.current?.scrollToOffset({ offset: previewIndex * screenWidth, animated: false });
        }
      });
    }
  }, [mediaPreviewVisible, previewIndex]);

  // Derive a friendly display name for greeting
  const getDisplayName = (user: any) => {
    if (!user) return '';
    if (user.name && user.name.trim()) return user.name.trim();
    const first = (user.firstName || '').trim();
    const last = (user.surname || '').trim();
    if (first && last) return `${first} ${last}`;
    if (first) return first;
    if (last) return last;
    return user.username || '';
  };

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

  const loadPosts = async () => {
    try {
      const data = await apiService.getPosts();
      // Support both array and { posts: [...] } shapes
      const list = Array.isArray(data) ? data : (data as any)?.posts || [];
      setPosts(list);

      // Prefetch originals for reshares
      const originalIds = Array.from(
        new Set(list.map(p => (p as any)?.originalPostId).filter(Boolean))
      );
      if (originalIds.length) {
        try {
          const results = await Promise.all(
            originalIds.map(id =>
              apiService.getPost(String(id)).catch(() => null)
            )
          );
          setOriginalPostsById(prev => {
            const next: Record<string, Post> = { ...prev };
            results.forEach(res => {
              const postObj = res && (res as any).post ? (res as any).post : res;
              if (postObj && (postObj as any)._id) {
                next[String((postObj as any)._id)] = postObj as Post;
              }
            });
            return next;
          });
        } catch (e) {
          // ignore prefetch errors
        }
      }
    } catch (error) {
      console.error('Error loading posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupSocketListeners = () => {
    const socket = socketService.getSocket();
    if (socket) {
      socket.on('new-post', (post: Post) => {
        setPosts(prevPosts => [post, ...prevPosts]);
      });

      socket.on('post-liked', (data: {postId: string; likes: string[]}) => {
        setPosts(prevPosts =>
          prevPosts.map(post =>
            post._id === data.postId ? {...post, likes: data.likes} : post
          )
        );
      });

      // Prevent duplicate bindings if setup runs multiple times
      socket.off('post-deleted');
      // Remove post when server broadcasts deletion
      socket.on('post-deleted', (data: { postId: string }) => {
        setPosts(prevPosts => prevPosts.filter(p => p._id !== data.postId));
      });

      // Refresh suggestions when server notifies
      socket.on('refresh-suggestions', () => {
        loadSuggestions();
      });

      // Show notification dot on any new notification
      socket.on('new-notification', () => {
        setHasNewNotif(true);
      });
    }
  };

  // Initialize current user, posts, and sockets on mount
  useEffect(() => {
    loadCurrentUser();
    loadPosts();
    setupSocketListeners();
  }, []);

  // Cleanup socket listeners on unmount to avoid memory leaks and duplicates
  useEffect(() => {
    const socket = socketService.getSocket();
    return () => {
      socket?.off('post-deleted');
    };
  }, []);

  // Load suggestions or popular list for first-time users
  useEffect(() => {
    const checkAndLoad = async () => {
      if (!currentUser?.username) return;
      try {
        const key = `firstTimeUser:${currentUser.username}`;
        const flag = await AsyncStorage.getItem(key);
        const isFirst = flag === 'true';
        setIsFirstTimeUser(isFirst);
        setShowWelcomeBanner(isFirst);
        if (isFirst) {
          await loadPopularSuggestions();
        } else {
          await loadSuggestions();
        }
      } catch (_e) {
        await loadSuggestions();
      }
    };
    checkAndLoad();
  }, [currentUser?.username]);

  const onRefresh = async () => {
    setRefreshing(true);
    logoSpin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(logoSpin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spinLoopRef.current = loop;
    loop.start();

    try {
      await loadPosts();
    } finally {
      spinLoopRef.current?.stop();
      logoSpin.stopAnimation(() => logoSpin.setValue(0));
      setRefreshing(false);
    }
  };

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) {
      Alert.alert('Error', 'Please enter some content for your post');
      return;
    }

    setIsPosting(true);
    try {
      const response = await apiService.createPost({
        content: newPostContent,
        files: newPostFiles,
      });

      if (response.success) {
        setNewPostContent('');
        setNewPostFiles([]);
        setShowComposer(false);
        await loadPosts(); // Refresh posts
        playSuccessSound();
setTimeout(() => Alert.alert('Success', 'Your post has been published'), 200);
      } else {
        Alert.alert('Error', 'Failed to create post');
      }
    } catch (error) {
      console.error('Error creating post:', error);
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  const updateMentionSuggestions = useCallback(
    debounce(async (query: string) => {
      if (!query || query.length < 1) {
        setMentionResults([]);
        setShowMentionSuggestions(false);
        return;
      }
      try {
        const results = await apiService.searchUsers(query);
        setMentionResults(results?.users || results || []);
        setShowMentionSuggestions(true);
      } catch (err) {
        console.warn('Mention search error:', err);
      }
    }, 250),
    []
  );

  const handleComposerChange = (text: string) => {
    setNewPostContent(text);
    const match = text.match(/@([a-zA-Z0-9_]{1,30})$/);
    if (match && composerFocused) {
      const q = match[1];
      setMentionQuery(q);
      updateMentionSuggestions(q);
    } else {
      setMentionQuery('');
      setShowMentionSuggestions(false);
    }
  };

  const insertMention = (user: User) => {
    const newText = newPostContent.replace(/@([a-zA-Z0-9_]{1,30})$/, `@${user.username} `);
    setNewPostContent(newText);
    setShowMentionSuggestions(false);
  };

  const uploadAsset = async (file: { uri: string; type?: string; fileName?: string; name?: string }) => {
    try {
      setUploadingMedia(true);
      const kind: 'image' | 'video' | 'audio' | 'document' =
        file.type?.startsWith('image/') ? 'image' :
        file.type?.startsWith('video/') ? 'video' :
        file.type?.startsWith('audio/') ? 'audio' : 'document';

      const payload: any = {
        uri: file.uri,
        type: file.type || 'application/octet-stream',
        name: file.fileName || file.name || 'upload',
      };

      setUploadProgress(0);
      const res = await apiService.uploadFile(payload, kind, (p: number) => setUploadProgress(Math.round(p)));

      let uploaded: { url: string; type?: string; name?: string; thumbnailUrl?: string }[] = [];
      if (Array.isArray((res as any)?.files)) {
        uploaded = ((res as any).files as any[])
          .map((f: any) => {
            const url = f?.url || f?.secure_url || (f?.path ? String(f.path) : '');
            const type = f?.type;
            const thumb = String(type || '').toLowerCase().includes('video') ? deriveVideoThumbnail(url) : undefined;
            return { url, type, name: f?.name, thumbnailUrl: thumb };
          });
      } else if ((res as any)?.fileUrl) {
        const url = (res as any).fileUrl;
        uploaded = [{ url, type: kind, thumbnailUrl: kind === 'video' ? deriveVideoThumbnail(url) : undefined }];
      } else if ((res as any)?.url) {
        const url = (res as any).url;
        uploaded = [{ url, type: kind, thumbnailUrl: kind === 'video' ? deriveVideoThumbnail(url) : undefined }];
      }

      setNewPostFiles(prev => [...prev, ...uploaded.filter(f => !!f.url)]);
    } catch (err) {
      console.error('uploadAsset error:', err);
      Alert.alert('Error', 'Failed to upload media');
    } finally {
      setUploadingMedia(false);
      setUploadProgress(0);
    }
  };

  const handleMediaPicker = () => {
    setShowMediaPickerModal(true);
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
          uploadAsset({ uri: asset.uri!, type: asset.type, fileName: asset.fileName });
        }
      });
    } catch (err) {
      console.warn('openCamera error:', err);
      Alert.alert('Camera Error', 'Unable to open camera. Please try again.');
    }
  };

  const openGallery = () => {
    launchImageLibrary({ mediaType: 'mixed', quality: 0.8 }, (response) => {
      const asset = response?.assets && response.assets[0];
      if (asset) {
        uploadAsset({ uri: asset.uri!, type: asset.type, fileName: asset.fileName });
      }
    });
  };

  const openDocumentPicker = async () => {
    try {
      const result = await DocumentPicker.pickSingle({ type: [DocumentPicker.types.allFiles] });
      uploadAsset({ uri: result.uri, type: result.type, name: (result as any).name });
    } catch (error) {
      if (!DocumentPicker.isCancel(error as any)) {
        console.error('Document picker error:', error);
        Alert.alert('Error', 'Failed to pick document');
      }
    }
  };

  const removeSelectedFile = (index: number) => {
    setNewPostFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleLikePost = async (postId: string) => {
    try {
      const username = currentUser?.username || '';
      const prevPosts = posts;
      // Compute next state optimistically
      const nextPosts = prevPosts.map(post => {
        if (post._id !== postId) return post;
        const currentLikedByInner: string[] = Array.isArray((post as any).likedBy)
          ? (post as any).likedBy
          : Array.isArray(post.likes)
          ? (post.likes as any)
          : [];
        const isLiked = username ? currentLikedByInner.includes(username) : false;
        const newLikedBy = isLiked
          ? currentLikedByInner.filter(u => u !== username)
          : username
          ? [...currentLikedByInner, username]
          : currentLikedByInner;
        const likesCount = typeof (post as any).likes === 'number'
          ? ((post as any).likes as any) + (isLiked ? -1 : 1)
          : newLikedBy.length;
        return { ...post, likedBy: newLikedBy, likes: likesCount as any };
      });

      // Play sound only when changing from unliked to liked
      const target = posts.find(p => p._id === postId);
      const currentLikedBy: string[] = Array.isArray((target as any)?.likedBy)
        ? (target as any).likedBy
        : Array.isArray((target as any)?.likes)
        ? ((target as any).likes as any)
        : [];
      const wasLiked = username ? currentLikedBy.includes(username) : false;
      if (!wasLiked) {
        SoundService.playPop('react');
      }

      // Apply optimistic update immediately
      setPosts(nextPosts);
      await apiService.likePost(postId);
    } catch (error) {
      console.error('Error liking post:', error);
      // Roll back on failure
      setPosts(prevPosts);
    }
  };

  const toggleComments = (postId: string) => {
    setExpandedComments(prev => ({ ...prev, [postId]: !prev[postId] }));
  };

  const onChangeCommentText = (postId: string, text: string) => {
    setCommentTextByPost(prev => ({ ...prev, [postId]: text }));
  };

  const submitComment = async (postId: string) => {
    const text = (commentTextByPost[postId] || '').trim();
    if (!text) return;
    setSubmittingCommentByPost(prev => ({ ...prev, [postId]: true }));
    const optimisticComment = {
      author: {
        username: currentUser?.username,
        name: (currentUser as any)?.name || currentUser?.username,
        avatar: (currentUser as any)?.avatar,
      },
      content: text,
      createdAt: new Date().toISOString(),
      replies: [],
    } as any;
    // Optimistically append comment
    const prevPosts = posts;
    const nextPosts = prevPosts.map(p => p._id === postId ? { ...p, comments: [...p.comments, optimisticComment] } : p);
    setPosts(nextPosts);
    try {
      await apiService.commentOnPost(postId, text);
      setCommentTextByPost(prev => ({ ...prev, [postId]: '' }));
      // No heavy reload; the backend will be reflected in next fetch
    } catch (error: any) {
      // Roll back if posting failed
      setPosts(prevPosts);
      Alert.alert('Comment failed', error?.message || 'Unable to post comment');
    } finally {
      setSubmittingCommentByPost(prev => ({ ...prev, [postId]: false }));
    }
  };

  const [reshareMode, setReshareMode] = React.useState<'choose' | 'repost' | 'share'>('choose');

  const handleSharePost = (post: Post) => {
    setResharingPost(post);
    setReshareCaption('');
    setReshareMode('choose');
    setReshareModalVisible(true);
  };

  const submitRepost = async () => {
    const original = resharingPost;
    if (!original?._id) {
      setReshareModalVisible(false);
      return;
    }
    setIsResharing(true);
    try {
      const caption = (reshareCaption || '').trim();
      await apiService.resharePost(original._id, caption ? caption : undefined);
      // Increment original share count locally if present
      setPosts(prev => prev.map(p => p._id === original._id ? { ...p, shares: (typeof p.shares === 'number' ? p.shares + 1 : 1) } : p));
      // Refresh feed to include the repost
      await loadPosts();
      // Close modal and reset
      setReshareModalVisible(false);
      setResharingPost(null);
      setReshareCaption('');
      setReshareMode('choose');
      playSuccessSound();
setTimeout(() => Alert.alert('Reposted', 'Post reposted to your timeline'), 200);
    } catch (error) {
      console.error('Error reposting:', error);
      Alert.alert('Error', 'Failed to repost');
    } finally {
      setIsResharing(false);
    }
  };

  const confirmReshare = async (shareAction: 'share' | 'copy' = 'share') => {
    const original = resharingPost;
    if (!original?._id) {
      setReshareModalVisible(false);
      return;
    }
    try {
      // Build public link to original post details
      const root = (apiService as any).rootUrl || '';
      const link = `${root}/post.html?id=${original._id}`;

      if (shareAction === 'copy') {
        try {
          const Clipboard = require('@react-native-clipboard/clipboard').default;
          if (Clipboard && typeof Clipboard.setString === 'function') {
            Clipboard.setString(link);
            Alert.alert('Link copied', 'Post link copied to clipboard');
          } else {
            Alert.alert('Clipboard unavailable', `Please copy this link manually:\n${link}`);
          }
        } catch (clipErr) {
          Alert.alert('Clipboard unavailable', `Please copy this link manually:\n${link}`);
        }
      } else {
        try {
          await Share.share({ title: 'View post details', message: link, url: link });
        } catch (_shareErr) {
          // Non-fatal
        }
      }
      setReshareModalVisible(false);
      setResharingPost(null);
      setReshareCaption('');
      setReshareMode('choose');
    } catch (error) {
      console.error('Error sharing post details:', error);
      Alert.alert('Error', 'Failed to share post details');
    }
  };

  const toggleSavePost = async (postId: string) => {
    try {
      const isSaved = savedPostIds.has(postId);
      if (isSaved) {
        await apiService.unsavePost(postId);
        setSavedPostIds(prev => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      } else {
        await apiService.savePost(postId);
        setSavedPostIds(prev => new Set(prev).add(postId));
      }
    } catch (error) {
      console.error('Error toggling save:', error);
      Alert.alert('Error', 'Could not update saved posts');
    }
  };

  const openEditPost = (post: Post) => {
    setEditingPostId(post._id);
    setEditingPostContent(post.content || '');
    setEditModalVisible(true);
  };

  const saveEditPost = async () => {
    if (!editingPostId) return;
    try {
      await apiService.updatePost(editingPostId, { content: editingPostContent });
      // Treat any 2xx response as success; update local state accordingly
      setPosts(prev => prev.map(p => p._id === editingPostId ? { ...p, content: editingPostContent } : p));
      setEditModalVisible(false);
      setEditingPostId(null);
    } catch (error) {
      console.error('Error updating post:', error);
      Alert.alert('Error', (error as any)?.message || 'Network error. Please try again.');
    }
  };

  const deletePost = async (postId: string) => {
    Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await apiService.request(`/posts/${postId}`, { method: 'DELETE' });
            // Treat any 2xx response as success; remove post locally
            setPosts(prev => prev.filter(p => p._id !== postId));
          } catch (error) {
            console.error('Error deleting post:', error);
            Alert.alert('Error', (error as any)?.message || 'Network error. Please try again.');
          }
        }
      }
    ]);
  };

  const loadSuggestions = async () => {
    try {
      if (!currentUser?.username) return;
      const list = await apiService.getUserSuggestions(currentUser.username);
      setSuggestedUsers(list);
    } catch (error) {
      console.error('Error loading suggestions:', error);
    }
  };

  const loadPopularSuggestions = async () => {
    try {
      if (!currentUser?.username) {
        await loadSuggestions();
        return;
      }
      const list = await apiService.getTopCreators(10, currentUser.username);
      const normalized = Array.isArray(list) ? list : [];
      if (normalized.length > 0) {
        const top = normalized.map((u: any) => ({
          username: u.username,
          name: u.name || `${(u.firstName || '').trim()} ${(u.surname || '').trim()}`.trim() || u.username,
          avatar: u.avatar,
          location: (u as any).location,
        }));
        setSuggestedUsers(top);
      } else {
        await loadSuggestions();
      }
    } catch (error) {
      console.error('Error loading popular suggestions:', error);
      await loadSuggestions();
    }
  };

  const dismissWelcomeBanner = async () => {
    try {
      const uname = currentUser?.username;
      if (!uname) {
        setShowWelcomeBanner(false);
        setIsFirstTimeUser(false);
        return;
      }
      const key = `firstTimeUser:${uname}`;
      await AsyncStorage.removeItem(key);
      setShowWelcomeBanner(false);
      setIsFirstTimeUser(false);
      await loadSuggestions();
    } catch (_e) {
      setShowWelcomeBanner(false);
      setIsFirstTimeUser(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const renderPost = (post: Post) => (
    <View key={post._id} style={styles.postCard}>
      <View style={styles.postHeader}>
        <TouchableOpacity
          style={globalStyles.flexRow}
          onPress={() => {
            const username = post?.author?.username;
            if (username) {
              navigation.navigate('Profile' as never, { username } as never);
            }
          }}
        >
          <View style={styles.avatarContainer}>
            <Image
              source={{ uri: getAvatarUri(post?.author?.avatar) }}
              style={[globalStyles.avatar, styles.avatarRing]}
            />
            {(() => {
              const flag = getFlagEmojiForLocation((post as any)?.author?.location);
              return flag ? (
                <View style={styles.flagBadgeSmall}>
                  <Text style={styles.flagBadgeText}>{flag}</Text>
                </View>
              ) : null;
            })()}
          </View>
          <View style={styles.authorInfo}>
            <Text style={styles.authorName}>{post?.author?.name || 'Unknown User'}</Text>
            <Text style={globalStyles.textMuted}>@{post?.author?.username || 'unknown'}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.postHeaderRight}>
          {(() => {
            const role = String(authorRoles[post?.author?.username || ''] || '').toLowerCase();
            const isAdmin = role === 'admin' || role === 'superadmin';
            if (!isAdmin) return null;
            const crownColor = role === 'superadmin' ? '#8e44ad' : '#FFD700';
            return (
              <View style={styles.adminCrownRight}>
                <FAIcon name="crown" size={14} color={crownColor} />
              </View>
            );
          })()}
          <Text style={globalStyles.textMuted}>{formatTime(post.createdAt)}</Text>
        </View>
      </View>

      {!!post.content && (
        post?.originalPostId ? (
          <TouchableOpacity onPress={() => navigation.navigate('PostDetail' as never, { postId: String(post.originalPostId) } as never)}>
            <LinkedText
              text={post.content}
              style={styles.postContent}
              numberOfLines={expandedCaptions[post._id] ? undefined : 6}
              onUserPress={(username: string) => handleMentionPress(username)}
            />
          </TouchableOpacity>
        ) : (
          <LinkedText
            text={post.content}
            style={styles.postContent}
            numberOfLines={expandedCaptions[post._id] ? undefined : 6}
            onUserPress={(username: string) => handleMentionPress(username)}
          />
        )
      )}
      {!!post.content && post.content.split(/\s+/).length > 60 && (
        <TouchableOpacity onPress={() => setExpandedCaptions(prev => ({...prev, [post._id]: !prev[post._id]}))}>
          <Text style={styles.toggleCaption}>
            {expandedCaptions[post._id] ? 'Read less' : 'Read more'}
          </Text>
        </TouchableOpacity>
      )}

      {post?.originalPostId && originalPostsById[String(post.originalPostId)] && (
        <View style={{
          backgroundColor: colors.bg,
          borderLeftColor: colors.border,
          borderLeftWidth: 3,
          paddingLeft: 10,
          paddingVertical: 6,
          marginBottom: 8,
        }}>
          <TouchableOpacity onPress={() => navigation.navigate('PostDetail' as never, { postId: String(post.originalPostId) } as never)}>
            <Text style={globalStyles.textMuted}>{(() => {
              const original = originalPostsById[String(post.originalPostId)];
              const author = (original as any)?.author || {};
              const display = author?.name || (author?.username ? `@${author.username}` : 'Unknown User');
              return `Original Post by ${display}`;
            })()}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('PostDetail' as never, { postId: String(post.originalPostId) } as never)}>
            <LinkedText
              text={originalPostsById[String(post.originalPostId)].content}
              style={styles.postContent}
              numberOfLines={expandedCaptions[String(post.originalPostId)] ? undefined : 4}
              onUserPress={(username: string) => handleMentionPress(username)}
            />
          </TouchableOpacity>
          {!!originalPostsById[String(post.originalPostId)].content && originalPostsById[String(post.originalPostId)].content.split(/\s+/).length > 40 && (
            <TouchableOpacity onPress={() => setExpandedCaptions(prev => ({...prev, [String(post.originalPostId)]: !prev[String(post.originalPostId)]}))}>
              <Text style={styles.toggleCaption}>
                {expandedCaptions[String(post.originalPostId)] ? 'Read less' : 'Read more'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {post.files && post.files.length > 0 && (
        <ScrollView
          horizontal
          style={styles.mediaContainer}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={mediaWidth + 10}
          snapToAlignment="start"
          showsHorizontalScrollIndicator={false}
        >
          {post.files.map((file, index) => {
            const typeStr = (file?.type || '').toLowerCase();
            const isVideo = typeStr.includes('video');
            const itemWidth = mediaWidth;
            const fw = Number((file as any)?.thumbnailWidth) || Number((file as any)?.width) || undefined;
            const fh = Number((file as any)?.thumbnailHeight) || Number((file as any)?.height) || undefined;
            const aspect = fw && fh && fh !== 0
              ? fw / fh
              : (isVideo
                ? (() => {
                    // Fallback orientation for videos when width/height are missing
                    const urlStr = String(file?.url || '').toLowerCase();
                    const nameStr = String((file as any)?.name || '').toLowerCase();
                    const hints = ['portrait', 'vertical', '9x16', '9:16', 'tall'];
                    const maybePortrait = hints.some(h => urlStr.includes(h) || nameStr.includes(h));
                    return maybePortrait ? (9 / 16) : (16 / 9);
                  })()
                : 4 / 3);
            const computedHeight = Math.round(itemWidth / aspect);
            const maxHeight = Math.round(screenHeight * 0.8);
            const itemHeight = Math.min(Math.max(140, computedHeight), maxHeight);
            if (isVideo) {
              const poster = (file as any)?.thumbnailUrl || (apiService as any)['getCloudinaryVideoThumbnail']?.(String(file?.url || '')) || '';
              return (
                <TouchableOpacity key={index} activeOpacity={0.85} onPress={() => { if (post?.originalPostId) { navigation.navigate('PostDetail' as never, { postId: String(post.originalPostId) } as never); } else { openMediaPreview(post, index); } }}>
                  <View style={{ width: itemWidth, height: itemHeight, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
                    <Video
                      source={{ uri: String(file?.url || '') }}
                      style={{ width: '100%', height: '100%' }}
                      poster={poster || undefined}
                      resizeMode="cover"
                      paused={true}
                      controls={false}
                    />
                    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                      <Icon name="play-circle-filled" size={48} color="#fff" />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity key={index} activeOpacity={0.85} onPress={() => { if (post?.originalPostId) { navigation.navigate('PostDetail' as never, { postId: String(post.originalPostId) } as never); } else { openMediaPreview(post, index); } }}>
                <Image
                  source={{uri: file.url}}
                  style={[styles.mediaImage, { width: itemWidth, height: Math.min(Math.round(itemWidth / (aspect || (4/3))), maxHeight) }]}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

          {post.comments && post.comments.length > 0 && (
            <View style={styles.commentsPreview}>
          {post.comments.slice(-2).map((c, idx) => (
            <View key={idx} style={styles.commentRow}>
              {(() => {
                const author = (c as any).author || (c as any).user || {};
                const text = (c as any).content || (c as any).comment || (c as any).text || '';
                return (
                  <>
                    <TouchableOpacity onPress={() => author?.username && navigation.navigate('Profile' as never, { username: author.username } as never)}>
                      <Image source={{ uri: getAvatarUri(author?.avatar) }} style={styles.commentAvatar} />
                    </TouchableOpacity>
                    <Text style={styles.commentText} numberOfLines={2}>
                      <Text
                        style={styles.commentAuthor}
                        onPress={() => author?.username && navigation.navigate('Profile' as never, { username: author.username } as never)}
                      >
                        {author?.name || author?.username}
                      </Text>
                      <LinkedText
                        text={`  ${text}`}
                        onUserPress={(username: string) => handleMentionPress(username)}
                      />
                    </Text>
                  </>
                );
              })()}
            </View>
          ))}
            <TouchableOpacity onPress={() => navigation.navigate('PostDetail' as never, { postId: post._id } as never)}>
              <Text style={styles.viewAllComments}>View all comments</Text>
            </TouchableOpacity>
          </View>
        )}

      {expandedComments[post._id] && (
        <View style={styles.commentInputRow}>
          <TextInput
            style={styles.commentInput}
            placeholder="Write a comment..."
            placeholderTextColor={colors.textMuted}
            value={commentTextByPost[post._id] || ''}
            onChangeText={(t) => onChangeCommentText(post._id, t)}
          />
          <TouchableOpacity
            style={styles.commentSubmitButton}
            onPress={() => submitComment(post._id)}
            disabled={!!submittingCommentByPost[post._id]}
          >
            <Text style={styles.commentSubmitText}>
              {submittingCommentByPost[post._id] ? 'Posting…' : 'Submit'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleLikePost(post._id)}>
          {(() => {
            const likedBy: string[] = Array.isArray((post as any).likedBy)
              ? (post as any).likedBy
              : Array.isArray(post.likes)
              ? (post.likes as any)
              : [];
            const isLiked = likedBy.includes(currentUser?.username || '');
            const count = typeof post.likes === 'number' ? post.likes : likedBy.length;
            return (
              <>
                <Icon
                  name={isLiked ? 'favorite' : 'favorite-border'}
                  size={20}
                  color={isLiked ? colors.primary : colors.textMuted}
                />
                <Text style={styles.actionText}>{count}</Text>
              </>
            );
          })()}
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => toggleComments(post._id)}>
          <Icon name="comment" size={20} color={colors.textMuted} />
          <Text style={styles.actionText}>{post.comments.length}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => handleSharePost(post)}>
          <Icon name="share" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Save/Unsave */}
        <TouchableOpacity style={styles.actionButton} onPress={() => toggleSavePost(post._id)}>
          {(() => {
            const isSaved = savedPostIds.has(post._id);
            return (
              <Icon name={isSaved ? 'bookmark' : 'bookmark-border'} size={20} color={isSaved ? colors.primary : colors.textMuted} />
            );
          })()}
        </TouchableOpacity>

        {currentUser?.username === (post.author?.username || '') && (
          <>
            {/* Boost button visible only on current user's posts (no-op for now) */}
            <TouchableOpacity style={styles.actionButton} onPress={() => Alert.alert('Boost Post', 'Boosting not implemented yet')}>
              <Icon name="trending-up" size={20} color={colors.textMuted} />
              <Text style={styles.actionText}>Boost</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => openEditPost(post)}>
              <Icon name="edit" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => deletePost(post._id)}>
              <Icon name="delete" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  const renderComposer = () => (
    <View style={styles.composerCard}>
      <View style={styles.composerRow}>
        <TouchableOpacity
          onPress={() => {
            const username = currentUser?.username;
            if (username) {
              navigation.navigate('Profile' as never, { username } as never);
            }
          }}
        >
          <View style={[styles.avatarContainer, styles.composerAvatarContainer]}>
            <Image source={{uri: getAvatarUri(currentUser?.avatar)}} style={[globalStyles.avatar, styles.avatarRing, styles.composerAvatarSmall]} />
            {(() => {
              const flag = getFlagEmojiForLocation((currentUser as any)?.location);
              return flag ? (
                <View style={styles.flagBadgeSmall}>
                  <Text style={styles.flagBadgeText}>{flag}</Text>
                </View>
              ) : null;
            })()}
          </View>
        </TouchableOpacity>
        <View style={styles.composerInputContainer}>
          <TextInput
            style={styles.composerInput}
            placeholder="What's on your mind?"
            placeholderTextColor={colors.textMuted}
            value={newPostContent}
            onChangeText={handleComposerChange}
            multiline
            maxLength={500}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => {
              setComposerFocused(false);
              setShowMentionSuggestions(false);
            }}
          />
        </View>
      </View>
      {newPostFiles.length > 0 && (
        <ScrollView horizontal style={styles.mediaContainer} showsHorizontalScrollIndicator={false}>
          {newPostFiles.map((file, index) => {
            const typeStr = (file?.type || '').toLowerCase();
            const isImage = typeStr.includes('image');
            const isVideo = typeStr.includes('video');
            return (
              <View key={index} style={[styles.mediaImage, { justifyContent: 'center', alignItems: 'center' }]}> 
                {isImage ? (
                  <Image source={{ uri: file.url }} style={styles.mediaImage} />
                ) : isVideo ? (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    {file.thumbnailUrl ? (
                      <Image source={{ uri: file.thumbnailUrl }} style={styles.mediaImage} />
                    ) : (
                      <Icon name={'play-circle-outline'} size={28} color={colors.textMuted} />
                    )}
                  </View>
                ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Icon name={'insert-drive-file'} size={28} color={colors.textMuted} />
                    <Text style={globalStyles.textMuted}>File</Text>
                  </View>
                )}
                <TouchableOpacity onPress={() => removeSelectedFile(index)} style={{ position: 'absolute', top: 6, right: 6 }}>
                  <Icon name="close" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
      {uploadingMedia && (
        <View style={styles.uploadProgressRow}>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, { width: `${uploadProgress}%` }]} />
          </View>
          <Text style={styles.progressText}>{uploadProgress}%</Text>
        </View>
      )}
      {showMentionSuggestions && (
        <View style={styles.mentionDropdownContainer}>
          <FlatList
            data={mentionResults}
            keyExtractor={(item) => item.username}
            horizontal
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            renderItem={({item}) => (
              <TouchableOpacity style={styles.mentionChip} onPress={() => insertMention(item)}>
                <Image source={{uri: getAvatarUri(item.avatar)}} style={styles.mentionAvatar} />
                <Text style={styles.mentionText}>@{item.username}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
      {showMediaPickerModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Media</Text>
            <TouchableOpacity style={styles.actionButton} onPress={() => { setShowMediaPickerModal(false); openCamera(); }}>
              <Icon name="photo-camera" size={18} color={colors.text} />
              <Text style={styles.actionText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => { setShowMediaPickerModal(false); openGallery(); }}>
              <Icon name="photo-library" size={18} color={colors.text} />
              <Text style={styles.actionText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => { setShowMediaPickerModal(false); openDocumentPicker(); }}>
              <Icon name="insert-drive-file" size={18} color={colors.text} />
              <Text style={styles.actionText}>Document</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { justifyContent: 'center' }]} onPress={() => setShowMediaPickerModal(false)}>
              <Text style={styles.actionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <View style={styles.composerActions}>
        <TouchableOpacity style={styles.mediaButton} onPress={handleMediaPicker}>
          <Icon name="add-photo-alternate" size={18} color="#fff" />
          <Text style={styles.mediaButtonText}>Add Media</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={globalStyles.secondaryButton}
          onPress={() => { setNewPostContent(''); setShowMentionSuggestions(false); }}>
          <Text style={globalStyles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[globalStyles.button, styles.postButton]}
          onPress={handleCreatePost}>
          <Text style={globalStyles.buttonText}>Post</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[globalStyles.container, { backgroundColor: theme === 'dark' ? colors.dark.bg : colors.light.bg }] }>
      {(isPosting || isResharing) && (
        <Modal transparent visible>
          <View style={styles.inflightOverlay}>
            <View style={styles.inflightCard}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.inflightText}>{isPosting ? 'Please stay on board while we post your content' : 'Please stay on Board while we reshare Post to your Timeline'}</Text>
            </View>
          </View>
        </Modal>
      )}
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={["transparent"]}
            progressViewOffset={60}
          />
        }
      >
        {refreshing && (
          <View style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Animated.Image source={logoSource} style={{ width: 36, height: 36, transform: [{ rotate: spin }] }} />
          </View>
        )}
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>ConnectHer</Text>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowQuickMenu(prev => !prev)}
          >
            <Icon name="menu" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Icon name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search names, usernames, posts, communities..."
            placeholderTextColor={colors.textMuted}
            onFocus={() => navigation.navigate('Search' as never)}
          />
          <TouchableOpacity
            style={styles.searchAction}
            onPress={() => navigation.navigate('Search' as never)}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <Icon name="search" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Welcome line under nav */}
        <Text style={styles.headerWelcome}>
          {(() => {
            const displayName = getDisplayName(currentUser);
            return displayName ? `Welcome ${displayName}` : 'Welcome';
          })()}
        </Text>

        {showWelcomeBanner && (
          <View style={styles.welcomeBanner}>
            <Text style={styles.welcomeTitle}>
              {(() => {
                const displayName = getDisplayName(currentUser);
                return displayName ? `Welcome, ${displayName}!` : 'Welcome!';
              })()}
            </Text>
            <Text style={styles.welcomeText}>
              We’ve curated popular creators to help you get started.
            </Text>
            <View style={styles.bannerActions}>
              <TouchableOpacity style={styles.bannerDismiss} onPress={dismissWelcomeBanner}>
                <Icon name="close" size={16} color="#fff" />
                <Text style={styles.bannerDismissText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Quick options menu */}
        {showQuickMenu && (
          <ScrollView horizontal style={styles.quickMenu} showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.quickMenuItem}
              onPress={() => navigation.navigate('Search' as never)}
            >
              <Icon name="search" size={20} color="#FF1493" />
              <Text style={styles.quickMenuText}>Search</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickMenuItem}
              onPress={() => navigation.navigate('CreateCommunity' as never)}
            >
              <Icon name="add-circle" size={20} color="#FF1493" />
              <Text style={styles.quickMenuText}>Create</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickMenuItem}
              onPress={() => navigation.navigate('Settings' as never)}
            >
              <Icon name="settings" size={20} color="#FF1493" />
              <Text style={styles.quickMenuText}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickMenuItem}
              onPress={() => navigation.navigate('HelpDesk' as never)}
            >
              <Icon name="help-outline" size={20} color="#FF1493" />
              <Text style={styles.quickMenuText}>Help Desk</Text>
            </TouchableOpacity>
            {(currentUser?.role === 'admin' || currentUser?.role === 'superadmin') && (
              <TouchableOpacity
                style={styles.quickMenuItem}
                onPress={() =>
                  navigation.navigate(
                    (currentUser?.role === 'superadmin' ? 'SuperAdminPanel' : 'AdminPanel') as never
                  )
                }
              >
                <Icon name="admin-panel-settings" size={20} color="#FF1493" />
                <Text style={styles.quickMenuText}>Admin</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* People You May Know */}
        <View style={styles.greetingCard}>
          <Text style={styles.peopleHeading}>{isFirstTimeUser ? 'Popular Creators To Follow' : 'People You May Know'}</Text>

          {/* Suggestions */}
          {suggestedUsers.length > 0 && (
            <ScrollView horizontal style={styles.suggestionsRow} contentContainerStyle={styles.suggestionsContainer} showsHorizontalScrollIndicator={false}>
              {suggestedUsers.map(u => (
                <TouchableOpacity
                  key={u.username}
                  style={styles.suggestionItem}
                  onPress={() => navigation.navigate('Profile' as never, { username: u.username } as never)}
                >
                  <View style={[styles.avatarContainer, styles.suggestionAvatarContainer]}>
                    <Image source={{ uri: getAvatarUri(u.avatar) }} style={styles.suggestionAvatar} />
                    {(() => {
                      const flag = getFlagEmojiForLocation((u as any)?.location);
                      return flag ? (
                        <View style={styles.flagBadgeSmall}>
                          <Text style={styles.flagBadgeText}>{flag}</Text>
                        </View>
                      ) : null;
                    })()}
                  </View>
                  <Text style={styles.suggestionName} numberOfLines={1}>{u.name || u.username}</Text>
                  <TouchableOpacity style={styles.addFriendButton} onPress={() => handleAddFriend(u.username)}>
                    <Text style={styles.addFriendText}>Add Friend</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {showComposer ? renderComposer() : null}
{successSoundUrl ? (
  <Video
    source={{ uri: successSoundUrl }}
    paused={false}
    repeat={false}
    audioOnly
    muted={false}
    volume={1.0}
    playInBackground={true}
    ignoreSilentSwitch={'ignore'}
    onEnd={() => setSuccessSoundUrl(null)}
    onError={(e: any) => { console.warn('success sound video error', e); setSuccessSoundUrl(null); }}
    style={{ width: 0, height: 0 }}
  />
) : null}

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading posts...</Text>
          </View>
        )}

        {!loading && posts.length === 0 && (
          <View style={styles.emptyContainer}>
            <Icon name="feed" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyText}>Start the conversation by creating your first post</Text>
            <TouchableOpacity
              style={globalStyles.button}
              onPress={() => setShowComposer(true)}
            >
              <Text style={globalStyles.buttonText}>Create Post</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && posts.map(renderPost)}
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowComposer(prev => !prev)}>
        <Icon name="add" size={24} color={colors.text} />
      </TouchableOpacity>

      {/* Edit Post Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Post</Text>
            <TextInput
              style={styles.modalInput}
              value={editingPostContent}
              onChangeText={setEditingPostContent}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={globalStyles.secondaryButton} onPress={() => setEditModalVisible(false)}>
                <Text style={globalStyles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={globalStyles.button} onPress={saveEditPost}>
                <Text style={globalStyles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reshare Modal */}
      <Modal
        visible={reshareModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setReshareModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reshare Post</Text>

            {reshareMode === 'repost' && (
              <TextInput
                style={styles.modalInput}
                value={reshareCaption}
                onChangeText={setReshareCaption}
                placeholder="Add a caption (optional)"
                multiline
              />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={globalStyles.secondaryButton} onPress={() => { setReshareModalVisible(false); setReshareMode('choose'); }}>
                <Text style={globalStyles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>

              {reshareMode === 'choose' && (
                <>
                  <TouchableOpacity style={globalStyles.button} onPress={() => setReshareMode('repost')}>
                    <Text style={globalStyles.buttonText}>Repost to your Timeline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={globalStyles.button} onPress={() => setReshareMode('share')}>
                    <Text style={globalStyles.buttonText}>Share Post Details</Text>
                  </TouchableOpacity>
                </>
              )}

              {reshareMode === 'repost' && (
                <TouchableOpacity style={globalStyles.button} onPress={submitRepost}>
                  <Text style={globalStyles.buttonText}>Repost</Text>
                </TouchableOpacity>
              )}

              {reshareMode === 'share' && (
                <>
                  <TouchableOpacity style={globalStyles.button} onPress={() => confirmReshare('share')}>
                    <Text style={globalStyles.buttonText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={globalStyles.button} onPress={() => confirmReshare('copy')}>
                    <Text style={globalStyles.buttonText}>Copy Link</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Image Preview Modal (theme-based background) */}
      <Modal
        visible={imagePreviewVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={closeImagePreview}
      >
        <View style={{ flex: 1, backgroundColor: theme === 'dark' ? '#000' : '#fff' }}>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 56, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 12 }}>
            <TouchableOpacity onPress={closeImagePreview} style={{ padding: 8 }}>
              <Icon name="close" size={28} color={theme === 'dark' ? '#fff' : '#333'} />
            </TouchableOpacity>
          </View>
          {!!imagePreviewSource && (
            <Image
              source={{ uri: imagePreviewSource }}
              style={{ width: screenWidth, height: screenHeight }}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Media Preview Modal */}
      <Modal
        visible={mediaPreviewVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={closeMediaPreview}
      >
        <View style={styles.previewContainer}>
          <FlatList
            ref={previewListRef}
            data={previewPost?.files || []}
            horizontal
            pagingEnabled
            keyExtractor={(item, idx) => (item?.url ? `${item.url}:${idx}` : String(idx))}
            getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
            renderItem={({ item }) => {
              const typeStr = (item?.type || '').toLowerCase();
              const isImage = typeStr.includes('image');
              const isVideo = typeStr.includes('video');
              if (isImage) {
                return (
                  <View style={[styles.previewItem, { width: screenWidth, height: screenHeight }]}> 
                    <Image source={{ uri: item.url }} style={styles.previewImage} resizeMode="contain" />
                  </View>
                );
              }
              if (isVideo) {
                const poster = (item as any)?.thumbnailUrl || (apiService as any)['getCloudinaryVideoThumbnail']?.(String(item?.url || '')) || '';
                return (
                  <View style={[styles.previewItem, { width: screenWidth, height: screenHeight }]}> 
                    <Video
                      source={{ uri: String(item?.url || '') }}
                      style={styles.previewImage}
                      poster={poster || undefined}
                      controls={true}
                      resizeMode="contain"
                      paused={false}
                    />
                  </View>
                );
              }
              return (
                <View style={[styles.previewItem, styles.previewDoc]}> 
                  <Icon name="insert-drive-file" size={64} color="#fff" />
                  <Text style={styles.previewDocText}>Unsupported file</Text>
                </View>
              );
            }}
          />

          <View style={styles.previewTopBar}>
            <TouchableOpacity onPress={closeMediaPreview} style={styles.previewCloseButton}>
              <Icon name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>

          {!!previewPost && (
            <View style={styles.previewStats}>
              {(() => {
                const likedBy: string[] = Array.isArray((previewPost as any).likedBy)
                  ? (previewPost as any).likedBy
                  : Array.isArray(previewPost.likes)
                  ? (previewPost.likes as any)
                  : [];
                const likesCount = typeof previewPost.likes === 'number' ? (previewPost.likes as any) : likedBy.length;
                const commentsCount = Array.isArray(previewPost.comments) ? previewPost.comments.length : 0;
                const sharesCount = typeof previewPost.shares === 'number' ? (previewPost.shares as number) : 0;
                const savesCount = typeof (previewPost as any).saves === 'number'
                  ? ((previewPost as any).saves as number)
                  : Array.isArray((previewPost as any).savedBy)
                  ? ((previewPost as any).savedBy as any[]).length
                  : 0;
                return (
                  <>
                    <View style={styles.previewStatItem}>
                      <Icon name="favorite" size={20} color="#fff" />
                      <Text style={styles.previewStatText}>{likesCount}</Text>
                    </View>
                    <View style={styles.previewStatItem}>
                      <Icon name="chat-bubble" size={20} color="#fff" />
                      <Text style={styles.previewStatText}>{commentsCount}</Text>
                    </View>
                    <View style={styles.previewStatItem}>
                      <Icon name="share" size={20} color="#fff" />
                      <Text style={styles.previewStatText}>{sharesCount}</Text>
                    </View>
                    <View style={styles.previewStatItem}>
                      <Icon name="bookmark" size={20} color="#fff" />
                      <Text style={styles.previewStatText}>{savesCount}</Text>
                    </View>
                  </>
                );
              })()}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  headerWelcome: {
    ...globalStyles.paddingHorizontal,
    marginTop: 8,
    marginBottom: 8,
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  welcomeBanner: {
    ...globalStyles.paddingHorizontal,
    marginHorizontal: 10,
    marginTop: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  welcomeTitle: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  welcomeText: {
    color: colors.text,
    fontSize: 14,
  },
  bannerActions: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bannerDismiss: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
  },
  bannerDismissText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  headerButton: {
    marginLeft: 15,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    marginHorizontal: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: colors.text,
    fontSize: 14,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchAction: {
    marginLeft: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: colors.secondary,
  },
  content: {
    flex: 1,
  },
  // Global quick options menu
  quickMenu: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: 10,
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  quickMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: colors.secondary,
    marginRight: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickMenuText: {
    color: '#FF1493',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  // Post card styles
  postCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 15,
    marginHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  postHeader: {
    ...globalStyles.flexRowBetween,
    marginBottom: 10,
  },
  avatarRing: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 20,
  },
  postHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminCrownRight: {
    marginRight: 8,
    marginLeft: 4,
  },
  postButton: {
    paddingHorizontal: 16,
    alignSelf: 'flex-end',
    marginLeft: 8,
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  // People You May Know card container
  greetingCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  // People section heading
  peopleHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  // Horizontal list styling
  suggestionsRow: {
    marginTop: 8,
  },
  suggestionsContainer: {
    paddingHorizontal: 10,
  },
  // Individual suggestion card
  suggestionItem: {
    width: 120,
    backgroundColor: '#ffe6f2',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginRight: 12,
  },
  // Avatar + flag container
  avatarContainer: {
    position: 'relative',
  },
  suggestionAvatarContainer: {},
  suggestionAvatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  flagBadgeSmall: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  flagBadgeText: {
    fontSize: 11,
  },
  // Name + add friend button
  suggestionName: {
    color: '#FF1493',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  addFriendButton: {
    backgroundColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginTop: 8,
  },
  addFriendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  composerCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 10,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  composerInputContainer: {
    flex: 1,
  },
  composerInput: {
    minHeight: 60,
    maxHeight: 120,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
  },
  authorInfo: {
    marginLeft: 10,
  },
  authorName: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  postContent: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 10,
  },
  mediaContainer: {
    marginVertical: 10,
    paddingBottom: 6,
  },
  mediaImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginRight: 10,
  },
  composerAvatarSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  videoWrapper: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginRight: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  videoWebView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  mediaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
  },
  mediaButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  toggleCaption: {
    color: colors.primary,
    marginBottom: 8,
  },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flexDirection: 'row',
    marginRight: 20,
    alignItems: 'center',
  },
  actionText: {
    color: colors.textMuted,
    marginLeft: 5,
    fontSize: 14,
  },
  commentsPreview: {
    marginTop: 8,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  uploadProgressRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBarBackground: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  progressText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
  },
  commentSubmitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  commentSubmitText: {
    color: '#fff',
    fontWeight: '600',
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  commentAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  commentText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  commentAuthor: {
    color: colors.primary,
    fontWeight: '600',
  },
  commentAuthor: {
    color: colors.primary,
    fontWeight: '600',
  },
  viewAllComments: {
    color: colors.primary,
    marginTop: 4,
    fontSize: 13,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  notifDot: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 10,
  },
  modalInput: {
    minHeight: 80,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
  },
  modalActions: {
    ...globalStyles.flexRowBetween,
    marginTop: 12,
  },
  inflightOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  inflightCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    maxWidth: '85%',
  },
  inflightText: {
    marginTop: 10,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  // --- Media preview styles ---
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewItem: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewWebView: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  previewDoc: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewDocText: {
    color: '#fff',
    marginTop: 10,
  },
  previewTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 56,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
  },
  previewCloseButton: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 24,
  },
  previewStats: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  previewStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewStatText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default DashboardScreen;