import AsyncStorage from '@react-native-async-storage/async-storage';

export type UnreadMap = Record<string, number>;

type Listener = (counts: UnreadMap, total: number) => void;

class CommunityUnreadService {
  private static instance: CommunityUnreadService;
  private counts: UnreadMap = {};
  private activeCommunityId: string | null = null;
  private usernameKey: string | null = null;
  private listeners: Set<Listener> = new Set();
  private initialized = false;

  static getInstance(): CommunityUnreadService {
    if (!CommunityUnreadService.instance) {
      CommunityUnreadService.instance = new CommunityUnreadService();
    }
    return CommunityUnreadService.instance;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const me = stored ? JSON.parse(stored) : null;
      const username = me?.username;
      this.usernameKey = username ? `communityUnread:${username}` : 'communityUnread:anonymous';
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

  setActiveCommunity(communityId: string | null): void {
    this.activeCommunityId = communityId;
  }

  getCounts(): UnreadMap {
    return { ...this.counts };
  }

  getCount(communityId: string): number {
    return this.counts[communityId] || 0;
  }

  getTotal(): number {
    return Object.values(this.counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  }

  async clear(communityId: string): Promise<void> {
    if (!communityId) return;
    if (this.counts[communityId]) {
      this.counts[communityId] = 0;
      await this.persist();
      this.emit();
    }
  }

  async increment(communityId: string): Promise<void> {
    if (!communityId) return;
    // Do not count messages for the currently open community
    if (this.activeCommunityId && this.activeCommunityId === communityId) {
      // Ensure active community stays cleared
      if (this.counts[communityId] !== 0) {
        this.counts[communityId] = 0;
        await this.persist();
        this.emit();
      }
      return;
    }
    const prev = this.counts[communityId] || 0;
    this.counts[communityId] = prev + 1;
    await this.persist();
    this.emit();
  }

  async resetAll(): Promise<void> {
    this.counts = {};
    await this.persist();
    this.emit();
  }
}

export default CommunityUnreadService.getInstance();