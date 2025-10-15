import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Image } from 'react-native';

type Props = {
  visible: boolean;
  callerName: string;
  callerAvatar?: string;
  callType: 'audio' | 'video';
  onAccept: () => void;
  onDecline: () => void;
};

const IncomingCallModal: React.FC<Props> = ({ visible, callerName, callerAvatar, callType, onAccept, onDecline }) => {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Image
            source={{ uri: callerAvatar || 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png' }}
            style={styles.avatar}
          />
          <Text style={styles.title}>Incoming {callType === 'video' ? 'video' : 'voice'} call</Text>
          <Text style={styles.subtitle}>{callerName}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.acceptBtn} onPress={onAccept}>
              <Text style={styles.btnText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.declineBtn} onPress={onDecline}>
              <Text style={styles.btnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
  },
  container: {
    width: '92%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#333',
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  acceptBtn: {
    backgroundColor: '#00c853',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  declineBtn: {
    backgroundColor: '#d50000',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default IncomingCallModal;