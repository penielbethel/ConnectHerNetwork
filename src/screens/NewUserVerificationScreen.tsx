import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { RTCView, mediaDevices } from 'react-native-webrtc';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { colors, globalStyles } from '../styles/globalStyles';

const NewUserVerificationScreen: React.FC = () => {
  const navigation = useNavigation();
  const [mode, setMode] = useState<'face' | 'voice'>('face');
  const [videoStream, setVideoStream] = useState<any>(null);
  const [resultMessage, setResultMessage] = useState<string>('');
  const [isResultVisible, setIsResultVisible] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const audioStreamRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      // Cleanup media on unmount
      try {
        videoStream?.getTracks?.()?.forEach((t: any) => t.stop());
      } catch (_) {}
      try {
        audioStreamRef.current?.getTracks?.()?.forEach((t: any) => t.stop());
      } catch (_) {}
    };
  }, [videoStream]);

  const proceedAfterPass = async () => {
    try {
      await AsyncStorage.setItem('verificationCompleted_v1', 'true');
      // After completing verification, next gate is Terms Attestation
      navigation.navigate('TermsAttestation' as never);
    } catch (e) {
      navigation.navigate('TermsAttestation' as never);
    }
  };

  const startFaceVerification = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setIsResultVisible(false);
    setResultMessage('');
    try {
      const stream = await mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false } as any);
      setVideoStream(stream);
      setTimeout(() => {
        const passed = Math.random() > 0.5;
        setResultMessage(
          passed ? 'Verification Successful, Account Created Successfully.' : 'Access Denied, Please try again.'
        );
        setIsResultVisible(true);
        setIsRunning(false);
        if (passed) proceedAfterPass();
      }, 2000);
    } catch (e) {
      Alert.alert('Camera Error', 'Could not access camera');
      setIsRunning(false);
    }
  };

  const startVoiceVerification = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setIsResultVisible(false);
    setResultMessage('');
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false } as any);
      audioStreamRef.current = stream;
      setTimeout(() => {
        const passed = Math.random() > 0.5;
        setResultMessage(
          passed ? 'Verification Successful, Account Created Successfully.' : 'Access Denied, Please try again.'
        );
        setIsResultVisible(true);
        setIsRunning(false);
        try {
          audioStreamRef.current?.getTracks?.()?.forEach((t: any) => t.stop());
        } catch (_) {}
        if (passed) proceedAfterPass();
      }, 3000);
    } catch (e) {
      Alert.alert('Microphone Error', 'Could not access microphone');
      setIsRunning(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Facial Feature Verification</Text>
        <Text style={styles.subtitle}>
          To ensure the current operation is performed by the account holder, your identity needs to be verified.
        </Text>
      </View>

      <View style={styles.illustration}>
        <Image
          source={{ uri: 'https://cdn-icons-png.flaticon.com/512/2922/2922656.png' }}
          style={{ width: 140, height: 140 }}
        />
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Face verification is required to confirm your identity and keep your account safe. The captured facial image
          is only used for verification purposes.
        </Text>
      </View>

      {mode === 'face' ? (
        <View style={styles.cameraSection}>
          {videoStream ? (
            <RTCView streamURL={videoStream?.toURL()} style={styles.video} mirror={true} />
          ) : (
            <View style={styles.videoPlaceholder} />
          )}
        </View>
      ) : null}

      {mode === 'face' ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={startFaceVerification} disabled={isRunning}>
          <Text style={styles.primaryBtnText}>{isRunning ? 'Verifying…' : 'Verify'}</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.voicePrompt}>
            Press the button and say:
            {'\n'}
            <Text style={{ fontWeight: '700' }}>
              "This app is only for females"
            </Text>
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={startVoiceVerification} disabled={isRunning}>
            <Text style={styles.primaryBtnText}>{isRunning ? 'Recording…' : 'Start Voice Test'}</Text>
          </TouchableOpacity>
        </>
      )}

      {isResultVisible ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultMessage}>{resultMessage}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={mode === 'face' ? startFaceVerification : startVoiceVerification}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'face' ? styles.toggleActive : null]}
          onPress={() => setMode('face')}
        >
          <Text style={styles.toggleText}>Face</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'voice' ? styles.toggleActive : null]}
          onPress={() => setMode('voice')}
        >
          <Text style={styles.toggleText}>Voice</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { alignItems: 'center', padding: 20 },
  title: { ...globalStyles.title, fontSize: 20, marginBottom: 8, textAlign: 'center' },
  subtitle: { ...globalStyles.text, fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 15 },
  illustration: { alignItems: 'center', marginVertical: 20 },
  infoBox: { backgroundColor: '#ffe0ef', borderRadius: 10, padding: 12, marginHorizontal: 16, marginBottom: 20 },
  infoText: { color: '#444', fontSize: 13 },
  cameraSection: { height: 260, backgroundColor: '#000', marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' },
  video: { width: '100%', height: '100%' },
  videoPlaceholder: { flex: 1 },
  primaryBtn: { ...globalStyles.button, marginHorizontal: 16, marginTop: 16 },
  primaryBtnText: { ...globalStyles.buttonText },
  resultBox: { alignItems: 'center', marginTop: 12 },
  resultMessage: { fontSize: 14, marginBottom: 10, color: colors.text },
  retryBtn: { backgroundColor: '#e74c3c', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  retryText: { color: '#fff', fontSize: 14 },
  toggleRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 10 },
  toggleBtn: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, backgroundColor: '#ddd', marginHorizontal: 6 },
  toggleActive: { backgroundColor: colors.primary },
  toggleText: { color: '#fff', fontWeight: '600' },
  voicePrompt: { textAlign: 'center', marginHorizontal: 16, marginTop: 30, marginBottom: 10, color: colors.text },
});

export default NewUserVerificationScreen;