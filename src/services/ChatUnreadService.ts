import AsyncStorage from '@react-native-async-storage/async-storage';

export type UnreadMap = Record<string, number>;

type Listener = (counts: UnreadMap, total: number) => void;

class ChatUnreadService {
  private static instance: ChatUnreadService;
  private counts: UnreadMap = {};
  private activeChatId: string | null = null;
  private usernameKey: string | null = null;
  private listeners: Set<Listener> = new Set();
  private initialized = false;

  static getInstance(): ChatUnreadService {
    if (!ChatUnreadService.instance) {
      ChatUnreadService.instance = new ChatUnreadService();
    }
    return ChatUnreadService.instance;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const me = stored ? JSON.parse(stored) : null;
      const username = me?.username;
      this.usernameKey = username ? `chatUnread:${username}` : 'chatUnread:anonymous';
      const json = await AsyncStorage.getItem(this.usernameKey);
      this.counts = json ? JSON.parse(json) : {};
      this.initialized = true;
      this.emit();
    } catch (e) {
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    try {
      if (!this.usernameKey) await this.init();
      if (!this.usernameKey) return;
      await AsyncStorage.setItem(this.usernameKey, JSON.stringify(this.counts));
    } catch (_) {}
  }

  private emit(): void {
    const total = this.getTotal();
    this.listeners.forEach((fn) => {
      try { fn({ ...this.counts }, total); } catch (_) {}
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // immediate emit so UI hydrates
    try { listener({ ...this.counts }, this.getTotal()); } catch (_) {}
    return () => { this.listeners.delete(listener); };
  }

  setActiveChat(chatId: string | null): void {
    this.activeChatId = chatId;
  }

  getCounts(): UnreadMap {
    return { ...this.counts };
  }

  getCount(chatId: string): number {
    return this.counts[chatId] || 0;
  }

  getTotal(): number {
    return Object.values(this.counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  }

  async clear(chatId: string): Promise<void> {
    if (!chatId) return;
    if (this.counts[chatId]) {
      this.counts[chatId] = 0;
      await this.persist();
      this.emit();
    }
  }

  async increment(chatId: string): Promise<void> {
    if (!chatId) return;
    // Do not count messages for the currently open chat
    if (this.activeChatId && this.activeChatId === chatId) {
      // Ensure active chat stays cleared
      if (this.counts[chatId] !== 0) {
        this.counts[chatId] = 0;
        await this.persist();
        this.emit();
      }
      return;
    }
    const prev = this.counts[chatId] || 0;
    this.counts[chatId] = prev + 1;
    await this.persist();
    this.emit();
  }

  async resetAll(): Promise<void> {
    this.counts = {};
    await this.persist();
    this.emit();
  }
}

export default ChatUnreadService.getInstance();