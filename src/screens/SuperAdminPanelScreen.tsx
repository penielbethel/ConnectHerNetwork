import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Share,
  TextInput,
  Linking,
} from 'react-native';
import adminService from '../services/AdminService';
import apiService from '../services/ApiService';
import { globalStyles, colors } from '../styles/globalStyles';

const SuperAdminPanelScreen: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [demoteUsername, setDemoteUsername] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsRes, usersRes] = await Promise.all([
        adminService.getAnalytics(),
        adminService.listUsers(),
      ]);
      setAnalytics((analyticsRes as any)?.analytics || analyticsRes || null);
      const rawUsers = Array.isArray((usersRes as any)?.users)
        ? (usersRes as any).users
        : Array.isArray(usersRes)
          ? usersRes
          : [];
      setUsers(rawUsers);
    } catch (e: any) {
      console.error('SuperAdminPanel load error:', e);
      setError(e?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGenerateInvite = async (role: 'admin' | 'superadmin') => {
    try {
      const res = await adminService.generateInvite(role);
      const code = (res as any)?.code || (res as any)?.token || JSON.stringify(res);
      setInviteCode(String(code));
      Alert.alert('Invite Generated', `Role: ${role}\nCode: ${code}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to generate invite');
    }
  };

  const handleCopyInvite = async () => {
    try {
      if (!inviteCode) {
        Alert.alert('No Invite', 'Generate an invite code first.');
        return;
      }
      await Share.share({ message: `ConnectHer ${inviteCode}` });
    } catch (e: any) {
      Alert.alert('Copy Failed', e?.message || 'Failed to copy/share invite code');
    }
  };

  const handlePromote = async (username: string) => {
    try {
      await adminService.promoteUser(username);
      Alert.alert('Success', `Promoted ${username}`);
      await loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.message || `Failed to promote ${username}`);
    }
  };

  const handleDemote = async (username: string) => {
    try {
      await adminService.demoteUser(username);
      Alert.alert('Success', `Demoted ${username}`);
      await loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.message || `Failed to demote ${username}`);
    }
  };

  const shareAnalyticsReport = async () => {
    try {
      if (!analytics) {
        Alert.alert('No Analytics', 'Analytics data is not available yet.');
        return;
      }
      const totalUsers = (analytics as any)?.totalUsers ?? 0;
      const countryStats = (analytics as any)?.countryStats || {};
      const ageRangeStats = (analytics as any)?.ageRangeStats || {};
      const genderStats = (analytics as any)?.genderStats || {};
      const roleStats = (analytics as any)?.roleStats || {};
      const registrationTrends = (analytics as any)?.registrationTrends || {};

      const formatSection = (title: string, obj: any) => {
        const entries = Object.entries(obj || {});
        if (entries.length === 0) return `${title}: none\n`;
        return `${title}:\n` + entries
          .map(([key, val]: any) => {
            const count = val?.count ?? val;
            const percentage = val?.percentage;
            return ` - ${key}: ${count}${percentage != null ? ` (${percentage}%)` : ''}`;
          })
          .join('\n') + '\n';
      };

      const summary =
        `ConnectHer Analytics Report\n` +
        `Generated: ${(analytics as any)?.generatedAt || new Date().toISOString()}\n` +
        `Total Users: ${totalUsers}\n\n` +
        formatSection('Users by Country', countryStats) +
        formatSection('Age Distribution', ageRangeStats) +
        formatSection('Gender Distribution', genderStats) +
        formatSection('User Roles', roleStats) +
        formatSection('Registration Trends (12 months)', registrationTrends);

      await Share.share({ message: summary });
    } catch (e: any) {
      Alert.alert('Share Failed', e?.message || 'Failed to share analytics report');
    }
  };

  const openAnalyticsPdf = async () => {
    try {
      const token = await (apiService as any)['getAuthToken']?.();
      const root: string = (apiService as any).rootUrl || 'https://connecther.network';
      if (!token) {
        Alert.alert('Not Authenticated', 'Missing auth token to open PDF.');
        return;
      }
      const url = `${root}/api/admin/analytics.pdf?token=${encodeURIComponent(token)}`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Cannot Open', 'Unable to open analytics PDF link.');
      }
    } catch (e: any) {
      Alert.alert('Open Failed', e?.message || 'Failed to open analytics PDF');
    }
  };

  if (loading) {
    return (
      <View style={[globalStyles.container, globalStyles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[globalStyles.textMuted, { marginTop: 10 }]}>Loading Super Admin data…</Text>
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
    <ScrollView style={globalStyles.container} contentContainerStyle={{ paddingBottom: 20 }}>
      <Text style={styles.sectionTitle}>Admin Analytics</Text>
      <View style={styles.card}>
        {analytics && Object.keys(analytics).length > 0 ? (
          Object.entries(analytics).map(([key, value]) => (
            <View key={key} style={styles.row}>
              <Text style={styles.keyText}>{key}</Text>
              <Text style={styles.valueText}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={globalStyles.textMuted}>No analytics available.</Text>
        )}
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          <TouchableOpacity
            style={[globalStyles.button, styles.actionButton]}
            onPress={loadData}
          >
            <Text style={globalStyles.buttonText}>Refresh Analytics</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[globalStyles.secondaryButton, styles.actionButton]}
            onPress={shareAnalyticsReport}
          >
            <Text style={globalStyles.secondaryButtonText}>Share Analytics Report</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[globalStyles.secondaryButton, styles.actionButton]}
            onPress={openAnalyticsPdf}
          >
            <Text style={globalStyles.secondaryButtonText}>Open PDF Report</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Generate Invites</Text>
      <View style={styles.card}>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity
            style={[globalStyles.button, styles.actionButton]}
            onPress={() => handleGenerateInvite('admin')}
          >
            <Text style={globalStyles.buttonText}>Admin Invite</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[globalStyles.secondaryButton, styles.actionButton]}
            onPress={() => handleGenerateInvite('superadmin')}
          >
            <Text style={globalStyles.secondaryButtonText}>Superadmin Invite</Text>
          </TouchableOpacity>
        </View>
        {inviteCode && (
          <View style={[styles.row, { marginTop: 10 }]}>
            <Text style={styles.keyText}>Latest Code</Text>
            <Text style={styles.valueText}>{inviteCode}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          <TouchableOpacity
            style={[globalStyles.button, styles.actionButton]}
            onPress={handleCopyInvite}
          >
            <Text style={globalStyles.buttonText}>Copy/Share Code</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>User Management</Text>
      <View style={styles.card}>
        <View style={{ marginBottom: 10 }}>
          <TextInput
            style={styles.input}
            placeholder="Search users by name, @username, or email"
            placeholderTextColor={colors.text + '80'}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        {users.length > 0 ? (
          users
            .filter((u) => {
              const q = searchQuery.trim().toLowerCase();
              if (!q) return true;
              const name = String(u?.name || '').toLowerCase();
              const usern = String(u?.username || '').toLowerCase();
              const email = String(u?.email || '').toLowerCase();
              return name.includes(q) || usern.includes(q) || email.includes(q);
            })
            .map((u) => (
            <View key={u?.username || Math.random()} style={[styles.row, { alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={globalStyles.text}>{u?.name || u?.username || 'Unknown'}</Text>
                <Text style={globalStyles.textMuted}>@{u?.username}</Text>
                {u?.email && (
                  <Text style={[globalStyles.textMuted, { marginTop: 2 }]}>{String(u.email)}</Text>
                )}
                {u?.role && (
                  <Text style={[globalStyles.textMuted, { marginTop: 2 }]}>Role: {String(u.role)}</Text>
                )}
              </View>
              <View style={{ flexDirection: 'row' }}>
                <TouchableOpacity
                  style={[globalStyles.button, styles.smallButton]}
                  onPress={() => handlePromote(u?.username)}
                >
                  <Text style={globalStyles.buttonText}>Promote</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[globalStyles.secondaryButton, styles.smallButton]}
                  onPress={() => handleDemote(u?.username)}
                >
                  <Text style={globalStyles.secondaryButtonText}>Demote</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        ) : (
          <Text style={globalStyles.textMuted}>No users found.</Text>
        )}
        <View style={{ marginTop: 12 }}>
          <Text style={styles.keyText}>Demote by @username</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Enter username"
              placeholderTextColor={colors.text + '80'}
              value={demoteUsername}
              onChangeText={setDemoteUsername}
            />
            <TouchableOpacity
              style={[globalStyles.secondaryButton, { marginLeft: 8 }]}
              onPress={() => demoteUsername.trim() && handleDemote(demoteUsername.trim())}
            >
              <Text style={globalStyles.secondaryButtonText}>Demote</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    backgroundColor: colors.card,
  },
  valueText: {
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  actionButton: {
    marginRight: 10,
  },
  smallButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});

export default SuperAdminPanelScreen;