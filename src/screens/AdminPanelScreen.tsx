import React, { useEffect, useState, useContext } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  StyleSheet,
  TextInput,
  Image,
} from 'react-native';
import apiService from '../services/ApiService';
import { globalStyles, colors } from '../styles/globalStyles';
import { ThemeContext } from '../context/ThemeContext';
import DocumentPicker from 'react-native-document-picker';

type Sponsor = {
  _id: string;
  companyName: string;
  logo?: string;
  objectives?: string;
};

type SponsorPost = {
  _id: string;
  media?: string;
  caption?: string;
  jobLink?: string;
  views?: number;
  clicks?: number;
};

const AdminPanelScreen: React.FC = () => {
  const { theme } = useContext(ThemeContext);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [expandedSponsor, setExpandedSponsor] = useState<string | null>(null);
  const [postsBySponsor, setPostsBySponsor] = useState<Record<string, SponsorPost[]>>({});

  // Register Sponsor form state
  const [companyName, setCompanyName] = useState('');
  const [objectives, setObjectives] = useState('');
  const [logoFile, setLogoFile] = useState<any | null>(null);

  // Post modal-equivalent state (inline controls)
  const [activeSponsorForPost, setActiveSponsorForPost] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState('');
  const [postJobLink, setPostJobLink] = useState('');
  const [postMediaFile, setPostMediaFile] = useState<any | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [countRes, sponsorsRes] = await Promise.all([
        apiService.request('/users/count'),
        apiService.request('/sponsors'),
      ]);
      setUserCount((countRes as any)?.count ?? null);
      setSponsors(Array.isArray(sponsorsRes) ? sponsorsRes : []);
    } catch (e: any) {
      console.error('AdminPanel load error:', e);
      setError(e?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRegisterSponsor = async () => {
    try {
      if (!companyName || !objectives || !logoFile) {
        Alert.alert('Missing Fields', 'Company name, objectives, and logo are required.');
        return;
      }
      const formData = new FormData();
      formData.append('companyName', companyName);
      formData.append('objectives', objectives);
      // Expect logoFile to have uri, name, type
      formData.append('logo', logoFile as any);

      await apiService.request('/sponsors/register', {
        method: 'POST',
        // Let fetch set boundary automatically for multipart
        body: formData,
      });
      Alert.alert('Success', 'Sponsor registered');
      setCompanyName('');
      setObjectives('');
      setLogoFile(null);
      await loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to register sponsor');
    }
  };

  const handleDeleteSponsor = async (sponsorId: string) => {
    try {
      await apiService.request(`/sponsors/${sponsorId}`, { method: 'DELETE' });
      Alert.alert('Deleted', 'Sponsor removed');
      await loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to delete sponsor');
    }
  };

  const togglePosts = async (sponsorId: string) => {
    try {
      if (expandedSponsor === sponsorId) {
        setExpandedSponsor(null);
        return;
      }
      const res = await apiService.request(`/sponsors/${sponsorId}/posts`);
      const posts: SponsorPost[] = Array.isArray(res) ? res : [];
      setPostsBySponsor((prev) => ({ ...prev, [sponsorId]: posts }));
      setExpandedSponsor(sponsorId);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load sponsor posts');
    }
  };

  const startEditPost = (sponsorId: string, post: SponsorPost) => {
    setActiveSponsorForPost(sponsorId);
    setEditingPostId(post._id);
    setPostCaption(post.caption || '');
    setPostJobLink(post.jobLink || '');
    setPostMediaFile(null);
  };

  const resetPostForm = () => {
    setActiveSponsorForPost(null);
    setEditingPostId(null);
    setPostCaption('');
    setPostJobLink('');
    setPostMediaFile(null);
  };

  const submitPost = async () => {
    try {
      if (!activeSponsorForPost) {
        Alert.alert('No Sponsor', 'Select a sponsor first.');
        return;
      }
      const formData = new FormData();
      if (postMediaFile) formData.append('media', postMediaFile as any);
      formData.append('caption', postCaption.trim() || 'No caption provided');
      formData.append('jobLink', postJobLink.trim() || '#');

      const url = editingPostId
        ? `/sponsors/${activeSponsorForPost}/posts/${editingPostId}`
        : `/sponsors/${activeSponsorForPost}/post`;

      await apiService.request(url, { method: 'PUT', body: formData });
      Alert.alert(editingPostId ? 'Updated' : 'Added', editingPostId ? 'Post updated' : 'Post added');
      resetPostForm();
      // Refresh posts if visible
      if (expandedSponsor === activeSponsorForPost) await togglePosts(activeSponsorForPost);
    } catch (e: any) {
      console.error('submitPost error:', e);
      Alert.alert('Error', e?.message || 'Failed to save post');
    }
  };

  const deletePost = async (sponsorId: string, postId: string) => {
    try {
      await apiService.request(`/sponsors/${sponsorId}/posts/${postId}`, { method: 'DELETE' });
      Alert.alert('Deleted', 'Post removed');
      if (expandedSponsor === sponsorId) await togglePosts(sponsorId);
    } catch (e: any) {
      const msg = e?.message || 'Failed to delete post';
      Alert.alert('Error', msg);
    }
  };

  if (loading) {
    return (
      <View style={[globalStyles.container, globalStyles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[globalStyles.textMuted, { marginTop: 10 }]}>Loading Admin data…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[globalStyles.container, globalStyles.centered]}>
        <Text style={[globalStyles.text, { color: '#ff6b6b' }]}>Error: {error}</Text>
        <TouchableOpacity style={[globalStyles.button, { marginTop: 10 }]} onPress={loadData}>
          <Text style={globalStyles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={[globalStyles.container, { backgroundColor: theme === 'dark' ? colors.dark.bg : colors.light.bg }]}
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      <Text style={styles.sectionTitle}>Overview</Text>
      <View style={[styles.card, theme === 'dark' ? null : { backgroundColor: colors.light.card, borderColor: colors.border }]}>
        <View style={styles.row}>
          <Text style={styles.keyText}>Total Users</Text>
          <Text style={styles.valueText}>{userCount ?? '—'}</Text>
        </View>
        <TouchableOpacity style={[globalStyles.button, { marginTop: 10 }]} onPress={loadData}>
          <Text style={globalStyles.buttonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Register Sponsor</Text>
      <View style={[styles.card, theme === 'dark' ? null : { backgroundColor: colors.light.card, borderColor: colors.border }]}>
        <TextInput
          style={styles.input}
          placeholder="Company Name"
          placeholderTextColor={colors.text + '80'}
          value={companyName}
          onChangeText={setCompanyName}
        />
        <TextInput
          style={[styles.input, { height: 90 }]}
          placeholder="Objectives"
          placeholderTextColor={colors.text + '80'}
          multiline
          value={objectives}
          onChangeText={setObjectives}
        />
        {/* Simple file picker hint: on native, integrate ImagePicker to set logoFile */}
        <TouchableOpacity
          style={[globalStyles.secondaryButton, { marginBottom: 10 }]}
          onPress={async () => {
            try {
              const res = await DocumentPicker.pickSingle({
                type: [DocumentPicker.types.images, DocumentPicker.types.video, DocumentPicker.types.allFiles],
                copyTo: 'cachesDirectory',
              });
              setLogoFile({ uri: res.fileCopyUri || res.uri, name: res.name || 'upload', type: res.type || 'application/octet-stream' });
            } catch (e: any) {
              if (!DocumentPicker.isCancel(e)) Alert.alert('Picker Error', e?.message || 'Failed to pick file');
            }
          }}
        >
          <Text style={globalStyles.secondaryButtonText}>Select Logo / Media</Text>
        </TouchableOpacity>
        {logoFile && (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image source={{ uri: logoFile.uri }} style={{ width: 60, height: 60, borderRadius: 6, marginRight: 8 }} />
            <Text style={globalStyles.text}>{logoFile.name || 'logo.jpg'}</Text>
          </View>
        )}
        <TouchableOpacity style={[globalStyles.button, { marginTop: 10 }]} onPress={handleRegisterSponsor}>
          <Text style={globalStyles.buttonText}>Register Sponsor</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Registered Sponsors</Text>
      <View style={[styles.card, theme === 'dark' ? null : { backgroundColor: colors.light.card, borderColor: colors.border }]}>
        {sponsors.length > 0 ? (
          sponsors.map((s) => (
            <View key={s._id} style={{ marginBottom: 16 }}>
              <View style={[styles.row, { alignItems: 'center' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  {s.logo ? (
                    <Image source={{ uri: s.logo }} style={{ width: 50, height: 50, borderRadius: 6, marginRight: 10 }} />
                  ) : (
                    <View style={{ width: 50, height: 50, borderRadius: 6, marginRight: 10, backgroundColor: colors.bg }} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={globalStyles.text}>{s.companyName}</Text>
                    {s.objectives ? (
                      <Text style={[globalStyles.textMuted, { marginTop: 2 }]} numberOfLines={2}>{s.objectives}</Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={[globalStyles.secondaryButton, styles.smallButton]}
                  onPress={() => handleDeleteSponsor(s._id)}
                >
                  <Text style={globalStyles.secondaryButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <TouchableOpacity
                  style={[globalStyles.button, styles.smallButton]}
                  onPress={() => {
                    setActiveSponsorForPost(s._id);
                    setEditingPostId(null);
                    setPostCaption('');
                    setPostJobLink('');
                    setPostMediaFile(null);
                  }}
                >
                  <Text style={globalStyles.buttonText}>Post for Sponsor</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[globalStyles.secondaryButton, styles.smallButton]}
                  onPress={() => togglePosts(s._id)}
                >
                  <Text style={globalStyles.secondaryButtonText}>{expandedSponsor === s._id ? 'Hide Posts' : 'Show Posts'}</Text>
                </TouchableOpacity>
              </View>

              {expandedSponsor === s._id && (
                <View style={{ marginTop: 8 }}>
                  {(postsBySponsor[s._id] || []).map((p) => (
                    <View key={p._id} style={[styles.row, { alignItems: 'center' }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        {p.media ? (
                          <Image source={{ uri: p.media }} style={{ width: 50, height: 50, borderRadius: 6, marginRight: 10 }} />
                        ) : (
                          <View style={{ width: 50, height: 50, borderRadius: 6, marginRight: 10, backgroundColor: colors.bg }} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={globalStyles.text} numberOfLines={2}>{p.caption}</Text>
                          <Text style={[globalStyles.textMuted, { marginTop: 2 }]} numberOfLines={1}>{p.jobLink}</Text>
                          <Text style={[globalStyles.textMuted, { marginTop: 2 }]}>👁️ {p.views || 0} • 🔗 {p.clicks || 0}</Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[globalStyles.button, styles.smallButton]}
                        onPress={() => startEditPost(s._id, p)}
                      >
                        <Text style={globalStyles.buttonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[globalStyles.secondaryButton, styles.smallButton]}
                        onPress={() => deletePost(s._id, p._id)}
                      >
                        <Text style={globalStyles.secondaryButtonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {activeSponsorForPost === s._id && (
                <View style={{ marginTop: 10 }}>
                  {/* Media picker supporting any file type */}
                  <TouchableOpacity
                    style={[globalStyles.secondaryButton, { marginBottom: 8 }]}
                    onPress={async () => {
                      try {
                        const res = await DocumentPicker.pickSingle({
                          type: [
                            DocumentPicker.types.images,
                            DocumentPicker.types.video,
                            DocumentPicker.types.audio,
                            DocumentPicker.types.pdf,
                            DocumentPicker.types.plainText,
                            DocumentPicker.types.allFiles,
                          ],
                          copyTo: 'cachesDirectory',
                        });
                        setPostMediaFile({ uri: res.fileCopyUri || res.uri, name: res.name || 'media', type: res.type || 'application/octet-stream' });
                      } catch (e: any) {
                        if (!DocumentPicker.isCancel(e)) Alert.alert('Picker Error', e?.message || 'Failed to pick file');
                      }
                    }}
                  >
                    <Text style={globalStyles.secondaryButtonText}>Select Media (any file)</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.input}
                    placeholder="Caption"
                    placeholderTextColor={colors.text + '80'}
                    value={postCaption}
                    onChangeText={setPostCaption}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Job Link"
                    placeholderTextColor={colors.text + '80'}
                    value={postJobLink}
                    onChangeText={setPostJobLink}
                  />
                  <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity style={[globalStyles.button, styles.smallButton]} onPress={submitPost}>
                      <Text style={globalStyles.buttonText}>{editingPostId ? 'Update Post' : 'Submit Post'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[globalStyles.secondaryButton, styles.smallButton]} onPress={resetPostForm}>
                      <Text style={globalStyles.secondaryButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))
        ) : (
          <Text style={globalStyles.textMuted}>No sponsors found.</Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    marginHorizontal: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  keyText: {
    color: colors.text,
    fontWeight: '500',
    marginRight: 10,
  },
  valueText: {
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    backgroundColor: colors.card,
    marginBottom: 8,
  },
  smallButton: {
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});

export default AdminPanelScreen;