export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  TermsAttestation: undefined;
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
  CommunityChat: {
    communityId: string;
    communityName?: string;
  };
  CommunityIncomingCall: {
    communityId: string;
    communityName: string;
    caller: {
      username: string;
      name?: string;
      avatar?: string;
    };
    type: 'audio' | 'video';
  };
  CommunityCall: {
    communityId: string;
    communityName: string;
    mode: 'caller' | 'callee';
    type: 'audio' | 'video';
    caller: {
      username: string;
      name?: string;
      avatar?: string;
    };
  };
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
  SponsorDetail: {
    sponsorId: string;
    name?: string;
  };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}