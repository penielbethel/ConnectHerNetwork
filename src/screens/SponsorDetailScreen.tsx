import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Image, FlatList, TouchableOpacity, RefreshControl, ScrollView, Linking } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { colors, globalStyles } from '../styles/globalStyles';
import apiService from '../services/ApiService';
import type { RootStackParamList } from '../types/navigation';

type SponsorDetailRouteProp = RouteProp<RootStackParamList, 'SponsorDetail'>;

interface SponsorPost {
  _id: string;
  title?: string;
  caption?: string;
  content?: string;
  media?: { url: string; type?: string; thumbnailUrl?: string }[];
  createdAt?: string;
  jobLink?: string;
  postLink?: string;
}

interface SponsorProfile {
  _id: string;
  companyName: string;
  logo?: string;
  objectives?: string;
  location?: string;
  website?: string;
  posts?: SponsorPost[];
}

const SponsorDetailScreen: React.FC = () => {
  const route = useRoute<SponsorDetailRouteProp>();
  const navigation = useNavigation();
  const { sponsorId, name } = route.params;
  const [profile, setProfile] = useState<SponsorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const getAssetUri = (uri?: string) => {
    if (!uri) return undefined as unknown as string;
    if (/^https?:\/\//i.test(uri)) return uri;
    return `${(apiService as any).rootUrl || 'https://connecther.network'}/${String(uri).replace(/^\/+/, '')}`;
  };

  useEffect(() => {
    navigation.setOptions({ title: name || 'Sponsor' });
    loadSponsor();
  }, [sponsorId]);

  const loadSponsor = async () => {
    try {
      // Try canonical endpoint, fall back to generic list filter if needed
      let res: any = null;
      try {
        res = await apiService.request(`/sponsors/${sponsorId}`);
      } catch (_e) {
        // Fallback: fetch all and find by id
        const list = await apiService.request('/sponsors');
        res = Array.isArray(list) ? list.find((s: any) => s._id === sponsorId) : null;
      }
      if (res) {
        const profile: SponsorProfile = {
          _id: res._id,
          companyName: res.companyName || res.name || name || 'Sponsor',
          logo: res.logo,
          objectives: res.objectives,
          location: res.location,
          website: res.website,
          posts: Array.isArray(res.posts) ? res.posts : [],
        };
        setProfile(profile);
      } else {
        setProfile(null);
      }
    } catch (e) {
      console.error('Failed to load sponsor:', e);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSponsor();
    setRefreshing(false);
  };

  const renderPost = ({ item }: { item: SponsorPost }) => {
    const title = item.title || item.caption || 'Opportunity';
    const description = item.content || item.caption || '';
    const thumb = item.media?.[0]?.thumbnailUrl || item.media?.[0]?.url;
    const link = item.postLink || item.jobLink;
    return (
      <View style={styles.postCard}>
        {thumb ? <Image source={{ uri: getAssetUri(thumb) }} style={styles.postImage} /> : null}
        <Text style={styles.postTitle}>{title}</Text>
        {description ? <Text style={styles.postDesc} numberOfLines={3}>{description}</Text> : null}
        <View style={styles.postMetaRow}>
          <Text style={styles.postMetaText}>{new Date(item.createdAt || Date.now()).toLocaleDateString()}</Text>
          {link ? (
            <TouchableOpacity style={styles.linkBtn} onPress={() => Linking.openURL(link!)}>
              <Text style={styles.linkBtnText}>Open Link</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[globalStyles.container, styles.center]}>
        <Text style={styles.placeholder}>Loading sponsor...</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[globalStyles.container, styles.center]}>
        <Text style={styles.placeholder}>Sponsor not found.</Text>
      </View>
    );
  }

  return (
    <View style={globalStyles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={'#e91e63'} />}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}> 
          {profile.logo ? (
            <Image source={{ uri: getAssetUri(profile.logo) }} style={styles.logo} />
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.company}>{profile.companyName}</Text>
            {profile.location ? <Text style={styles.location}>{profile.location}</Text> : null}
            {profile.website ? (
              <Text style={styles.website} numberOfLines={1}>{profile.website}</Text>
            ) : null}
          </View>
        </View>

        {profile.objectives ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.sectionBody}>{profile.objectives}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Posts & Opportunities</Text>
          {Array.isArray(profile.posts) && profile.posts.length > 0 ? (
            <FlatList
              data={profile.posts}
              keyExtractor={(p) => p._id}
              renderItem={renderPost}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              scrollEnabled={false}
            />
          ) : (
            <Text style={styles.placeholder}>No posts yet.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    color: colors.text,
    fontSize: 16,
    marginBottom: 6,
  },
  scrollContent: {
    paddingBottom: 30,
  },
  header: {
    ...globalStyles.padding,
    ...globalStyles.flexRow,
    alignItems: 'center',
    borderBottomWidth: 0,
    backgroundColor: '#ffe3ef',
    paddingVertical: 16,
    shadowColor: '#e91e63',
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  company: {
    color: '#c2185b',
    fontSize: 18,
    fontWeight: '700',
  },
  location: {
    color: '#7a2750',
    fontSize: 14,
    marginTop: 2,
  },
  website: {
    color: '#c2185b',
    fontSize: 12,
    marginTop: 2,
  },
  section: {
    ...globalStyles.padding,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  postCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
  },
  postImage: {
    width: '100%',
    height: 160,
    borderRadius: 6,
    marginBottom: 8,
  },
  postTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  postDesc: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  postMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  linkBtn: {
    backgroundColor: '#e91e63',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
  },
  linkBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  postMetaText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});

export default SponsorDetailScreen;