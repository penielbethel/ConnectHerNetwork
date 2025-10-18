import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';
import LinkedText from '../components/LinkedText';
import { getFlagEmojiForLocation } from '../utils/flags';
import { RootStackParamList } from '../types/navigation';

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
  createdAt: string;
  originalPostId?: string;
}

const PostDetailScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'PostDetail'>>();
  const navigation = useNavigation();
  // Derive postId from either `postId` or `id` for deep links
  const rawParams = (route?.params as any) || {};
  const postId: string | undefined = rawParams.postId || rawParams.id;
  
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [originalPost, setOriginalPost] = useState<Post | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ username: string; name?: string; avatar?: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyingToIndex, setReplyingToIndex] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [editingReplyKey, setEditingReplyKey] = useState<{ commentIndex: number; replyIndex: number } | null>(null);
  const [editingReplyText, setEditingReplyText] = useState('');
  const loadPost = useCallback(async () => {
    if (!postId) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiService.getPost(postId);
      const normalized = (data as any)?.post || data;
      setPost(normalized);
      const origId = (normalized as any)?.originalPostId;
      if (origId) {
        try {
          const origData = await apiService.getPost(String(origId));
          const origNormalized = (origData as any)?.post || origData;
          if (origNormalized && typeof origNormalized === 'object') {
            setOriginalPost(origNormalized as Post);
          }
        } catch (e) {
          console.warn('Failed to load original post', e);
        }
      } else {
        setOriginalPost(null);
      }
    } catch (err) {
      console.warn('Failed to load post', err);
    } finally {
      setLoading(false);
    }
  }, [postId]);
  
  useEffect(() => {
    loadPost();
  }, [loadPost]);
  
  useFocusEffect(
    useCallback(() => {
      loadPost();
    }, [loadPost])
  );

  const screenWidth = Dimensions.get('window').width;

  const getAvatarUri = (uri?: string) => {
    if (uri && uri.trim()) return uri;
    return 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png';
  };

  useEffect(() => {
    (async () => {
      try {
        const u = await AsyncStorage.getItem('currentUser');
        if (u) setCurrentUser(JSON.parse(u));
      } catch {}
    })();
  }, []);



  const onRefresh = async () => {
    setRefreshing(true);
    await loadPost();
    setRefreshing(false);
  };

  const handleLike = async () => {
    if (!post) return;
    try {
      await apiService.likePost(post._id);
      const username = currentUser?.username || '';
      const currentLikedBy: string[] = Array.isArray((post as any).likedBy)
        ? (post as any).likedBy
        : Array.isArray(post.likes)
        ? (post.likes as any)
        : [];
      const liked = username ? currentLikedBy.includes(username) : false;
      const newLikedBy = liked
        ? currentLikedBy.filter(u => u !== username)
        : username
        ? [...currentLikedBy, username]
        : currentLikedBy;
      const likesCount = typeof post.likes === 'number' ? post.likes + (liked ? -1 : 1) : newLikedBy.length;
      setPost({ ...post, likedBy: newLikedBy, likes: likesCount as any });
    } catch (err) {
      console.error('Error liking post:', err);
    }
  };

  const handleComment = async () => {
    if (!post || !commentText.trim()) return;
    try {
      await apiService.commentOnPost(post._id, commentText.trim());
      setCommentText('');
      loadPost();
    } catch (err) {
      console.error('Error commenting:', err);
    }
  };

  const startReply = (idx: number) => {
    setReplyingToIndex(idx);
    setReplyText('');
  };

  const submitReply = async () => {
    if (replyingToIndex === null || !post || !replyText.trim()) return;
    try {
      await apiService.replyToComment(post._id, replyingToIndex, replyText.trim());
      setReplyText('');
      setReplyingToIndex(null);
      loadPost();
    } catch (err) {
      console.error('Error replying:', err);
    }
  };

  const startEditComment = (idx: number, initial: string) => {
    setEditingCommentIndex(idx);
    setEditingCommentText(initial || '');
  };

  const saveEditComment = async () => {
    if (editingCommentIndex === null || !post) return;
    try {
      await apiService.editComment(post._id, editingCommentIndex, editingCommentText.trim());
      setEditingCommentIndex(null);
      setEditingCommentText('');
      loadPost();
    } catch (err) {
      console.error('Error editing comment:', err);
    }
  };

  const deleteComment = async (idx: number) => {
    if (!post) return;
    try {
      await apiService.deleteComment(post._id, idx);
      loadPost();
    } catch (err) {
      console.error('Error deleting comment:', err);
    }
  };

  const startEditReply = (commentIndex: number, replyIndex: number, initial: string) => {
    setEditingReplyKey({ commentIndex, replyIndex });
    setEditingReplyText(initial || '');
  };

  const saveEditReply = async () => {
    if (!post || !editingReplyKey) return;
    try {
      await apiService.editReply(post._id, editingReplyKey.commentIndex, editingReplyKey.replyIndex, editingReplyText.trim());
      setEditingReplyKey(null);
      setEditingReplyText('');
      loadPost();
    } catch (err) {
      console.error('Error editing reply:', err);
    }
  };

  const deleteReply = async (commentIndex: number, replyIndex: number) => {
    if (!post) return;
    try {
      await apiService.deleteReply(post._id, commentIndex, replyIndex);
      loadPost();
    } catch (err) {
      console.error('Error deleting reply:', err);
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

  if (loading) {
    return (
      <View style={[globalStyles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={[globalStyles.container, styles.centered]}>
        <Text style={styles.emptyText}>Post not found.</Text>
      </View>
    );
  }

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.postCard}>
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
                <Image source={{ uri: getAvatarUri(post?.author?.avatar) }} style={[globalStyles.avatar, styles.avatarRing]} />
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
              onUserPress={(username: string) => navigation.navigate('Profile' as never, { username } as never)}
            />
          )}
          {post?.originalPostId && originalPost && (
            <View style={{
              backgroundColor: colors.bg,
              borderLeftColor: colors.border,
              borderLeftWidth: 3,
              paddingLeft: 10,
              paddingVertical: 6,
              marginBottom: 8,
            }}>
              <Text style={globalStyles.textMuted}>Original post</Text>
              <LinkedText
                text={originalPost.content}
                style={styles.postContent}
                onUserPress={(username: string) => navigation.navigate('Profile' as never, { username } as never)}
              />
            </View>
          )}

          {post.files && post.files.length > 0 && (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.mediaContainer}>
              {post.files.map((file, idx) => (
                <Image
                  key={idx}
                  source={{ uri: file.url }}
                  style={[styles.mediaImage, { width: screenWidth - 40, height: (screenWidth - 40) * 0.75 }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          )}

          <View style={styles.postActions}>
            <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
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
            <View style={styles.actionButton}>
              <Icon name="comment" size={20} color={colors.textMuted} />
              <Text style={styles.actionText}>{post.comments.length}</Text>
            </View>
          </View>
        </View>

        {/* Comments */}
        <View style={styles.commentsCard}>
          <Text style={styles.commentsTitle}>Comments</Text>
          {post.comments && post.comments.length > 0 ? (
            post.comments.slice(0, 20).map((c: any, idx: number) => {
              const author = c.author || c.user || {};
              const commentBody = c.content || c.comment || c.text || '';
              const canEdit = !!currentUser && author?.username === currentUser.username;
              return (
                <View key={idx} style={styles.commentItem}>
                  <Image source={{ uri: getAvatarUri(author?.avatar) }} style={styles.commentAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commentAuthor}>{author?.name || author?.username || 'User'}</Text>
                    {editingCommentIndex === idx ? (
                      <View style={styles.commentInputRow}>
                        <TextInput
                          style={styles.commentInput}
                          value={editingCommentText}
                          onChangeText={setEditingCommentText}
                          placeholder="Edit your comment"
                          placeholderTextColor={colors.textMuted}
                        />
                        <TouchableOpacity style={globalStyles.button} onPress={saveEditComment}>
                          <Text style={globalStyles.buttonText}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <LinkedText
                        text={commentBody}
                        style={styles.commentText}
                        onUserPress={(username: string) => navigation.navigate('Profile' as never, { username } as never)}
                      />
                    )}
                    <View style={{ ...globalStyles.flexRow, marginTop: 6 }}>
                      <TouchableOpacity onPress={() => startReply(idx)} style={{ marginRight: 12 }}>
                        <Text style={{ color: colors.textMuted }}>Reply</Text>
                      </TouchableOpacity>
                      {canEdit && (
                        <>
                          <TouchableOpacity onPress={() => startEditComment(idx, commentBody)} style={{ marginRight: 12 }}>
                            <Text style={{ color: colors.textMuted }}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteComment(idx)}>
                            <Text style={{ color: colors.textMuted }}>Delete</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>

                    {/* Replies */}
                    {Array.isArray(c.replies) && c.replies.length > 0 && (
                      <View style={{ marginTop: 8 }}>
                        {c.replies.map((r: any, rIdx: number) => {
                          const rAuthor = r.author || r.user || {};
                          const rBody = r.content || r.comment || r.text || '';
                          const rCanEdit = !!currentUser && rAuthor?.username === currentUser.username;
                          const isEditingThisReply = !!editingReplyKey && editingReplyKey.commentIndex === idx && editingReplyKey.replyIndex === rIdx;
                          return (
                            <View key={rIdx} style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
                              <Image source={{ uri: getAvatarUri(rAuthor?.avatar) }} style={[styles.commentAvatar, { width: 22, height: 22, borderRadius: 11 }]} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.commentAuthor}>{rAuthor?.name || rAuthor?.username || 'User'}</Text>
                                {isEditingThisReply ? (
                                  <View style={styles.commentInputRow}>
                                    <TextInput
                                      style={styles.commentInput}
                                      value={editingReplyText}
                                      onChangeText={setEditingReplyText}
                                      placeholder="Edit your reply"
                                      placeholderTextColor={colors.textMuted}
                                    />
                                    <TouchableOpacity style={globalStyles.button} onPress={saveEditReply}>
                                      <Text style={globalStyles.buttonText}>Save</Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : (
                                  <LinkedText
                                    text={rBody}
                                    style={styles.commentText}
                                    onUserPress={(username: string) => navigation.navigate('Profile' as never, { username } as never)}
                                  />
                                )}
                                {rCanEdit && (
                                  <View style={{ ...globalStyles.flexRow, marginTop: 4 }}>
                                    <TouchableOpacity onPress={() => startEditReply(idx, rIdx, rBody)} style={{ marginRight: 12 }}>
                                      <Text style={{ color: colors.textMuted }}>Edit</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => deleteReply(idx, rIdx)}>
                                      <Text style={{ color: colors.textMuted }}>Delete</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* Reply input */}
                    {replyingToIndex === idx && (
                      <View style={[styles.commentInputRow, { marginTop: 8 }] }>
                        <TextInput
                          style={styles.commentInput}
                          value={replyText}
                          onChangeText={setReplyText}
                          placeholder="Write a reply..."
                          placeholderTextColor={colors.textMuted}
                        />
                        <TouchableOpacity style={globalStyles.button} onPress={submitReply}>
                          <Text style={globalStyles.buttonText}>Reply</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={globalStyles.textMuted}>No comments yet.</Text>
          )}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder="Write a comment..."
              placeholderTextColor={colors.textMuted}
              value={commentText}
              onChangeText={setCommentText}
            />
            <TouchableOpacity style={globalStyles.button} onPress={handleComment}>
              <Text style={globalStyles.buttonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    backgroundColor: colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  postCard: {
    backgroundColor: colors.surface,
    margin: 10,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  postHeader: {
    ...globalStyles.flexRowBetween,
    marginBottom: 10,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarRing: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 20,
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
  authorInfo: {
    marginLeft: 10,
  },
  authorName: {
    color: colors.text,
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
  },
  mediaImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginRight: 10,
  },
  postActions: {
    ...globalStyles.flexRow,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    ...globalStyles.flexRow,
    marginRight: 20,
    alignItems: 'center',
  },
  actionText: {
    color: colors.textMuted,
    marginLeft: 5,
    fontSize: 14,
  },
  commentsCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 10,
    marginBottom: 20,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commentsTitle: {
    color: colors.text,
    fontWeight: 'bold',
    marginBottom: 10,
    fontSize: 16,
  },
  commentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  commentAuthor: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: 4,
  },
  commentText: {
    color: colors.text,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginRight: 10,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default PostDetailScreen;