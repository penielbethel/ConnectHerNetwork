export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Chat: undefined;
  Conversation: {
    chatId?: string;
    recipientUsername: string;
    recipientName: string;
    recipientAvatar: string;
  };
  Call: {
    to: string;
    type: 'audio' | 'video';
    mode?: 'caller' | 'callee';
  };
  IncomingCall: {
    caller: string;
    type: 'audio' | 'video';
  };
  Community: undefined;
  Profile: {
    username?: string;
  };
  Notification: undefined;
  PostDetail: {
    postId: string;
  };
  Verification: {
    userId: string;
    devOtp?: string;
    identifier?: string;
    password?: string;
    verificationType?: 'email' | 'phone';
    email?: string;
    phone?: string;
  };
  CreateCommunity: undefined;
  Settings: undefined;
  Search: undefined;
  SuperAdminPanel: undefined;
  AdminPanel: undefined;
  Sponsors: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}