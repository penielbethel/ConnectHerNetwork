import io, {Socket} from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

class SocketService {
  private static instance: SocketService | null = null;
  private socket: Socket | null = null;
  private baseUrl = 'https://connecther.network';
  private currentUsername: string | null = null;

  initialize() {
    if (!this.socket) {
      this.socket = io(this.baseUrl, {
        transports: ['websocket'],
        autoConnect: true,
      });

      this.setupEventListeners();
    }
    return this.socket;
  }

  private setupEventListeners() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('✅ Socket connected');
      this.registerUser();
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    // Debug: log incoming group call-related events to aid live error tracking
    this.socket.on('incoming-group-call', (data: any) => {
      try {
        console.log('[socket] incoming-group-call:', JSON.stringify(data));
      } catch (_) {
        console.log('[socket] incoming-group-call received');
      }
    });
    this.socket.on('group-call-start', (data: any) => {
      try {
        console.log('[socket] group-call-start:', JSON.stringify(data));
      } catch (_) {
        console.log('[socket] group-call-start received');
      }
    });
  }

  private async registerUser() {
    try {
      const currentUser = await AsyncStorage.getItem('currentUser');
      if (currentUser && this.socket) {
        const user = JSON.parse(currentUser);
        this.currentUsername = user?.username || null;
        this.socket.emit('register', user.username);
      }
    } catch (error) {
      console.error('Error registering user:', error);
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  emit(event: string, data: any) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  on(event: string, callback: (data: any) => void) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event: string, callback?: (data: any) => void) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Message related methods
  sendMessage(data: {
    from: string;
    to: string;
    message: string;
    files?: any[];
    replyTo?: string;
  }) {
    this.emit('private-message', data);
  }

  // Join a private room between two users
  joinRoom(user1: string, user2: string) {
    this.emit('joinRoom', { user1, user2 });
  }

  // Leave a private room between two users
  leaveRoom(user1: string, user2: string) {
    // Socket.IO server will handle leaving when navigating away if needed.
    // Provide a helper for symmetry and future use.
    this.emit('leaveRoom', { user1, user2 });
  }

  sendCommunityMessage(data: {
    room: string;
    from: string;
    message: string;
    files?: any[];
    replyTo?: string;
  }) {
    this.emit('community-message', data);
  }

  joinCommunity(communityId: string) {
    this.emit('join-community', communityId);
  }

  leaveCommunity(communityId: string) {
    this.emit('leave-community', communityId);
  }

  // Typing indicators
  startTyping(to: string) {
    const from = this.currentUsername;
    if (!from) {
      // Attempt lazy load of username if not set yet
      AsyncStorage.getItem('currentUser')
        .then(userStr => {
          const user = userStr ? JSON.parse(userStr) : null;
          this.currentUsername = user?.username || null;
          this.emit('typing', {from: this.currentUsername, to});
        })
        .catch(() => this.emit('typing', {from: '', to}));
      return;
    }
    this.emit('typing', {from, to});
  }

  stopTyping(to: string) {
    const from = this.currentUsername;
    if (!from) {
      // Attempt lazy load of username if not set yet
      AsyncStorage.getItem('currentUser')
        .then(userStr => {
          const user = userStr ? JSON.parse(userStr) : null;
          this.currentUsername = user?.username || null;
          this.emit('stopTyping', {from: this.currentUsername, to});
        })
        .catch(() => this.emit('stopTyping', {from: '', to}));
      return;
    }
    this.emit('stopTyping', {from, to});
  }

  startCommunityTyping(room: string, from: string) {
    this.emit('typing-community', {room, from});
  }

  stopCommunityTyping(room: string, from: string) {
    this.emit('stopTyping-community', {room, from});
  }

  // =====================
  // Group Call (Community)
  // =====================
  startGroupCall(data: { from: string; communityId: string; communityName: string; members: string[]; type?: 'audio' | 'video' }) {
    this.emit('incoming-group-call', data);
  }

  joinGroupCall(data: { username: string; communityId: string; communityName: string; name: string; avatar?: string }) {
    this.emit('join-group-call', data);
  }

  leaveGroupCall(data: { communityId: string; username: string }) {
    this.emit('leave-group-call', data);
  }

  declineGroupCall(data: { communityId: string; username: string }) {
    this.emit('decline-group-call', data);
  }

  onGroupCallStart(callback: (data: { communityId: string; communityName: string }) => void) {
    this.on('group-call-start', callback);
  }

  onIncomingGroupCall(callback: (data: { from: string; communityId: string; communityName: string; type?: 'audio' | 'video' }) => void) {
    this.on('incoming-group-call', callback);
  }

  // Call related methods
  initiateCall(data: {
    from: string;
    to: string;
    type: 'audio' | 'video';
    offer: any;
  }) {
    this.emit('private-offer', data);
  }

  acceptCall(data: {
    from: string;
    to: string;
  }) {
    this.emit('accept-call', data);
  }

  rejectCall(data: {
    from: string;
    to: string;
  }) {
    this.emit('decline-call', data);
  }

  endCall(data: {
    from: string;
    to: string;
  }) {
    this.emit('private-end-call', data);
  }
}

