import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Dimensions,
  FlatList,
} from 'react-native';
import { WebView } from 'react-native-webview';
import {Share} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { getFlagEmojiForLocation } from '../utils/flags';
import { debounce } from 'lodash';
import apiService from '../services/ApiService';
import socketService from '../services/SocketService';
import {colors, globalStyles} from '../styles/globalStyles';
import LinkedText from '../components/LinkedText';

interface Post {
  _id: string;
  author: {
    username: string;
    name: string;
    avatar: string;
  };
  content: string;
  files: any[];
  likes: string[];
  comments: any[];
  shares?: number;
  likedBy?: string[];
  createdAt: string;
}

interface User {
  username: string;
  name: string;
  avatar: string;
  role?: string;
}

const DashboardScreen = () => {
  const navigation = useNavigation();
  const [posts, setPosts] = useState<Post[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newPostContent, setNewPostContent] = useState('');
  const [showComposer, setShowComposer] = useState(true);
  const [expandedCaptions, setExpandedCaptions] = useState<Record<string, boolean>>({});
  const [hasNewNotif, setHasNewNotif] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState<User[]>([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState('');
  const [composerFocused, setComposerFocused] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionResults, setMentionResults] = useState<User[]>([]);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [imagePreviewSource, setImagePreviewSource] = useState<string | null>(null);
  const [mediaPreviewVisible, setMediaPreviewVisible] = useState(false);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const mediaWidth = Math.round(Dimensions.get('window').width - 40);
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentTextByPost, setCommentTextByPost] = useState<Record<string, string>>({});
  const [submittingCommentByPost, setSubmittingCommentByPost] = useState<Record<string, boolean>>({});
  const [newPostFiles, setNewPostFiles] = useState<{ url: string; type?: string; name?: string; thumbnailUrl?: string }[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const handleAddFriend = async (username: string) => {
    try {
      await apiService.sendFriendRequest(username);
      Alert.alert('Success', 'Friend request sent');
    } catch (e) {
      Alert.alert('Error', 'Could not send friend request');
    }
  };

  useEffect(() => {
    loadCurrentUser();
    loadPosts();
    setupSocketListeners();
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Reload posts and current user on focus so location/flag changes reflect immediately
      loadPosts();
      loadCurrentUser();
    }, [])
  );

  useEffect(() => {
    if (currentUser) {
      loadSuggestions();
      // Load saved posts for current user
      (async () => {
        try {
          const saved = await apiService.getSavedPosts(currentUser.username);
          setSavedPostIds(new Set(saved.map(p => p._id)));
        } catch (err) {
          console.error('Error loading saved posts:', err);
        }
      })();
    }
  }, [currentUser]);

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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPosts();
    setRefreshing(false);
  };

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) {
      Alert.alert('Error', 'Please enter some content for your post');
      return;
    }

    try {
      const response = await apiService.createPost({
        content: newPostContent,
        files: newPostFiles,
      });

      if (response.success) {
        setNewPostContent('');
        setNewPostFiles([]);
        setShowComposer(false);
        loadPosts(); // Refresh posts
      } else {
        Alert.alert('Error', 'Failed to create post');
      }
    } catch (error) {
      console.error('Error creating post:', error);
      Alert.alert('Error', 'Network error. Please try again.');
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

      const res = await apiService.uploadFile(payload, kind);

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
    }
  };

  const handleMediaPicker = () => {
    Alert.alert(
      'Select Media',
      'Choose an option',
      [
        { text: 'Camera', onPress: () => openCamera() },
        { text: 'Gallery', onPress: () => openGallery() },
        { text: 'Document', onPress: () => openDocumentPicker() },
        { text: 'Cancel', style: 'cancel' },
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
      await apiService.likePost(postId);
      // Optimistically update local state
      setPosts(prevPosts => prevPosts.map(post => {
        if (post._id !== postId) return post;
        const username = currentUser?.username || '';
        const currentLikedBy: string[] = Array.isArray((post as any).likedBy)
          ? (post as any).likedBy
          : Array.isArray(post.likes)
          ? (post.likes as any)
          : [];
        const isLiked = username ? currentLikedBy.includes(username) : false;
        const newLikedBy = isLiked
          ? currentLikedBy.filter(u => u !== username)
          : username
          ? [...currentLikedBy, username]
          : currentLikedBy;
        const likesCount = typeof (post as any).likes === 'number'
          ? ((post as any).likes as any) + (isLiked ? -1 : 1)
          : newLikedBy.length;
        return { ...post, likedBy: newLikedBy, likes: likesCount as any };
      }));
    } catch (error) {
      console.error('Error liking post:', error);
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
    try {
      await apiService.commentOnPost(postId, text);
      setCommentTextByPost(prev => ({ ...prev, [postId]: '' }));
      await loadPosts();
    } catch (error: any) {
      Alert.alert('Comment failed', error?.message || 'Unable to post comment');
    } finally {
      setSubmittingCommentByPost(prev => ({ ...prev, [postId]: false }));
    }
  };

  const handleSharePost = async (post: Post) => {
    try {
      const reshared = await apiService.resharePost(post._id);
      // Increment original share count locally if present
      setPosts(prev => prev.map(p => p._id === post._id ? { ...p, shares: (typeof p.shares === 'number' ? p.shares + 1 : 1) } : p));
      // Optionally refresh feed to include reshared post
      await loadPosts();
      Alert.alert('Shared', 'Post reshared to your feed');
    } catch (error) {
      console.error('Error sharing post:', error);
      Alert.alert('Error', 'Failed to share post');
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
        <Text style={globalStyles.textMuted}>{formatTime(post.createdAt)}</Text>
      </View>

      {!!post.content && (
        <LinkedText
          text={post.content}
          style={styles.postContent}
          numberOfLines={expandedCaptions[post._id] ? undefined : 6}
          onUserPress={(username: string) => navigation.navigate('Profile' as never, { username } as never)}
        />
      )}
      {!!post.content && post.content.split(/\s+/).length > 60 && (
        <TouchableOpacity onPress={() => setExpandedCaptions(prev => ({...prev, [post._id]: !prev[post._id]}))}>
          <Text style={styles.toggleCaption}>
            {expandedCaptions[post._id] ? 'Read less' : 'Read more'}
          </Text>
        </TouchableOpacity>
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
            const itemHeight = Math.round(mediaWidth * 0.56);
            if (isVideo) {
              const thumb = file?.thumbnailUrl || deriveVideoThumbnail(file?.url || '');
              return (
                <TouchableOpacity key={index} activeOpacity={0.85} onPress={() => openMediaPreview(post, index)}>
                  <View style={{ width: itemWidth, height: itemHeight, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                    {thumb ? (
                      <Image source={{ uri: thumb }} style={{ width: itemWidth, height: itemHeight }} />
                    ) : (
                      <View style={{ width: itemWidth, height: itemHeight, justifyContent: 'center', alignItems: 'center' }}>
                        <Icon name="videocam" size={48} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
                      <Icon name="play-circle-outline" size={56} color="#fff" />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity key={index} activeOpacity={0.85} onPress={() => openMediaPreview(post, index)}>
                <Image
                  source={{uri: file.url}}
                  style={[styles.mediaImage, { width: itemWidth, height: Math.round(mediaWidth * 0.75) }]}
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
                        onUserPress={(username: string) => navigation.navigate('Profile' as never, { username } as never)}
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
        <View style={{ marginTop: 8 }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}
      {showMentionSuggestions && (
        <View style={styles.mentionDropdownContainer}>
          <FlatList
            data={mentionResults}
            keyExtractor={(item) => item.username}
            horizontal
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
    <View style={globalStyles.container}>
      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
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
            placeholder="Search users or posts..."
            placeholderTextColor={colors.textMuted}
            onFocus={() => navigation.navigate('Search' as never)}
          />
          <TouchableOpacity
            style={styles.searchAction}
            onPress={() => navigation.navigate('Search' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open search options"
          >
            <Icon name="tune" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Welcome line under nav */}
        <Text style={styles.headerWelcome}>
          {(() => {
            const displayName = getDisplayName(currentUser);
            return displayName ? `Welcome ${displayName}` : 'Welcome';
          })()}
        </Text>

        {/* Quick options menu */}
        {showQuickMenu && (
          <View style={styles.quickMenu}>
            <TouchableOpacity
              style={styles.quickMenuItem}
              onPress={() => navigation.navigate('Search' as never)}
            >
              <Icon name="search" size={20} color={colors.text} />
              <Text style={styles.quickMenuText}>Search</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickMenuItem}
              onPress={() => navigation.navigate('CreateCommunity' as never)}
            >
              <Icon name="add-circle" size={20} color={colors.text} />
              <Text style={styles.quickMenuText}>Create</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickMenuItem}
              onPress={() => navigation.navigate('Settings' as never)}
            >
              <Icon name="settings" size={20} color={colors.text} />
              <Text style={styles.quickMenuText}>Settings</Text>
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
                <Icon name="admin-panel-settings" size={20} color={colors.text} />
                <Text style={styles.quickMenuText}>Admin</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* People You May Know */}
        <View style={styles.greetingCard}>
          <Text style={styles.peopleHeading}>People You May Know</Text>

          {/* Suggestions */}
          {suggestedUsers.length > 0 && (
            <ScrollView horizontal style={styles.suggestionsRow} contentContainerStyle={styles.suggestionsContainer}>
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

        {renderComposer()}

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
        onPress={() => setShowComposer(true)}>
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
                const html = `<!DOCTYPE html><html><head><meta name=viewport content='width=device-width,initial-scale=1'><style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;}video{width:100%;height:100%;object-fit:contain}</style></head><body><video id='v' src='${item.url}' autoplay controls playsinline></video><script>var v=document.getElementById('v'); v.muted=false; v.play();</script></body></html>`;
                return (
                  <View style={[styles.previewItem, { width: screenWidth, height: screenHeight }]}> 
                    <WebView
                      source={{ html }}
                      style={styles.previewWebView}
                      javaScriptEnabled
                      domStorageEnabled
                      mediaPlaybackRequiresUserAction={false}
                      allowsInlineMediaPlayback
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
  },
  composerInputContainer: {
    flex: 1,
    marginLeft: 10,
    backgroundColor: colors.inputBg,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  greetingCard: {
    backgroundColor: colors.surface,
    margin: 10,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  greetingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  greetingSubtitle: {
    color: colors.textMuted,
    marginBottom: 12,
  },
  quickActions: {
    ...globalStyles.flexRowWrap,
    gap: 10,
  },
  quickMenu: {
    alignSelf: 'flex-end',
    marginRight: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    minWidth: 180,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  quickMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  quickMenuText: {
    marginLeft: 8,
    color: colors.text,
    fontWeight: '600',
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  quickActionText: {
    marginLeft: 8,
    color: colors.text,
  },
  suggestionsRow: {
    marginTop: 12,
  },
  suggestionsContainer: {
    paddingVertical: 4,
  },
  suggestionItem: {
    alignItems: 'center',
    backgroundColor: colors.secondary,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginRight: 10,
    minWidth: 90,
  },
  suggestionAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginBottom: 6,
  },
  suggestionName: {
    color: colors.primary,
    fontSize: 12,
    maxWidth: 80,
    textAlign: 'center',
  },
  addFriendButton: {
    marginTop: 6,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addFriendText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
    textAlign: 'center',
  },
  peopleHeading: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 10,
    color: colors.textMuted,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 10,
  },
  emptyText: {
    color: colors.textMuted,
    marginVertical: 10,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  composerInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 40,
    textAlignVertical: 'top',
  },
  mentionDropdownContainer: {
    marginTop: 10,
  },
  mentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginRight: 8,
  },
  mentionAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  mentionText: {
    color: colors.text,
    fontSize: 14,
  },
  avatarRing: {
    borderWidth: 3,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    padding: 2,
  },
  avatarContainer: {
    position: 'relative',
  },
  flagBadgeSmall: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  flagBadgeText: {
    fontSize: 11,
  },
  composerAvatarContainer: {
    display: 'flex',
  },
  suggestionAvatarContainer: {
    alignSelf: 'center',
  },
  composerActions: {
    ...globalStyles.flexRowBetween,
    marginTop: 15,
  },
  postButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  postCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 10,
    marginBottom: 15,
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
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
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
});

export default DashboardScreen;