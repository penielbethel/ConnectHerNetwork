import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import socketService from '../services/SocketService';
import ApiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';

type IncomingParams = {
  communityId: string;
  communityName: string;
  caller: { username: string; name?: string; avatar?: string };
  type: 'audio' | 'video';
};

const CommunityIncomingCallScreen: React.FC = () => {
  const route = useRoute<RouteProp<{ params: IncomingParams }, 'params'>>();
  const navigation = useNavigation();
  const { communityId, communityName, caller, type } = route.params;
  const [me, setMe] = useState<{ username: string; name?: string; avatar?: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('currentUser');
        const u = raw ? JSON.parse(raw) : null;
        setMe(u ? { username: u.username, name: u.name, avatar: u.avatar } : null);
      } catch (_) {}
    })();
  }, []);

  const handleAccept = async () => {
    try {
      if (!me?.username) return;
      try {
        const api = new ApiService();
        await api.logCall(caller.username, me.username, 'accepted', type);
      } catch (e) {
        // non-fatal
      }
      socketService.joinGroupCall({
        username: me.username,
        communityId,
        communityName,
        name: me.name || me.username,
        avatar: me.avatar,
      });
      // Navigate to active call screen
      // @ts-ignore
      navigation.navigate('CommunityCall', {
        communityId,
        communityName,
        mode: 'callee',
        type,
        caller,
      });
    } catch (e) {
      Alert.alert('Join failed', 'Could not join the group call.');
    }
  };

  const handleDecline = async () => {
    try {
      if (!me?.username) return;
      try {
        const api = new ApiService();
        await api.logCall(caller.username, me.username, 'declined', type);
      } catch (e) {
        // non-fatal
      }
      socketService.declineGroupCall({ communityId, username: me.username });
      // @ts-ignore
      navigation.goBack();
    } catch (_) {
      // swallow
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Incoming {type === 'video' ? 'Video' : 'Voice'} Group Call</Text>
      <Text style={styles.subtitle}>Community: {communityName}</Text>
      <View style={styles.callerRow}>
        {caller?.avatar ? (
          <Image source={{ uri: caller.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}
        <Text style={styles.callerName}>{caller?.name || caller?.username}</Text>
      </View>
      <View style={styles.controls}>
        <TouchableOpacity style={[styles.btn, styles.accept]} onPress={handleAccept}>
          <Text style={styles.btnText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.decline]} onPress={handleDecline}>
          <Text style={styles.btnText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: colors.textMuted, fontSize: 14, marginBottom: 16 },
  callerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  avatar: { width: 60, height: 60, borderRadius: 30, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#333' },
  callerName: { color: colors.text, fontSize: 16 },
  controls: { ...globalStyles.flexRowCenter, gap: 16 },
  btn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24 },
  accept: { backgroundColor: '#2e7d32' },
  decline: { backgroundColor: '#d32f2f' },
  btnText: { color: '#fff', fontWeight: '600' },
});

export default CommunityIncomingCallScreen;