// True singleton instance to keep one socket across the app lifetime
const socketServiceSingleton = (() => {
  if (!SocketService.instance) {
    SocketService.instance = new SocketService();
  }
  return SocketService.instance;
})();

const socketServiceProxy = {
  initialize: () => socketServiceSingleton.initialize(),
  getSocket: () => socketServiceSingleton.getSocket(),
  emit: (event: string, data: any) => socketServiceSingleton.emit(event, data),
  on: (event: string, callback: (data: any) => void) => socketServiceSingleton.on(event, callback),
  off: (event: string, callback?: (data: any) => void) => socketServiceSingleton.off(event, callback),
  disconnect: () => socketServiceSingleton.disconnect(),
  // Message helpers
  sendMessage: (data: { from: string; to: string; message: string; files?: any[]; replyTo?: string }) => socketServiceSingleton.sendMessage(data),
  sendCommunityMessage: (data: { room: string; from: string; message: string; files?: any[]; replyTo?: string }) => socketServiceSingleton.sendCommunityMessage(data),
  joinCommunity: (communityId: string) => socketServiceSingleton.joinCommunity(communityId),
  leaveCommunity: (communityId: string) => socketServiceSingleton.leaveCommunity(communityId),
  startTyping: (to: string) => socketServiceSingleton.startTyping(to),
  stopTyping: (to: string) => socketServiceSingleton.stopTyping(to),
  startCommunityTyping: (room: string, from: string) => socketServiceSingleton.startCommunityTyping(room, from),
  stopCommunityTyping: (room: string, from: string) => socketServiceSingleton.stopCommunityTyping(room, from),
  // Group call helpers
  startGroupCall: (data: { from: string; communityId: string; communityName: string; members: string[] }) => socketServiceSingleton.startGroupCall(data),
  joinGroupCall: (data: { username: string; communityId: string; communityName: string; name: string; avatar?: string }) => socketServiceSingleton.joinGroupCall(data),
  leaveGroupCall: (data: { communityId: string; username: string }) => socketServiceSingleton.leaveGroupCall(data),
  declineGroupCall: (data: { communityId: string; username: string }) => socketServiceSingleton.declineGroupCall(data),
  onGroupCallStart: (callback: (data: { communityId: string; communityName: string }) => void) => socketServiceSingleton.onGroupCallStart(callback),
  onIncomingGroupCall: (callback: (data: { from: string; communityId: string; communityName: string; type?: 'audio' | 'video' }) => void) => socketServiceSingleton.onIncomingGroupCall(callback),
  initiateCall: (data: { from: string; to: string; type: 'audio' | 'video'; offer: any }) => socketServiceSingleton.initiateCall(data),
  acceptCall: (data: { from: string; to: string }) => socketServiceSingleton.acceptCall(data),
  rejectCall: (data: { from: string; to: string }) => socketServiceSingleton.rejectCall(data),
  endCall: (data: { from: string; to: string }) => socketServiceSingleton.endCall(data),
};

export const initializeSocket = () => {
  return socketServiceProxy.initialize();
};

export default socketServiceProxy;