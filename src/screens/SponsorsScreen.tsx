import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useColorScheme, Image, FlatList, RefreshControl } from 'react-native';
import { colors, globalStyles } from '../styles/globalStyles';
import apiService from '../services/ApiService';

interface Sponsor {
  _id: string;
  companyName: string;
  objectives?: string;
  logo?: string;
  posts?: any[];
  postCount?: number;
  createdAt?: string;
}

const SponsorsScreen: React.FC = () => {
  const isDark = useColorScheme() === 'dark';
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const getAvatarUri = (uri?: string) => {
    if (!uri) return undefined as unknown as string;
    if (/^https?:\/\//i.test(uri)) return uri;
    return `${(apiService as any).rootUrl || 'https://connecther.network'}/${String(uri).replace(/^\/+/, '')}`;
  };

  const loadSponsors = async () => {
    try {
      const res = await apiService.request('/sponsors');
      setSponsors(Array.isArray(res) ? res : []);
    } catch (e) {
      console.error('Error loading sponsors:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSponsors();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSponsors();
    setRefreshing(false);
  };

  const renderSponsor = ({ item }: { item: Sponsor }) => (
    <View style={styles.card}>
      {item.logo ? (
        <Image source={{ uri: getAvatarUri(item.logo) }} style={styles.logo} />
      ) : null}
      <Text style={styles.company}>{item.companyName}</Text>
      {!!item.objectives && <Text style={styles.objectives}>{item.objectives}</Text>}
      <Text style={styles.meta}>Posts: {item.postCount ?? item.posts?.length ?? 0}</Text>
    </View>
  );

  return (
    <View style={globalStyles.container}>
      <View style={styles.header}> 
        <Text style={styles.headerTitle}>Sponsors</Text>
      </View>
      <View style={styles.content}>
        {loading ? (
          <Text style={styles.placeholder}>Loading sponsors...</Text>
        ) : (
          <FlatList
            data={sponsors}
            keyExtractor={(s) => s._id}
            renderItem={renderSponsor}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={'#e91e63'} />
            }
            ListEmptyComponent={<Text style={styles.placeholder}>No sponsors found.</Text>}
            contentContainerStyle={sponsors.length === 0 ? styles.emptyContainer : undefined}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    backgroundColor: colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#e91e63',
  },
  content: {
    ...globalStyles.padding,
  },
  emptyContainer: {
    ...globalStyles.padding,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    color: colors.text,
    fontSize: 16,
    marginBottom: 6,
  },
  subtext: {
    color: colors.textMuted,
    fontSize: 14,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 8,
  },
  company: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  objectives: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
});

export default SponsorsScreen;