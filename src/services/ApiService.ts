import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, NativeModules } from 'react-native';
import RNFS from 'react-native-fs';

// In development, infer the host running Metro and point API to local server
const getDevHost = (): string | null => {
  try {
    const scriptURL: string | undefined = (NativeModules as any)?.SourceCode?.scriptURL;
    if (scriptURL) {
      const m = scriptURL.match(/https?:\/\/([^:\/]+)/);
      if (m && m[1]) return m[1];
    }
  } catch (_e) {}
  return null;
};

export class ApiService {
  private baseUrl: string;
  private rootUrl: string;
  private devHost: string | null = null;

  constructor() {
    // Prefer production API by default for smoother loading on devices
    // Developers can re-enable local API by toggling the flag below if needed
    const preferProd = true;
    this.devHost = getDevHost();
    if (!preferProd && __DEV__ && this.devHost) {
      const localRoot = `http://${this.devHost}:3000`;
      this.rootUrl = localRoot;
      this.baseUrl = `${localRoot}/api`;
    } else {
      this.baseUrl = 'https://connecther.network/api';
      this.rootUrl = 'https://connecther.network';
      // Avoid emulator-specific fallbacks when forcing production
      this.devHost = null;
    }
    console.log('ApiService baseUrl:', this.baseUrl, 'rootUrl:', this.rootUrl);
  }

  // Normalize helpers to map backend post shape to app-friendly shape
  private normalizeAvatar(avatar?: string): string | undefined {
    if (!avatar) return avatar;
    if (/^https?:\/\//i.test(avatar)) return avatar;
    const trimmed = avatar.replace(/^\/+/, '');
    return `${this.rootUrl}/${trimmed}`;
  }

  private getCloudinaryVideoThumbnail(url: string): string | undefined {
    try {
      const u = new URL(url);
      if (!u.hostname.includes('res.cloudinary.com')) return undefined;
      // Replace extension with .jpg to get a generated thumbnail from Cloudinary
      return url.replace(/\.[a-z0-9]+$/i, '.jpg');
    } catch (_e) {
      return undefined;
    }
  }

  private normalizeMedia(media: any): { url: string; type?: string; thumbnailUrl?: string }[] {
    const list = Array.isArray(media) ? media : [];
    return list
      .map((file: any) => {
        const rawUrl =
          file?.secure_url ||
          file?.url ||
          (file?.path ? `${this.rootUrl}/${String(file.path).replace(/^\/+/, '')}` : undefined);
        const url = rawUrl && !/^https?:\/\//i.test(rawUrl)
          ? `${this.rootUrl}/${String(rawUrl).replace(/^\/+/, '')}`
          : rawUrl;
        if (!url) return null;
        const type = file?.type || file?.resource_type || undefined;
        const isVideo = String(type || '').toLowerCase().includes('video') || /\/video\//.test(url);
        const thumbnailUrl = isVideo ? (this.getCloudinaryVideoThumbnail(url) || undefined) : undefined;
        return { url, type, thumbnailUrl };
      })
      .filter(Boolean) as { url: string; type?: string; thumbnailUrl?: string }[];
  }

  private normalizeComment(c: any) {
    const user = c?.user || c?.author || {};
    return {
      author: {
        username: user?.username,
        name: user?.name,
        avatar: this.normalizeAvatar(user?.avatar),
      },
      content: c?.text ?? c?.content ?? '',
      createdAt: c?.createdAt,
      replies: Array.isArray(c?.replies)
        ? c.replies.map((r: any) => {
            const ru = r?.user || r?.author || {};
            return {
              author: {
                username: ru?.username,
                name: ru?.name,
                avatar: this.normalizeAvatar(ru?.avatar),
              },
              content: r?.text ?? r?.content ?? '',
              createdAt: r?.createdAt,
            };
          })
        : [],
    };
  }

  private normalizePost(p: any) {
    if (!p || typeof p !== 'object') return p;
    const likedBy = Array.isArray(p?.likedBy)
      ? p.likedBy
      : Array.isArray(p?.likes)
      ? p.likes
      : [];
    const savedBy = Array.isArray(p?.savedBy) ? p.savedBy : [];
    const savesCount = typeof p?.saves === 'number' ? p.saves : undefined;
    const sharesCount = typeof p?.shares === 'number'
      ? p.shares
      : Array.isArray(p?.shares)
      ? p.shares.length
      : Array.isArray(p?.resharedBy)
      ? p.resharedBy.length
      : undefined;

    return {
      _id: p._id,
      author: {
        username: p?.username,
        name: p?.name || `${p?.firstName || ''} ${p?.surname || ''}`.trim() || p?.username,
        avatar: this.normalizeAvatar(p?.avatar),
        // Provide location used for flag rendering across the app
        location: p?.location ?? p?.author?.location ?? p?.user?.location,
      },
      content: p?.caption ?? p?.content ?? '',
      originalPostId: p?.originalPostId,
      files: this.normalizeMedia(p?.media),
      // Preserve numeric likes if backend uses a counter; UI is defensive
      likes: typeof p?.likes === 'number' ? p.likes : likedBy,
      likedBy,
      // Saves and shares normalization for preview metrics
      savedBy,
      saves: savesCount,
      shares: sharesCount,
      comments: Array.isArray(p?.comments) ? p.comments.map((c: any) => this.normalizeComment(c)) : [],
      createdAt: p?.createdAt,
    };
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem('authToken');
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  }

  private async makeRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<any> {
    const token = await this.getAuthToken();
    
    const isFormData = typeof FormData !== 'undefined' && (options.body as any) instanceof FormData;
    const defaultHeaders: HeadersInit = isFormData
      ? {}
      : {
          'Content-Type': 'application/json',
        };

    if (token) {
      defaultHeaders.Authorization = `Bearer ${token}`;
    }

    const config: RequestInit = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    // Special handling: sanitize call log payloads to avoid backend 400s
    try {
      const method = String(config.method || 'GET').toUpperCase();
      if (endpoint === '/calls' && method === 'POST') {
        let bodyObj: any = null;
        try {
          bodyObj = typeof config.body === 'string' ? JSON.parse(config.body as string) : (config.body as any);
        } catch (_e) {}

        if (!bodyObj || typeof bodyObj !== 'object') {
          bodyObj = {};
        }

        // Ensure caller is present; fill from storage if missing
        let caller = String(bodyObj.caller || '').trim();
        if (!caller) {
          try {
            const stored = await AsyncStorage.getItem('currentUser');
            const current = stored ? JSON.parse(stored) : null;
            caller = String(current?.username || '').trim();
            if (caller) bodyObj.caller = caller;
          } catch (_e) {}
        }

        // Validate receiver
        const receiver = String(bodyObj.receiver || '').trim();
        if (!caller || !receiver) {
          if (__DEV__) {
            console.debug('makeRequest /calls suppressed: missing caller/receiver', { caller, receiver });
          }
          // Soft-fail to avoid noisy 400 logs and backend errors
          return { success: false } as any;
        }

        // Normalize defaults
        if (!bodyObj.status) bodyObj.status = 'started';
        if (!bodyObj.type) bodyObj.type = 'audio';
        if (typeof bodyObj.duration !== 'number') bodyObj.duration = 0;

        config.body = JSON.stringify(bodyObj);
      }
    } catch (_e) {}

    const doFetch = async (base: string) => {
      const response = await fetch(`${base}${endpoint}`, config);

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload && 'message' in payload
            ? (payload as any).message
            : `HTTP error ${response.status}`;
        const err = new Error(message);
        // Attach status and payload for callers to inspect
        (err as any).status = response.status;
        (err as any).payload = payload;
        throw err;
      }

      return payload;
    };

    try {
      return await doFetch(this.baseUrl);
    } catch (error: any) {
      // Fallback for Android emulator: if dev host is localhost and network fails, try 10.0.2.2
      const networkFailed = String(error?.message || '').includes('Network request failed');
      const isAndroidEmuDev = __DEV__ && Platform.OS === 'android' && (this.devHost === 'localhost' || !this.devHost);
      if (networkFailed && isAndroidEmuDev) {
        const altRoot = 'http://10.0.2.2:3000';
        const altBase = `${altRoot}/api`;
        try {
          const result = await doFetch(altBase);
          // If alt host works, pin baseUrl/rootUrl so subsequent calls use it
          this.rootUrl = altRoot;
          this.baseUrl = altBase;
          return result;
        } catch (_e) {
          // fall through to original error
        }
      }
      // Secondary fallback: if localhost dev server is unreachable on device, try production
      if (networkFailed) {
        const prodRoot = 'https://connecther.network';
        const prodBase = `${prodRoot}/api`;
        try {
          const result = await doFetch(prodBase);
          // Pin to production base if it succeeds so subsequent calls use it
          this.rootUrl = prodRoot;
          this.baseUrl = prodBase;
          return result;
        } catch (_e) {
          // ignore and rethrow original
        }
      }
      // Suppress noisy logs for expected client-handled statuses
      const status = (error as any)?.status;
      const msg = String(error?.message || '');
      const isNoise = endpoint.startsWith('/friends/');
      if (typeof status === 'number' && status >= 500) {
        if (__DEV__) {
          console.debug('API 5xx suppressed:', status, endpoint);
        }
        // Do not warn for server errors; caller handles fallback UX
      } else if (status !== 404) {
        if (isNoise) {
          if (__DEV__) console.debug('API request warning:', status, endpoint, msg);
        } else {
          console.warn('API request warning:', status, endpoint, msg);
        }
      }
      throw error;
    }
  }

  // Some legacy endpoints live at the root (not under /api)
  private async makeRootRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<any> {
    const token = await this.getAuthToken();

    const isFormData = typeof FormData !== 'undefined' && (options.body as any) instanceof FormData;
    const defaultHeaders: HeadersInit = isFormData
      ? {}
      : {
          'Content-Type': 'application/json',
        };

    if (token) {
      defaultHeaders.Authorization = `Bearer ${token}`;
    }

    const config: RequestInit = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    const doFetch = async (root: string) => {
      const response = await fetch(`${root}${endpoint}`, config);

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload && 'message' in payload
            ? (payload as any).message
            : `HTTP error ${response.status}`;
        const err = new Error(message);
        (err as any).status = response.status;
        (err as any).payload = payload;
        throw err;
      }

      return payload;
    };

    try {
      return await doFetch(this.rootUrl);
    } catch (error: any) {
      const networkFailed = String(error?.message || '').includes('Network request failed');
      const isAndroidEmuDev = __DEV__ && Platform.OS === 'android' && (this.devHost === 'localhost' || !this.devHost);
      if (networkFailed && isAndroidEmuDev) {
        const altRoot = 'http://10.0.2.2:3000';
        try {
          const result = await doFetch(altRoot);
          // Pin base/root to alt for subsequent calls
          this.rootUrl = altRoot;
          this.baseUrl = `${altRoot}/api`;
          return result;
        } catch (_e) {
          // ignore and rethrow original
        }
      }
      // Secondary fallback: if localhost dev server is unreachable on device, try production
      if (networkFailed) {
        const prodRoot = 'https://connecther.network';
        try {
          const result = await doFetch(prodRoot);
          this.rootUrl = prodRoot;
          this.baseUrl = `${prodRoot}/api`;
          return result;
        } catch (_e) {
          // ignore and rethrow original
        }
      }
      const status = (error as any)?.status;
      const msg = String(error?.message || '');
      const isNoise = endpoint.startsWith('/friend-requests/');
      if (typeof status === 'number' && status >= 500) {
        if (__DEV__) {
          console.debug('API root 5xx suppressed:', status, endpoint);
        }
      } else if (status !== 404) {
        if (isNoise) {
          if (__DEV__) console.debug('API root request warning:', status, endpoint, msg);
        } else {
          console.warn('API root request warning:', status, endpoint, msg);
        }
      }
      throw error;
    }
  }

  // Expose a generic request method for other services
  public request(endpoint: string, options: RequestInit = {}) {
    return this.makeRequest(endpoint, options);
  }

  // Convenience alias for GET requests (used by some screens)
  public get(endpoint: string, options: RequestInit = {}) {
    return this.request(endpoint, options);
  }

  // Convenience helper for POST requests with JSON body
  public post(endpoint: string, data: any) {
    return this.makeRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Auth methods
  async login(usernameOrEmail: string, password: string) {
    // Backend expects an 'identifier' which can be username or email
    try {
      const res = await this.makeRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: usernameOrEmail, password }),
      });

      // Persist auth token if provided
      const token = (res as any)?.token || (res as any)?.accessToken || (res as any)?.jwt;
      if (token) {
        try { await AsyncStorage.setItem('authToken', String(token)); } catch (_e) {}
      }

      // Persist minimal current user profile if provided
      const user = (res as any)?.user || (res as any)?.profile || null;
      if (user && user.username) {
        const normalized = {
          username: user.username,
          name: user.name || `${user.firstName || ''} ${user.surname || ''}`.trim() || user.username,
          firstName: user.firstName,
          surname: user.surname,
          avatar: this.normalizeAvatar(user.avatar),
          location: user.location,
          role: user.role,
        } as any;
        try {
          await AsyncStorage.setItem('username', user.username);
          await AsyncStorage.setItem('currentUser', JSON.stringify(normalized));
        } catch (_e) {}
      }

      return res;
    } catch (err) {
      console.error('login error:', err);
      throw err;
    }
  }

  async register(userData: {
    firstName: string;
    surname: string;
    username: string;
    email: string;
    password: string;
    // Additional fields used by backend and web signup
    birthday?: string;
    location?: string;
    gender?: 'Female' | 'Company';
    adminToken?: string;
    // Avatar is required by backend; accept common shapes from pickers
    avatar: { uri: string; type?: string; name?: string } | { path: string; mime?: string; name?: string } | string;
  }) {
    try {
      const formData = new FormData();

      const append = (key: string, value: any) => {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      };

      append('firstName', userData.firstName);
      append('surname', userData.surname);
      append('username', userData.username);
      append('email', userData.email);
      append('password', userData.password);
      append('birthday', userData.birthday);
      append('location', userData.location);
      append('gender', userData.gender || 'Female');
      append('adminToken', userData.adminToken);

      const avatar = userData.avatar as any;
      if (avatar) {
        let file: any = null;
        if (typeof avatar === 'string') {
          const name = String(avatar).split('/').pop() || `avatar_${Date.now()}.jpg`;
          file = { uri: avatar, name, type: 'image/jpeg' };
        } else if (avatar.uri) {
          const name = avatar.name || String(avatar.uri).split('/').pop() || `avatar_${Date.now()}.jpg`;
          const type = avatar.type || 'image/jpeg';
          file = { uri: avatar.uri, name, type };
        } else if (avatar.path) {
          const rawPath = avatar.path;
          const name = avatar.name || String(rawPath).split('/').pop() || `avatar_${Date.now()}.jpg`;
          const type = avatar.mime || 'image/jpeg';
          const uri = Platform.OS === 'android' && !String(rawPath).startsWith('file://') ? `file://${rawPath}` : rawPath;
          file = { uri, name, type };
        }
        if (file) {
          // @ts-ignore FormData file object
          formData.append('avatar', file);
        }
      }

      const res = await this.makeRequest('/auth/register', {
        method: 'POST',
        // Let fetch set proper multipart boundary automatically
        body: formData,
      });

      // Normalize and persist current user similar to web flow
      const user = (res as any)?.user || res;
      if (user && user.username) {
        if (!user.joined) user.joined = new Date().toISOString().split('T')[0];
        if (!user.name && user.firstName && user.surname) {
          user.name = `${user.firstName} ${user.surname}`;
        }
        try {
          await AsyncStorage.setItem('username', user.username);
          await AsyncStorage.setItem('currentUser', JSON.stringify({
            username: user.username,
            name: user.name,
            firstName: user.firstName,
            surname: user.surname,
            avatar: this.normalizeAvatar(user.avatar),
            location: user.location,
            role: user.role,
          }));
          await AsyncStorage.setItem(`firstTimeUser:${user.username}`, 'true');
        } catch (_e) {}
      }

      return res;
    } catch (err) {
      console.error('register error:', err);
      throw err;
    }
  }

  async verifyEmail(token: string) {
    return this.makeRequest('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({token}),
    });
  }

  // User methods
  async getUserProfile(username: string) {
    const fetchByUsername = async (u: string) => {
      const slug = encodeURIComponent(u.trim());
      const data = await this.makeRequest(`/users/${slug}`);
      return {
        success: true,
        profile: (data as any)?.user || data || null,
      };
    };

    const resolveUser = async (identifier: string) => {
      const slug = encodeURIComponent(identifier.trim());
      const data = await this.makeRequest(`/users/resolve/${slug}`);
      return (data as any)?.user || data || null;
    };

    try {
      // Try by username first (original case)
      return await fetchByUsername(username);
    } catch (error: any) {
      // If not found, try lowercase username, then resolve by name
      const lower = username.trim().toLowerCase();
      const notFound = error?.status === 404 || /not found/i.test(String(error?.message));
      if (notFound) {
        // Lowercase username
        if (lower !== username) {
          try {
            return await fetchByUsername(lower);
          } catch (_) {}
        }
        // Resolve by full name or display name
        try {
          const resolved = await resolveUser(username);
          if (resolved?.username) {
            return await fetchByUsername(resolved.username);
          }
        } catch (_) {}
      }
      console.error('getUserProfile error:', error);
      throw error;
    }
  }

  // Fetch posts created by a specific user
  async getUserPosts(username: string) {
    const fetchPosts = async (u: string) => {
      const data = await this.makeRequest(`/posts/user/${encodeURIComponent(u.trim())}`);
      const raw = Array.isArray(data) ? data : (data as any)?.posts || [];
      const posts = raw.map((p: any) => this.normalizePost(p));
      return { success: true, posts };
    };

    try {
      return await fetchPosts(username);
    } catch (err: any) {
      if (err?.status === 404) {
        // Retry with lowercase for case-insensitive lookup
        const lower = username.trim().toLowerCase();
        if (lower !== username) {
          try {
            return await fetchPosts(lower);
          } catch (_) {
            // ignore and fall through
          }
        }
        // Return empty list for 404 even after retry
        return { success: true, posts: [] };
      }
      console.error('getUserPosts error:', err);
      throw err;
    }
  }

  async updateProfile(userData: any) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;

      const formData = new FormData();
      if (username) formData.append('username', username);
      if (userData?.email !== undefined) formData.append('email', userData.email);
      if (userData?.bio !== undefined) formData.append('bio', userData.bio);
      if (userData?.category !== undefined) formData.append('category', userData.category);
      if (userData?.location !== undefined) formData.append('location', userData.location);
      if (userData?.website !== undefined) formData.append('website', userData.website);
      if (userData?.workplace !== undefined) formData.append('workplace', userData.workplace);
      if (userData?.education !== undefined) formData.append('education', userData.education);
      if (userData?.dob !== undefined) formData.append('dob', userData.dob);
      if (userData?.firstName !== undefined) formData.append('firstName', userData.firstName);
      if (userData?.surname !== undefined) formData.append('surname', userData.surname);
      if (userData?.name !== undefined) formData.append('name', userData.name);
      if (userData?.joined !== undefined) formData.append('joined', userData.joined);
      if (userData?.avatar !== undefined) formData.append('avatar', userData.avatar);

      return this.makeRequest('/auth/update', {
        method: 'PUT',
        // Let fetch set proper multipart boundary automatically
        body: formData,
      });
    } catch (err) {
      console.error('updateProfile error:', err);
      throw err;
    }
  }

  async updateAvatar(formData: FormData) {
    try {
      const res = await this.makeRequest('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });
      const files = (res as any)?.files || [];
      const url = files[0]?.url ? this.normalizeAvatar(files[0].url) : undefined;
      return { success: !!url, avatarUrl: url };
    } catch (err) {
      console.error('updateAvatar error:', err);
      return { success: false } as any;
    }
  }

  async searchUsers(query: string) {
    const q = String(query || '').trim();
    if (!q) return [] as any[];

    try {
      const res = await this.makeRequest(`/users/search?q=${encodeURIComponent(q)}`);
      if (Array.isArray(res)) return res;
      if (Array.isArray((res as any)?.users)) return (res as any).users;
    } catch (err: any) {
      if (err?.status !== 404) {
        console.warn('searchUsers API error:', err);
      }
    }

    try {
      const resp = await this.makeRequest(`/users/resolve/${encodeURIComponent(q)}`);
      const u = (resp as any)?.user || resp;
      if (u && u.username) return [u];
    } catch (_) {}

    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;

      let candidates: any[] = [];
      try {
        const friends = await this.getFriends(username);
        const list = Array.isArray((friends as any)?.users)
          ? (friends as any).users
          : Array.isArray(friends) ? friends : [];
        candidates = candidates.concat(list);
      } catch (_) {}

      if (username) {
        try {
          const sugg = await this.getUserSuggestions(username);
          candidates = candidates.concat(Array.isArray(sugg) ? sugg : []);
        } catch (_) {}
      }

      const lower = q.toLowerCase();
      const filtered = candidates.filter((u: any) => {
        const uname = String(u?.username || '').toLowerCase();
        const name = String(u?.name || `${u?.firstName || ''} ${u?.surname || ''}`).toLowerCase();
        return uname.includes(lower) || name.includes(lower);
      });

      const seen = new Set<string>();
      const deduped = filtered.filter((u: any) => {
        const key = String(u?.username || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return deduped;
    } catch (_) {}

    return [] as any[];
  }

  // Aggregated search across users, posts, communities, and sponsors
  async searchAll(query: string) {
    const q = String(query || '').trim();
    if (!q) {
      return { users: [], posts: [], communities: [], sponsors: [] } as any;
    }

    const usersPromise = (async () => {
      try {
        const raw = await this.searchUsers(q);
        return (Array.isArray(raw) ? raw : []).map((u: any) => ({
          _id: u?._id,
          username: u?.username,
          name: u?.name || `${u?.firstName || ''} ${u?.surname || ''}`.trim() || u?.username,
          avatar: this.normalizeAvatar(u?.avatar),
          bio: u?.bio,
          verified: !!u?.verified,
          lastSeen: u?.lastSeen,
        }));
      } catch (_) {
        return [];
      }
    })();

    const postsPromise = (async () => {
      try {
        const res = await this.makeRequest(`/posts/search/${encodeURIComponent(q)}`);
        const raw = Array.isArray(res) ? res : (res as any)?.posts || [];
        return raw.map((p: any) => this.normalizePost(p));
      } catch (_) {
        return [];
      }
    })();

    const communitiesPromise = (async () => {
      try {
        const res = await this.makeRequest('/communities/all');
        const raw = Array.isArray(res) ? res : (res as any)?.communities || [];
        const lower = q.toLowerCase();
        const filtered = raw.filter((c: any) => {
          const name = String(c?.name || '').toLowerCase();
          const desc = String(c?.description || '').toLowerCase();
          const creator = String(c?.creator || '').toLowerCase();
          return name.includes(lower) || desc.includes(lower) || creator.includes(lower);
        });
        return filtered.map((c: any) => ({
          _id: c?._id,
          name: c?.name,
          description: c?.description,
          avatar: this.normalizeAvatar(c?.avatar),
          members: Array.isArray(c?.members) ? c.members : [],
        }));
      } catch (_) {
        return [];
      }
    })();

    const sponsorsPromise = (async () => {
      try {
        const res = await this.makeRequest('/sponsors');
        const raw = Array.isArray(res) ? res : (res as any)?.sponsors || [];
        const lower = q.toLowerCase();
        const filtered = raw.filter((s: any) => {
          const companyName = String(s?.companyName || s?.name || '').toLowerCase();
          const objectives = String(s?.objectives || s?.description || '').toLowerCase();
          return companyName.includes(lower) || objectives.includes(lower);
        });
        return filtered.map((s: any) => ({
          _id: s?._id,
          name: s?.companyName || s?.name,
          description: s?.objectives || s?.description,
          logo: s?.logo,
          avatar: this.normalizeAvatar(s?.logo || s?.avatar),
        }));
      } catch (_) {
        return [];
      }
    })();

    const [users, posts, communities, sponsors] = await Promise.all([
      usersPromise,
      postsPromise,
      communitiesPromise,
      sponsorsPromise,
    ]);

    return { users, posts, communities, sponsors } as any;
  }

  // Update an existing post (caption/content and optionally media)
  async updatePost(postId: string, payload: { caption?: string; content?: string; media?: any[] }) {
    try {
      const body: any = {};
      if (payload.caption !== undefined) body.caption = payload.caption;
      if (payload.content !== undefined && payload.caption === undefined) body.caption = payload.content;
      if (payload.media !== undefined) body.media = payload.media;
      const res = await this.makeRequest(`/posts/${postId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return res;
    } catch (err) {
      console.error('updatePost error:', err);
      throw err;
    }
  }

  async getFriends(username?: string) {
    try {
      let user = username;
      if (!user) {
        const stored = await AsyncStorage.getItem('currentUser');
        if (stored) {
          const parsed = JSON.parse(stored || '{}');
          user = parsed?.username;
        }
      }

      if (!user) {
        throw new Error('Missing username for friends request');
      }

      // Try enriched route first: /api/friends/:username
      try {
        const enriched = await this.makeRequest(`/friends/${encodeURIComponent(user)}`);
        const users = (Array.isArray(enriched) ? enriched : Array.isArray((enriched as any)?.users) ? (enriched as any).users : [])
          .map((u: any) => ({
            username: u?.username || u?.user?.username || u,
            name: u?.name || u?.user?.name,
            avatar: this.normalizeAvatar(u?.avatar || u?.user?.avatar),
          }))
          .filter((u: any) => !!u.username);
        try { await AsyncStorage.setItem('friends:list', JSON.stringify(users)); } catch (_) {}
        return { users };
      } catch (primaryErr: any) {
        // Fallback to legacy route: /api/users/:username/friends -> ["alice","bob"]
        try {
          const legacy = await this.makeRequest(`/users/${encodeURIComponent(user)}/friends`);
          const usernames: string[] = Array.isArray(legacy) ? legacy : Array.isArray((legacy as any)?.users) ? (legacy as any).users : [];
          const users: any[] = [];
          for (const uname of usernames) {
            if (!uname) continue;
            try {
              const prof = await this.makeRootRequest(`/api/users/user/${encodeURIComponent(uname)}`);
              const usernameVal = prof?.username || uname;
              // Skip unresolved or deleted users to avoid stale FriendList entries
              if (!prof || !usernameVal || (!prof?.name && !prof?.avatar)) continue;
              users.push({
                username: usernameVal,
                name: prof?.name || usernameVal,
                avatar: this.normalizeAvatar(prof?.avatar),
              });
            } catch (_) {
              // Do not include unresolved users in FriendList
              continue;
            }
          }
          try { await AsyncStorage.setItem('friends:list', JSON.stringify(users)); } catch (_) {}
          return { users };
        } catch (fallbackErr: any) {
          const code = fallbackErr?.status ?? primaryErr?.status;
          if (code === 404) {
            try { await AsyncStorage.setItem('friends:list', JSON.stringify([])); } catch (_) {}
            return { users: [] };
          }
          // Propagate errors (e.g., 5xx) so caller can use cache-based fallback
          throw fallbackErr;
        }
      }
    } catch (err) {
      console.error('getFriends error:', err);
      throw err;
    }
  }

  // Friends-of-friends suggestions for "People You May Know"
  async getUserSuggestions(username: string) {
    try {
      const res = await this.makeRootRequest(`/api/users/suggestions/${encodeURIComponent(username)}`);
      return Array.isArray(res) ? res : [];
    } catch (error) {
      console.error('getUserSuggestions error:', error);
      return [];
    }
  }

  // Ranked top creators for onboarding and discovery
  async getTopCreators(limit: number = 10, forUsername?: string) {
    try {
      const query = `limit=${encodeURIComponent(String(limit))}${forUsername ? `&for=${encodeURIComponent(forUsername)}` : ''}`;
      const res = await this.makeRootRequest(`/api/users/top-creators?${query}`);
      return Array.isArray(res) ? res : [];
    } catch (error) {
      console.error('getTopCreators error:', error);
      return [];
    }
  }

  // Pending friend requests for a user (returns enriched sender profiles)
  async getFriendRequests(username?: string) {
    try {
      let u = username;
      if (!u) {
        const stored = await AsyncStorage.getItem('currentUser');
        const current = stored ? JSON.parse(stored) : null;
        u = current?.username;
      }

      if (!u) {
        console.warn('getFriendRequests: missing username');
        return [];
      }

      // Legacy root endpoint returns array of usernames who sent requests
      const list = await this.makeRootRequest(`/friend-requests/${encodeURIComponent(u)}`);
      // Filter out invalid or blank identifiers to avoid downstream lookups like /api/users/
      const usernames: string[] = Array.isArray(list)
        ? list.filter((v: any) => typeof v === 'string' && v.trim().length > 0)
        : [];
      const uniqueUsernames = Array.from(new Set(usernames));

      // Enrich with minimal profile for avatar/name display
      const profilesRaw = await Promise.all(
        uniqueUsernames.map(async (from) => {
          try {
            const p: any = await this.getUserByUsername(from);
            if (!p || !p.username) return null; // Skip deleted or missing users
            const name = p?.name || `${p?.firstName || ''} ${p?.surname || ''}`.trim() || from;
            return { username: from, name, avatar: this.normalizeAvatar(p?.avatar) };
          } catch (_) {
            return null; // Drop entries that fail to resolve
          }
        })
      );

      const profiles = (profilesRaw.filter(Boolean) as any[]);
      return profiles;
    } catch (error) {
      if (__DEV__) {
        console.debug('getFriendRequests suppressed:', String((error as any)?.message || error));
      }
      return [];
    }
  }

  // Latest chats for a user, restricted to confirmed friends
  async getLatestChats(username: string) {
    try {
      const res = await this.makeRootRequest(`/api/messages/latest/${encodeURIComponent(username)}`);
      return Array.isArray(res) ? res : [];
    } catch (error) {
      console.error('getLatestChats error:', error);
      return [];
    }
  }

  async sendFriendRequest(username: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const from = current?.username;

      if (!from) {
        console.warn('sendFriendRequest: missing current user');
        return { success: false };
      }

      const res = await this.makeRootRequest('/friend-request', {
        method: 'POST',
        body: JSON.stringify({ from, to: username }),
      });
      return res;
    } catch (error) {
      console.error('sendFriendRequest error:', error);
      return { success: false };
    }
  }

  // Cancel/withdraw a previously sent friend request
  async cancelFriendRequest(targetUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const from = current?.username;

      if (!from) {
        console.warn('cancelFriendRequest: missing current user');
        return { success: false };
      }

      const res = await this.makeRootRequest('/friend-decline', {
        method: 'POST',
        body: JSON.stringify({ from, to: targetUsername }),
      });

      return (res && typeof res === 'object') ? res : { success: true };
    } catch (error) {
      console.error('cancelFriendRequest error:', error);
      return { success: false };
    }
  }

  // Follow/unfollow leverage friend request system for now
  async followUser(targetUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const from = current?.username;

      if (!from) {
        console.warn('followUser: missing current user');
        return { success: false };
      }

      await this.makeRootRequest('/friend-request', {
        method: 'POST',
        body: JSON.stringify({ from, to: targetUsername }),
      });

      return { success: true };
    } catch (error) {
      console.error('followUser error:', error);
      // Be lenient to avoid breaking UI toggle when backend is unavailable
      return { success: true };
    }
  }

  async unfollowUser(targetUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const from = current?.username;

      if (!from) {
        console.warn('unfollowUser: missing current user');
        return { success: false };
      }

      // If already friends, unfollow acts as unfriend (remove friendship)
      try {
        const isFriends = await this.areFriends(targetUsername);
        if (isFriends) {
          await this.makeRequest('/users/unfriend', {
            method: 'POST',
            body: JSON.stringify({ user1: from, user2: targetUsername }),
          });
          return { success: true };
        }
      } catch (_e) {
        // Fall through to decline pending request
      }

      // Otherwise, cancel a pending friend/follow request
      await this.makeRootRequest('/friend-decline', {
        method: 'POST',
        body: JSON.stringify({ from, to: targetUsername }),
      });

      return { success: true };
    } catch (error) {
      console.error('unfollowUser error:', error);
      // Be lenient to avoid breaking UI toggle when backend is unavailable
      return { success: true };
    }
  }

  // Accept a friend request from the given username (sender)
  async acceptFriendRequest(fromUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const to = current?.username;

      if (!to) {
        console.warn('acceptFriendRequest: missing current user');
        return { success: false };
      }

      // Backend expects { user1, user2 }
      const res = await this.makeRootRequest('/friend-accept', {
        method: 'POST',
        body: JSON.stringify({ user1: to, user2: fromUsername }),
      });

      return (res && typeof res === 'object') ? res : { success: true };
    } catch (error) {
      console.error('acceptFriendRequest error:', error);
      return { success: false };
    }
  }

  // Decline a friend request from the given username (sender)
  async declineFriendRequest(fromUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const to = current?.username;

      if (!to) {
        console.warn('declineFriendRequest: missing current user');
        return { success: false };
      }

      const res = await this.makeRootRequest('/friend-decline', {
        method: 'POST',
        body: JSON.stringify({ from: fromUsername, to }),
      });

      return (res && typeof res === 'object') ? res : { success: true };
    } catch (error) {
      console.error('declineFriendRequest error:', error);
      return { success: false };
    }
  }

  // Unfriend using dedicated backend route
  async unfriendUser(targetUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const from = current?.username;

      if (!from) {
        console.warn('unfriendUser: missing current user');
        return { success: false };
      }

      await this.makeRequest('/users/unfriend', {
        method: 'POST',
        body: JSON.stringify({ user1: from, user2: targetUsername }),
      });

      return { success: true };
    } catch (error) {
      console.error('unfriendUser error:', error);
      return { success: false };
    }
  }

  // Check friendship status by inspecting current user's friends list
  async areFriends(targetUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const from = current?.username;

      if (!from) {
        console.warn('areFriends: missing current user');
        return false;
      }

      const res = await this.getFriends(from);

      const friends: any[] = Array.isArray(res?.users) ? res.users : [];
      return friends.some((u: any) =>
        (u?.username ?? u?.user?.username) === targetUsername
      );
    } catch (error) {
      console.error('areFriends error:', error);
      return false;
    }
  }

  // Messages methods
  async getMessages(recipient: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const sender = current?.username;

      if (!sender) {
        console.warn('getMessages: missing current user');
        return { success: false, messages: [] } as any;
      }

      const data = await this.makeRequest(
        `/messages/${encodeURIComponent(sender)}/${encodeURIComponent(recipient)}`
      );
      const messages = Array.isArray(data) ? data : (data as any)?.messages || [];
      return { success: true, messages } as any;
    } catch (error) {
      console.error('getMessages error:', error);
      throw error;
    }
  }

  // Call methods
  // Helpers to prepare and validate participants for call flows
  async getCurrentUserSafe(): Promise<{ username?: string; name?: string; avatar?: string } | null> {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      if (current?.username) {
        const avatar = this.normalizeAvatar(current?.avatar);
        const name = current?.name || `${current?.firstName || ''} ${current?.surname || ''}`.trim() || current?.username;
        return { username: current.username, name, avatar };
      }

      const uname = await AsyncStorage.getItem('username');
      const username = uname ? JSON.parse(JSON.stringify(uname)) : null;
      if (username) {
        try {
          const p: any = await this.getUserByUsername(String(username));
          return { username: p?.username || String(username), name: p?.name, avatar: this.normalizeAvatar(p?.avatar) };
        } catch (_e) {
          return { username: String(username) };
        }
      }
      return null;
    } catch (_e) {
      return null;
    }
  }

  async ensureUserProfile(identifier: string): Promise<{ username?: string; name?: string; avatar?: string } | null> {
    const id = String(identifier || '').trim();
    if (!id) return null;
    try {
      const p: any = await this.getUserByUsername(id);
      const name = p?.name || `${p?.firstName || ''} ${p?.surname || ''}`.trim() || p?.username;
      return { username: p?.username || id, name, avatar: this.normalizeAvatar(p?.avatar) };
    } catch (_e) {
      return { username: id };
    }
  }

  async prepareCallParticipants(callee: string): Promise<{ caller?: string; receiver?: string; receiverProfile?: { username?: string; name?: string; avatar?: string } }> {
    const me = await this.getCurrentUserSafe();
    const caller = me?.username ? String(me.username).trim() : '';
    const receiver = String(callee || '').trim();
    const receiverProfile = receiver ? await this.ensureUserProfile(receiver) : null;
    return { caller, receiver, receiverProfile: receiverProfile || undefined };
  }

  // Lightweight signaling via message channel to inform peer about call status changes
  async sendCallSignal(to: string, event: 'started' | 'ended' | 'declined', type: 'audio' | 'video' = 'audio', durationMs: number = 0) {
    const msg = `CALL_EVENT:${event}:${type}:${Math.max(0, Math.floor(durationMs / 1000))}`;
    try {
      await this.sendMessage({ to, message: msg });
    } catch (_e) {
      // non-blocking; UI will end locally regardless
    }
  }

  async startCall(callee: string, type: 'audio' | 'video' = 'audio') {
    const { caller, receiver, receiverProfile } = await this.prepareCallParticipants(callee);
    if (!caller || !receiver) {
      if (__DEV__) console.debug('startCall blocked: missing caller/receiver', { caller, receiver });
      return { success: false, reason: 'missing_participants' } as any;
    }
    try {
      await this.logCall(caller, receiver, 'started', type, 0);
      // Notify peer via message channel
      this.sendCallSignal(receiver, 'started', type, 0);
      return { success: true, caller, receiver, peer: receiverProfile } as any;
    } catch (error) {
      console.warn('startCall log failed:', error);
      return { success: true, caller, receiver, peer: receiverProfile } as any;
    }
  }

  async endCall(callee: string, type: 'audio' | 'video' = 'audio', durationMs: number = 0) {
    const { caller, receiver } = await this.prepareCallParticipants(callee);
    if (!caller || !receiver) {
      if (__DEV__) console.debug('endCall blocked: missing caller/receiver', { caller, receiver });
      return { success: false } as any;
    }
    const duration = Math.max(0, Math.floor(durationMs / 1000));
    try {
      await this.logCall(caller, receiver, 'ended', type, duration);
      // Notify peer to end call UI
      this.sendCallSignal(receiver, 'ended', type, durationMs);
      return { success: true } as any;
    } catch (error) {
      console.warn('endCall log failed:', error);
      this.sendCallSignal(receiver, 'ended', type, durationMs);
      return { success: true } as any;
    }
  }

  async declineCall(callee: string, type: 'audio' | 'video' = 'audio') {
    const { caller, receiver } = await this.prepareCallParticipants(callee);
    if (!caller || !receiver) {
      if (__DEV__) console.debug('declineCall blocked: missing caller/receiver', { caller, receiver });
      return { success: false } as any;
    }
    try {
      await this.logCall(caller, receiver, 'declined', type, 0);
      // Notify peer to end call UI on decline
      this.sendCallSignal(receiver, 'declined', type, 0);
      return { success: true } as any;
    } catch (error) {
      console.warn('declineCall log failed:', error);
      this.sendCallSignal(receiver, 'declined', type, 0);
      return { success: true } as any;
    }
  }
  async logCall(
    caller: string,
    receiver: string,
    status: 'started' | 'accepted' | 'declined' | 'missed' | 'ended',
    type: 'audio' | 'video',
    duration: number = 0
  ) {
    try {
      // Defensive: avoid 400s by ensuring required fields are present
      let from = String(caller || '').trim();
      const to = String(receiver || '').trim();
      const st = (status as any) || 'started';
      const ty = (type as any) || 'audio';

      if (!from) {
        try {
          const stored = await AsyncStorage.getItem('currentUser');
          const current = stored ? JSON.parse(stored) : null;
          from = String(current?.username || '').trim();
        } catch (_e) {}
      }

      if (!from || !to) {
        if (__DEV__) {
          console.debug('logCall suppressed: missing caller or receiver', { caller: from, receiver: to, status: st, type: ty });
        }
        return { success: false } as any;
      }

      const body = { caller: from, receiver: to, status: st, type: ty, duration } as any;
      return await this.makeRequest('/calls', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error('logCall error:', error);
      throw error;
    }
  }

  async notifyCommunityGroupCallStart(communityId: string, caller: string, type: 'audio' | 'video' = 'audio') {
    try {
      return await this.makeRequest('/calls/group-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ communityId, caller, type }),
      });
    } catch (error) {
      console.error('notifyCommunityGroupCallStart error:', error);
      // Do not throw to avoid blocking call start UX; return a soft failure
      return { success: false } as any;
    }
  }

  // Fetch user summary by username (name, avatar, username)
  async getUserByUsername(identifier: string) {
    try {
      const raw = String(identifier || '').trim();
      if (!raw) {
        if (__DEV__) {
          console.debug('getUserByUsername: empty identifier');
          try { console.trace('getUserByUsername empty identifier trace'); } catch (_e) {}
        }
        return { username: '' } as any;
      }

      // Primary: GET /users/:username
      const slug = encodeURIComponent(raw);
      const resp = await this.makeRequest(`/users/${slug}`, { method: 'GET' });
      return (resp as any)?.user || resp;
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      const status = (error as any)?.status;

      // Fallbacks for not found: try to resolve and refetch by resolved username
      if (status === 404 || message.includes('not found')) {
        try {
          const resolved = await this.makeRequest(`/users/resolve/${encodeURIComponent(String(identifier || '').trim())}`);
          const u = (resolved as any)?.user || resolved;
          if (u?.username) {
            try {
              const refetch = await this.makeRequest(`/users/${encodeURIComponent(u.username)}`, { method: 'GET' });
              return (refetch as any)?.user || refetch;
            } catch (_) {}
          }
        } catch (_) {}

        // Gracefully return minimal object to avoid UI breakage
        return { username: String(identifier || '').trim() } as any;
      }

      console.error('getUserByUsername error:', error);
      throw error;
    }
  }

  // Normalize avatar path to absolute URL
  normalizeAvatar(uri?: string): string {
    if (!uri) return 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png';
    if (/^https?:\/\//i.test(uri)) return uri;
    const base = (this as any).rootUrl || 'https://connecther.network';
    return `${base}/${String(uri).replace(/^\/+/, '')}`;
  }

  async getCallLogs(username: string) {
    try {
      const slug = encodeURIComponent(username);
      const data = await this.makeRequest(`/calls/${slug}`);
      return Array.isArray(data) ? data : (data as any) || [];
    } catch (error) {
      console.error('getCallLogs error:', error);
      return [];
    }
  }

  async deleteCallLog(id: string) {
    try {
      const slug = encodeURIComponent(id);
      return await this.makeRequest(`/calls/${slug}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('deleteCallLog error:', error);
      throw error;
    }
  }

  async bulkDeleteCallLogs(ids: string[]) {
    try {
      return await this.makeRequest('/calls/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
    } catch (error) {
      console.error('bulkDeleteCallLogs error:', error);
      throw error;
    }
  }

  async sendMessage(data: {
    to: string;
    message: string;
    files?: any[]; // legacy field
    media?: any[]; // preferred field name expected by backend
    replyTo?: string; // message id
    replyFrom?: string; // username who is replying
    reply?: string; // snippet of replied text
  }) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const sender = current?.username;

      if (!sender) {
        console.warn('sendMessage: missing current user');
        return { success: false } as any;
      }

      // Build payload to satisfy backend schema for media-only or captioned media
      const payload: any = {
        sender,
        recipient: data.to,
      };

      // Normalize media array from either `media` or legacy `files`
      const mediaArray = Array.isArray(data.media) && data.media.length > 0
        ? data.media
        : (Array.isArray(data.files) && data.files.length > 0 ? data.files : []);

      const hasText = typeof data.message === 'string' && data.message.trim().length > 0;

      if (mediaArray.length > 0) {
        // Send as array to be parsed directly by backend; supports [{url,type,name,public_id}]
        payload.media = mediaArray;
        // Store caption separately; backend accepts either `text` or `caption`
        if (hasText) payload.caption = data.message.trim();
        // Avoid empty text for media-only messages to keep validation focused on media presence
        payload.text = '';
      } else {
        // No media; this is a text-only message
        payload.text = hasText ? data.message.trim() : '';
      }

      // Reply context support
      if (data.replyTo) payload.replyToId = data.replyTo;
      if (data.replyFrom) payload.replyFrom = data.replyFrom;
      if (data.reply) payload.reply = data.reply;

      return this.makeRequest('/messages', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('sendMessage error:', error);
      throw error;
    }
  }

  async deleteMessageForMe(messageId: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      if (!username) return { success: false } as any;
      return this.makeRequest(`/messages/${encodeURIComponent(messageId)}/delete-for-me/${encodeURIComponent(username)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('deleteMessageForMe error:', error);
      throw error;
    }
  }

  async deleteMessageForEveryone(messageId: string) {
    try {
      return this.makeRequest(`/messages/${encodeURIComponent(messageId)}/delete-for-everyone`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('deleteMessageForEveryone error:', error);
      throw error;
    }
  }

  async editMessage(messageId: string, newText: string) {
    try {
      return this.makeRequest(`/messages/${encodeURIComponent(messageId)}/edit`, {
        method: 'PUT',
        body: JSON.stringify({ text: newText }),
      });
    } catch (error) {
      console.error('editMessage error:', error);
      throw error;
    }
  }

  async clearChat(friendUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      if (!username) return { success: false } as any;
      return this.makeRequest(`/messages/clear/${encodeURIComponent(username)}/${encodeURIComponent(friendUsername)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('clearChat error:', error);
      throw error;
    }
  }

  // Users: Last seen
  async getLastSeen(username: string) {
    try {
      const res = await this.makeRootRequest(`/api/users/last-seen/${encodeURIComponent(username)}`);
      // Expected shape: { lastSeen: ISOString }
      return res;
    } catch (error: any) {
      const status = (error as any)?.status;
      if (status !== 404) {
        console.error('getLastSeen error:', error);
      }
      throw error;
    }
  }

  async deleteMessage(messageId: string) {
    return this.makeRequest(`/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  // Posts methods
  async getPosts(page: number = 1) {
    // Prefer personalized randomized feed when current user exists
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      if (username) {
        const data = await this.makeRequest(`/posts/${encodeURIComponent(username)}/feed?page=${page}`);
        const raw = Array.isArray(data) ? data : (data as any)?.posts || [];
        return raw.map((p: any) => this.normalizePost(p));
      }
    } catch (err) {
      // Fall through to global feed
    }
    const data = await this.makeRequest(`/posts?page=${page}`);
    const raw = Array.isArray(data) ? data : (data as any)?.posts || [];
    return raw.map((p: any) => this.normalizePost(p));
  }

  async getPost(postId: string) {
    const data = await this.makeRequest(`/posts/${postId}`);
    const raw = (data as any)?.post || data;
    const post = this.normalizePost(raw);
    return { post };
  }

  async createPost(data: { content: string; files?: any[] }) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      const payload = {
        username,
        caption: data.content,
        media: Array.isArray(data.files) ? data.files : [],
      };

      const res = await this.makeRequest('/posts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Normalize the created post for the app
      const post = this.normalizePost(res);
      return { success: true, post };
    } catch (error) {
      console.error('createPost error:', error);
      return { success: false } as any;
    }
  }

  async likePost(postId: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/like`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('Error preparing likePost request:', error);
      // Fallback without username to avoid UI breakage
      return this.makeRequest(`/posts/${postId}/like`, {
        method: 'POST',
      });
    }
  }

  async savePost(postId: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/save`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('Error preparing savePost request:', error);
      return this.makeRequest(`/posts/${postId}/save`, { method: 'POST' });
    }
  }

  async unsavePost(postId: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/unsave`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('Error preparing unsavePost request:', error);
      return this.makeRequest(`/posts/${postId}/unsave`, { method: 'POST' });
    }
  }

  async getSavedPosts(username: string) {
    const fetchSaved = async (u: string) => {
      const data = await this.makeRequest(`/posts/saved/${encodeURIComponent(u.trim())}`);
      const raw = (data as any)?.posts || [];
      return raw.map((p: any) => this.normalizePost(p));
    };

    try {
      // Try as-is
      return await fetchSaved(username);
    } catch (err: any) {
      // Retry lowercase on 404
      if (err?.status === 404) {
        const lower = username.trim().toLowerCase();
        if (lower !== username) {
          try {
            return await fetchSaved(lower);
          } catch (_) {}
        }
        // Resolve by full name or display identifier, then retry with resolved username
        try {
          const resolved = await this.makeRequest(`/users/resolve/${encodeURIComponent(username.trim())}`);
          const resolvedUsername = (resolved as any)?.user?.username || (resolved as any)?.username;
          if (resolvedUsername) {
            return await fetchSaved(resolvedUsername);
          }
        } catch (_) {}
      }
      // Avoid logging 404 (expected when no user or saved posts yet)
      if (!(err?.status === 404)) {
        console.error('getSavedPosts error:', err);
      }
      return [];
    }
  }
  async commentOnPost(postId: string, comment: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/comment`, {
        method: 'POST',
        body: JSON.stringify({ username, text: comment }),
      });
    } catch (error) {
      console.error('Error preparing commentOnPost request:', error);
      // Fallback without username to avoid breaking UI
      return this.makeRequest(`/posts/${postId}/comment`, {
        method: 'POST',
        body: JSON.stringify({ text: comment }),
      });
    }
  }

  async replyToComment(postId: string, commentIndex: number, text: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}/reply`, {
        method: 'POST',
        body: JSON.stringify({ username, text }),
      });
    } catch (error) {
      console.error('Error preparing replyToComment request:', error);
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
    }
  }

  async editComment(postId: string, commentIndex: number, text: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}`, {
        method: 'PUT',
        body: JSON.stringify({ username, text }),
      });
    } catch (error) {
      console.error('Error preparing editComment request:', error);
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}`, {
        method: 'PUT',
        body: JSON.stringify({ text }),
      });
    }
  }

  async deleteComment(postId: string, commentIndex: number) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}`, {
        method: 'DELETE',
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('Error preparing deleteComment request:', error);
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}`, {
        method: 'DELETE',
      });
    }
  }

  async editReply(postId: string, commentIndex: number, replyIndex: number, text: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}/reply/${replyIndex}`, {
        method: 'PUT',
        body: JSON.stringify({ username, text }),
      });
    } catch (error) {
      console.error('Error preparing editReply request:', error);
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}/reply/${replyIndex}`, {
        method: 'PUT',
        body: JSON.stringify({ text }),
      });
    }
  }

  async deleteReply(postId: string, commentIndex: number, replyIndex: number) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}/reply/${replyIndex}`, {
        method: 'DELETE',
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('Error preparing deleteReply request:', error);
      return this.makeRequest(`/posts/${postId}/comment/${commentIndex}/reply/${replyIndex}`, {
        method: 'DELETE',
      });
    }
  }

  async resharePost(originalPostId: string, caption?: string) {
    try {
      const userStr = await AsyncStorage.getItem('currentUser');
      const username = userStr ? JSON.parse(userStr).username : undefined;
      return this.makeRequest('/posts/reshare', {
        method: 'POST',
        body: JSON.stringify({ originalPostId, username, caption }),
      });
    } catch (error) {
      console.error('Error preparing resharePost request:', error);
      return this.makeRequest('/posts/reshare', {
        method: 'POST',
        body: JSON.stringify({ originalPostId, caption }),
      });
    }
  }

  // Communities methods
  async getCommunities() {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;

      const primary = await this.makeRequest('/communities/all');
      const raw = Array.isArray(primary)
        ? primary
        : (primary as any)?.communities || (primary as any)?.data?.communities || [];

      const communities = raw.map((c: any) => ({
        ...c,
        memberCount: Array.isArray(c?.members) ? c.members.length : 0,
        isJoined: username ? Array.isArray(c?.members) && c.members.includes(username) : false,
      }));
      return { success: true, communities } as any;
    } catch (error: any) {
      // Fallback to alternate endpoints if /communities/all fails (404/5xx)
      try {
        const alt = await this.makeRequest('/communities');
        const raw = Array.isArray(alt)
          ? alt
          : (alt as any)?.communities || (alt as any)?.data?.communities || [];
        const stored = await AsyncStorage.getItem('currentUser');
        const current = stored ? JSON.parse(stored) : null;
        const username = current?.username;
        const communities = raw.map((c: any) => ({
          ...c,
          memberCount: Array.isArray(c?.members) ? c.members.length : 0,
          isJoined: username ? Array.isArray(c?.members) && c.members.includes(username) : false,
        }));
        return { success: true, communities } as any;
      } catch (fallbackErr: any) {
        // Try root-level endpoints (legacy servers without /api prefix)
        try {
          const altRoot = await this.makeRootRequest('/communities/all');
          const rawRoot = Array.isArray(altRoot)
            ? altRoot
            : (altRoot as any)?.communities || (altRoot as any)?.data?.communities || [];
          const stored = await AsyncStorage.getItem('currentUser');
          const current = stored ? JSON.parse(stored) : null;
          const username = current?.username;
          const communities = rawRoot.map((c: any) => ({
            ...c,
            memberCount: Array.isArray(c?.members) ? c.members.length : 0,
            isJoined: username ? Array.isArray(c?.members) && c.members.includes(username) : false,
          }));
          return { success: true, communities } as any;
        } catch (_rootAllErr) {
          try {
            const altRoot2 = await this.makeRootRequest('/communities');
            const rawRoot2 = Array.isArray(altRoot2)
              ? altRoot2
              : (altRoot2 as any)?.communities || (altRoot2 as any)?.data?.communities || [];
            const stored = await AsyncStorage.getItem('currentUser');
            const current = stored ? JSON.parse(stored) : null;
            const username = current?.username;
            const communities = rawRoot2.map((c: any) => ({
              ...c,
              memberCount: Array.isArray(c?.members) ? c.members.length : 0,
              isJoined: username ? Array.isArray(c?.members) && c.members.includes(username) : false,
            }));
            return { success: true, communities } as any;
          } catch (_rootListErr) {
            try {
              const altRoot3 = await this.makeRootRequest('/community/all');
              const rawRoot3 = Array.isArray(altRoot3)
                ? altRoot3
                : (altRoot3 as any)?.communities || (altRoot3 as any)?.data?.communities || [];
              const stored = await AsyncStorage.getItem('currentUser');
              const current = stored ? JSON.parse(stored) : null;
              const username = current?.username;
              const communities = rawRoot3.map((c: any) => ({
                ...c,
                memberCount: Array.isArray(c?.members) ? c.members.length : 0,
                isJoined: username ? Array.isArray(c?.members) && c.members.includes(username) : false,
              }));
              return { success: true, communities } as any;
            } catch (_e) {
              if (__DEV__) {
                console.debug('getCommunities fallbacks exhausted');
              }
              return { success: false, communities: [] } as any;
            }
          }
        }
      }
    }
  }

  async getCommunity(communityId: string) {
    return this.makeRequest(`/communities/${communityId}`);
  }

  async getCommunityMembers(communityId: string) {
    try {
      const data = await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/members`);
      const membersRaw = (data as any)?.members || ((data as any)?.data?.members) || [];
      const normalize = (m: any) => ({
        username: m?.username || m?.user || '',
        name: m?.name || m?.username || m?.user || '',
        avatar: this.normalizeAvatar(m?.avatar),
        isAdmin: !!m?.isAdmin,
        isCreator: !!m?.isCreator,
      });
      const members = Array.isArray(membersRaw) ? membersRaw.map(normalize) : [];
      return { success: true, members } as any;
    } catch (error) {
      console.error('getCommunityMembers error:', error);
      return { success: false, members: [] } as any;
    }
  }

  async promoteCommunityMember(communityId: string, username: string) {
    try {
      const data = await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/promote`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      return (data as any) || { success: true };
    } catch (error) {
      console.error('promoteCommunityMember error:', error);
      return { success: false, message: 'Failed to promote member' } as any;
    }
  }

  async demoteCommunityMember(communityId: string, username: string) {
    try {
      const data = await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/demote`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      return (data as any) || { success: true };
    } catch (error) {
      console.error('demoteCommunityMember error:', error);
      return { success: false, message: 'Failed to demote member' } as any;
    }
  }

  async removeCommunityMember(communityId: string, targetUsername: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      const data = await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/remove-member`, {
        method: 'POST',
        body: JSON.stringify({ username, target: targetUsername }),
      });
      return (data as any) || { success: true };
    } catch (error) {
      console.error('removeCommunityMember error:', error);
      return { success: false, message: 'Failed to remove member' } as any;
    }
  }

  async getCommunityMessages(communityId: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;

      if (!username) {
        console.warn('getCommunityMessages: missing current user');
        return { success: false, messages: [] } as any;
      }

      const data = await this.makeRequest(
        `/communities/${encodeURIComponent(communityId)}/messages?username=${encodeURIComponent(
          username
        )}`
      );
      const messages = (data as any)?.messages || (Array.isArray(data) ? data : []);
      return { success: true, messages } as any;
    } catch (error) {
      console.error('getCommunityMessages error:', error);
      throw error;
    }
  }

  async sendCommunityTextMessage(communityId: string, text: string, replyTo?: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      const name = current?.name || `${current?.firstName || ''} ${current?.surname || ''}`.trim() || username;

      const formData = new FormData();
      if (username) {
        formData.append('sender', JSON.stringify({ username, name, avatar: this.normalizeAvatar(current?.avatar) }));
      }
      formData.append('text', text);
      formData.append('time', new Date().toISOString());
      if (replyTo) formData.append('replyTo', replyTo);

      const res = await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/messages`, {
        method: 'POST',
        body: formData,
      });
      const savedMsg = (res as any)?.message || res;
      try {
        const messageId = savedMsg?._id || savedMsg?.id;
        await this.triggerCommunityMessageNotifications(communityId, text, messageId);
      } catch (notifyErr) {
        if (__DEV__) console.debug('triggerCommunityMessageNotifications failed:', notifyErr);
      }
      return res;
    } catch (error) {
      console.error('sendCommunityTextMessage error:', error);
      throw error;
    }
  }

  async getCommunityPosts() {
    // Backend represents community feed via community messages;
    // provide an adapter returning messages as posts for the screen.
    try {
      const list = await this.getCommunities();
      const communities: any[] = (list as any)?.communities || [];
      const posts: any[] = [];
      for (const c of communities) {
        const msgs = await this.getCommunityMessages(c._id);
        const m = (msgs as any)?.messages || [];
        // Map messages to a simplified post-like structure
        m.forEach((msg: any) => {
          posts.push({
            _id: msg._id,
            community: c._id,
            author: msg.sender?.username
              ? { username: msg.sender.username, name: msg.sender.name || msg.sender.username, avatar: msg.sender.avatar }
              : { username: msg.sender, name: msg.sender, avatar: '' },
            content: msg.text || '',
            files: msg.media || [],
            likes: msg.likes || [],
            comments: msg.comments || [],
            createdAt: msg.time || msg.timestamp || new Date().toISOString(),
          });
        });
      }
      return { success: true, posts } as any;
    } catch (error) {
      console.error('getCommunityPosts error:', error);
      return { success: false, posts: [] } as any;
    }
  }

  async joinCommunity(communityId: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      return this.makeRequest(`/communities/${communityId}/join`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('joinCommunity error:', error);
      throw error;
    }
  }

  async leaveCommunity(communityId: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;
      return this.makeRequest(`/communities/${communityId}/leave`, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('leaveCommunity error:', error);
      throw error;
    }
  }

  async lockCommunity(communityId: string) {
    const stored = await AsyncStorage.getItem('currentUser');
    const current = stored ? JSON.parse(stored) : null;
    const username = current?.username;
    const userPayload = { username, Username: username, userName: username };
    try {
      return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/lock`, {
        method: 'PATCH',
        body: JSON.stringify({ lock: true, ...userPayload }),
      });
    } catch (error: any) {
      // Try root-level lock route
      try {
        return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}/lock`, {
          method: 'PATCH',
          body: JSON.stringify({ lock: true, ...userPayload }),
        });
      } catch (_rootLockErr) {}
      const payload = {
        ...userPayload,
        id: communityId,
        communityId,
        action: 'lock',
        locked: true,
        isLocked: true,
        status: 'locked',
      };
      try {
        return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } catch (_e1) {
        try {
          return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
        } catch (_e2) {
          try {
            return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/update`, {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          } catch (_e3) {
            try {
              return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/lock-state`, {
                method: 'POST',
                body: JSON.stringify({ ...userPayload, locked: true }),
              });
            } catch (_e4) {
              // Root-level update attempts
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}`, {
                  method: 'PUT',
                  body: JSON.stringify(payload),
                });
              } catch (_rootPutErr) {}
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}`, {
                  method: 'PATCH',
                  body: JSON.stringify(payload),
                });
              } catch (_rootPatchErr) {}
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}/update`, {
                  method: 'POST',
                  body: JSON.stringify(payload),
                });
              } catch (_rootUpdateErr) {}
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}/lock-state`, {
                  method: 'POST',
                  body: JSON.stringify({ ...userPayload, locked: true }),
                });
              } catch (_rootLockStateErr) {}
              // Legacy/alternative lock endpoints
              const legacyBodies = [
                { id: communityId, communityId, ...userPayload },
                { groupId: communityId, ...userPayload },
                { community: communityId, ...userPayload },
                { id: communityId, Username: userPayload.Username },
              ];
              const legacyRoutes = [
                '/communities/lock',
                `/communities/${encodeURIComponent(communityId)}/lock`,
                '/community/lock',
                `/community/${encodeURIComponent(communityId)}/lock`,
                '/groups/lock',
                `/groups/${encodeURIComponent(communityId)}/lock`,
                '/group/lock',
                `/group/${encodeURIComponent(communityId)}/lock`,
              ];
              for (const route of legacyRoutes) {
                for (const body of legacyBodies) {
                  try {
                    return await this.makeRequest(route, {
                      method: 'POST',
                      body: JSON.stringify(body),
                    });
                  } catch (_) {
                    try {
                      return await this.makeRootRequest(route, {
                        method: 'POST',
                        body: JSON.stringify(body),
                      });
                    } catch (_) {}
                  }
                }
              }
              console.error('lockCommunity error:', error);
              throw error;
            }
          }
        }
      }
    }
  }

  async unlockCommunity(communityId: string) {
    const stored = await AsyncStorage.getItem('currentUser');
    const current = stored ? JSON.parse(stored) : null;
    const username = current?.username;
    const userPayload = { username, Username: username, userName: username };
    try {
      return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/unlock`, {
        method: 'PATCH',
        body: JSON.stringify({ lock: false, ...userPayload }),
      });
    } catch (error: any) {
      // Try root-level unlock route
      try {
        return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}/unlock`, {
          method: 'PATCH',
          body: JSON.stringify({ lock: false, ...userPayload }),
        });
      } catch (_rootUnlockErr) {}
      const payload = {
        ...userPayload,
        id: communityId,
        communityId,
        action: 'unlock',
        locked: false,
        isLocked: false,
        status: 'unlocked',
      };
      try {
        return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } catch (_e1) {
        try {
          return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
        } catch (_e2) {
          try {
            return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/update`, {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          } catch (_e3) {
            try {
              return await this.makeRequest(`/communities/${encodeURIComponent(communityId)}/lock-state`, {
                method: 'POST',
                body: JSON.stringify({ ...userPayload, locked: false }),
              });
            } catch (_e4) {
              // Root-level update attempts
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}`, {
                  method: 'PUT',
                  body: JSON.stringify(payload),
                });
              } catch (_rootPutErr) {}
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}`, {
                  method: 'PATCH',
                  body: JSON.stringify(payload),
                });
              } catch (_rootPatchErr) {}
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}/update`, {
                  method: 'POST',
                  body: JSON.stringify(payload),
                });
              } catch (_rootUpdateErr) {}
              try {
                return await this.makeRootRequest(`/communities/${encodeURIComponent(communityId)}/lock-state`, {
                  method: 'POST',
                  body: JSON.stringify({ ...userPayload, locked: false }),
                });
              } catch (_rootLockStateErr) {}
              // Legacy/alternative unlock endpoints
              const legacyBodies = [
                { id: communityId, communityId, ...userPayload },
                { groupId: communityId, ...userPayload },
                { community: communityId, ...userPayload },
                { id: communityId, Username: userPayload.Username },
              ];
              const legacyRoutes = [
                '/communities/unlock',
                `/communities/${encodeURIComponent(communityId)}/unlock`,
                '/community/unlock',
                `/community/${encodeURIComponent(communityId)}/unlock`,
                '/groups/unlock',
                `/groups/${encodeURIComponent(communityId)}/unlock`,
                '/group/unlock',
                `/group/${encodeURIComponent(communityId)}/unlock`,
              ];
              for (const route of legacyRoutes) {
                for (const body of legacyBodies) {
                  try {
                    return await this.makeRequest(route, {
                      method: 'POST',
                      body: JSON.stringify(body),
                    });
                  } catch (_) {
                    try {
                      return await this.makeRootRequest(route, {
                        method: 'POST',
                        body: JSON.stringify(body),
                      });
                    } catch (_) {}
                  }
                }
              }
              console.error('unlockCommunity error:', error);
              throw error;
            }
          }
        }
      }
    }
  }

  // Delete a single message for the current user (hide)
  async deleteCommunityMessageForMe(communityId: string, msgId: string, username?: string) {
    try {
      let u = username;
      if (!u) {
        const stored = await AsyncStorage.getItem('currentUser');
        const current = stored ? JSON.parse(stored) : null;
        u = current?.username;
      }
      if (!u) throw new Error('deleteCommunityMessageForMe: missing username');
      return this.makeRequest(`/communities/${encodeURIComponent(communityId)}/messages/${encodeURIComponent(msgId)}/hide`, {
        method: 'POST',
        body: JSON.stringify({ username: u }),
      });
    } catch (error) {
      console.error('deleteCommunityMessageForMe error:', error);
      throw error;
    }
  }

  // Delete a message for everyone (requires sender or admin privileges)
  async deleteCommunityMessageForEveryone(communityId: string, msgId: string, username?: string) {
    try {
      let u = username;
      if (!u) {
        const stored = await AsyncStorage.getItem('currentUser');
        const current = stored ? JSON.parse(stored) : null;
        u = current?.username;
      }
      if (!u) throw new Error('deleteCommunityMessageForEveryone: missing username');
      return this.makeRequest(`/communities/${encodeURIComponent(communityId)}/messages/${encodeURIComponent(msgId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ username: u }),
      });
    } catch (error) {
      console.error('deleteCommunityMessageForEveryone error:', error);
      throw error;
    }
  }

  // Edit message text
  async editCommunityMessage(communityId: string, msgId: string, newText: string) {
    try {
      return this.makeRequest(`/communities/${encodeURIComponent(communityId)}/messages/${encodeURIComponent(msgId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: newText }),
      });
    } catch (error) {
      console.error('editCommunityMessage error:', error);
      throw error;
    }
  }

  async getUserCommunities(username?: string) {
    try {
      let u = username;
      if (!u) {
        const stored = await AsyncStorage.getItem('currentUser');
        const current = stored ? JSON.parse(stored) : null;
        u = current?.username;
      }
      if (!u) {
        return { success: false, owned: [], joined: [] } as any;
      }

      const normalize = (c: any) => ({
        ...c,
        avatar: this.normalizeAvatar(c?.avatar),
        memberCount: Array.isArray(c?.members) ? c.members.length : 0,
        isJoined: Array.isArray(c?.members) && c.members.includes(u!),
      });

      const extractLists = (data: any) => {
        const ownedRaw =
          data?.owned ||
          data?.owner ||
          data?.my ||
          data?.mine ||
          data?.created ||
          data?.createdCommunities ||
          data?.data?.owned ||
          [];
        const joinedRaw =
          data?.joined ||
          data?.member ||
          data?.memberships ||
          data?.subscribed ||
          data?.data?.joined ||
          (Array.isArray(data) ? data : []) ||
          [];
        return {
          owned: Array.isArray(ownedRaw) ? ownedRaw.map(normalize) : [],
          joined: Array.isArray(joinedRaw) ? joinedRaw.map(normalize) : [],
        };
      };

      try {
        const data = await this.makeRequest(`/communities/user/${encodeURIComponent(u)}`);
        const { owned, joined } = extractLists(data);
        if (owned.length || joined.length) {
          return { success: true, owned, joined } as any;
        }
      } catch (_e) {}

      const altRoutes = [
        `/users/${encodeURIComponent(u)}/communities`,
        `/user/${encodeURIComponent(u)}/communities`,
        `/communities/by-user/${encodeURIComponent(u)}`,
        `/community/user/${encodeURIComponent(u)}`,
      ];
      for (const route of altRoutes) {
        try {
          const data = await this.makeRequest(route);
          const { owned, joined } = extractLists(data);
          if (owned.length || joined.length) {
            return { success: true, owned, joined } as any;
          }
        } catch (_) {}
      }

      const altRootRoutes = [
        `/communities/user/${encodeURIComponent(u)}`,
        `/users/${encodeURIComponent(u)}/communities`,
        `/user/${encodeURIComponent(u)}/communities`,
        `/communities/by-user/${encodeURIComponent(u)}`,
        `/community/user/${encodeURIComponent(u)}`,
      ];
      for (const route of altRootRoutes) {
        try {
          const data = await this.makeRootRequest(route);
          const { owned, joined } = extractLists(data);
          if (owned.length || joined.length) {
            return { success: true, owned, joined } as any;
          }
        } catch (_) {}
      }

      try {
        const all = await this.getCommunities();
        const list = (all as any)?.communities || [];
        const owned = list
          .filter((c: any) => c?.createdBy === u || c?.owner === u)
          .map(normalize);
        const joined = list
          .filter((c: any) => c?.isJoined || (Array.isArray(c?.members) && c.members.includes(u)))
          .map(normalize);
        return { success: true, owned, joined } as any;
      } catch (fallbackErr) {
        console.error('getUserCommunities fallback via getCommunities failed:', fallbackErr);
        return { success: false, owned: [], joined: [] } as any;
      }
    } catch (error) {
      console.error('getUserCommunities error:', error);
      return { success: false, owned: [], joined: [] } as any;
    }
  }

  async createCommunity(data: { name: string; description: string; category?: string; isPrivate?: boolean; avatar?: string }) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;

      const payload = {
        name: data.name,
        description: data.description,
        avatar: data.avatar,
        username,
      };

      return this.makeRequest('/communities/create', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('createCommunity error:', error);
      throw error;
    }
  }

  async editCommunity(communityId: string, data: { name?: string; description?: string; avatar?: string }) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const username = current?.username;

      const payload: any = { username };
      if (typeof data.name === 'string') payload.name = data.name;
      if (typeof data.description === 'string') payload.description = data.description;
      if (typeof data.avatar === 'string') payload.avatar = data.avatar;

      return this.makeRequest(`/communities/${encodeURIComponent(communityId)}/edit`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('editCommunity error:', error);
      throw error;
    }
  }

  // Upload image (multipart) and return a normalized URL
  async uploadImage(uri: string, fileName: string = 'upload.jpg', mimeType: string = 'image/jpeg') {
    try {
      const token = await this.getAuthToken();
      const form = new FormData();
      // React Native requires this shape for file uploads
      form.append('files', {
        uri,
        name: fileName,
        type: mimeType,
      } as any);

      const headers: HeadersInit = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(`${this.baseUrl}/upload`, {
        method: 'POST',
        headers,
        body: form,
      });

      const payload = await response.json();
      if (!response.ok) {
        const message = (payload && payload.message) || `HTTP error ${response.status}`;
        const err = new Error(message);
        (err as any).status = response.status;
        (err as any).payload = payload;
        throw err;
      }

      const files = (payload as any)?.files || [];
      const first = files[0];
      const url: string | undefined = first?.secure_url || first?.url;
      return { success: true, url } as any;
    } catch (error) {
      console.error('uploadImage error:', error);
      throw error;
    }
  }

  // Notifications methods
  async getNotifications(username?: string) {
    // Prefer user-specific like/comment notifications when a username is provided,
    // otherwise fall back to sponsor alerts visible to all users.
    try {
      if (username) {
        const likesComments = await this.makeRequest(
          `/notifications/likes-comments/${encodeURIComponent(username)}`
        );
        return {
          success: true,
          notifications: Array.isArray(likesComments)
            ? likesComments
            : (likesComments as any)?.notifications || likesComments || [],
        };
      }

      const sponsorAlerts = await this.makeRequest('/notifications/sponsor-alerts');
      return {
        success: true,
        notifications: Array.isArray(sponsorAlerts)
          ? sponsorAlerts
          : (sponsorAlerts as any)?.notifications || sponsorAlerts || [],
      };
    } catch (error) {
      console.error('getNotifications error:', error);
      throw error;
    }
  }

  // Send a single push notification via backend
  async sendPushNotification(
    toUsername: string,
    title: string,
    body: string,
    type: string = 'alert',
    data: Record<string, any> = {}
  ): Promise<any> {
    try {
      const resp = await this.makeRequest('/notifications/send', {
        method: 'POST',
        body: JSON.stringify({ toUsername, title, body, type, data }),
      });
      return resp;
    } catch (error) {
      console.error('sendPushNotification error:', error);
      return { success: false } as any;
    }
  }

  // Trigger push notifications for a new community message
  async triggerCommunityMessageNotifications(
    communityId: string,
    text: string,
    messageId?: string,
    attachments?: Array<{ url: string; type?: string; name?: string }>
  ): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const senderUsername = current?.username;
      const senderName = current?.name || `${current?.firstName || ''} ${current?.surname || ''}`.trim() || senderUsername;

      const comm = await this.getCommunity(communityId);
      const communityName = (comm as any)?.name || (comm as any)?.community?.name || '';

      const membersResp = await this.getCommunityMembers(communityId);
      const members = (membersResp as any)?.members || [];
      const targets: { username: string }[] = members
        .filter((m: any) => (m?.username || m?.user) && (m?.username || m?.user) !== senderUsername)
        .map((m: any) => ({ username: m?.username || m?.user }));

      const title = `You have a message from ${senderName} on "${communityName}"`;
      let body = text;
      // If no text, describe attachments
      if ((!body || body.trim().length === 0) && Array.isArray(attachments) && attachments.length > 0) {
        const types = attachments.map(a => (a?.type || '')).filter(Boolean);
        const counts: Record<string, number> = {};
        types.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        const parts = Object.entries(counts).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`);
        body = parts.length > 0 ? `Sent ${parts.join(', ')}` : 'Sent a new attachment';
      }
      const baseData: Record<string, string> = {
        type: 'community_message',
        communityId: String(communityId),
        communityName: String(communityName || ''),
        senderUsername: String(senderUsername || ''),
        senderName: String(senderName || ''),
        messageId: messageId ? String(messageId) : '',
        mediaTypes: Array.isArray(attachments) ? attachments.map(a => a?.type || '').join(',') : '',
      };

      await Promise.all(
        targets.map(t =>
          this.sendPushNotification(t.username, title, body, 'community_message', baseData)
        )
      );
    } catch (error) {
      console.error('triggerCommunityMessageNotifications error:', error);
    }
  }

  async markNotificationAsRead(_notificationId: string) {
    try {
      const id = encodeURIComponent(_notificationId);
      const resp = await this.makeRequest(`/notifications/${id}/read`, {
        method: 'PUT',
      });
      return (resp as any) || { success: true };
    } catch (error) {
      console.error('markNotificationAsRead error:', error);
      // Fail soft to avoid UI interruption
      return { success: false } as any;
    }
  }

  async markAllNotificationsAsRead(username?: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const u = username || current?.username;
      // Fetch current notifications (likes/comments for user)
      const list = await this.getNotifications(u);
      const items: any[] = (list as any)?.notifications || [];
      // PUT each to mark as read; batch quietly
      await Promise.all(
        items.map((n) => {
          if (!n?._id) return Promise.resolve(null);
          return this.makeRequest(`/notifications/${encodeURIComponent(n._id)}/read`, { method: 'PUT' })
            .catch(() => null);
        })
      );
      return { success: true } as any;
    } catch (error) {
      console.error('markAllNotificationsAsRead error:', error);
      return { success: false } as any;
    }
  }

  async clearAllNotifications(username?: string) {
    try {
      const stored = await AsyncStorage.getItem('currentUser');
      const current = stored ? JSON.parse(stored) : null;
      const u = username || current?.username;
      // Fetch notifications to collect IDs
      const list = await this.getNotifications(u);
      const ids: string[] = ((list as any)?.notifications || [])
        .map((n: any) => n?._id)
        .filter((id: any) => typeof id === 'string');

      if (ids.length === 0) return { success: true } as any;

      const resp = await this.makeRequest('/notifications/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      return (resp as any) || { success: true };
    } catch (error) {
      console.error('clearAllNotifications error:', error);
      return { success: false } as any;
    }
  }

  // File upload
  async uploadFile(
    file: { uri: string; name: string; type: string },
    type: 'image' | 'video' | 'audio' | 'document',
    onProgress?: (percent: number) => void
  ) {
    // If progress callback is provided, use XMLHttpRequest to track upload progress
    if (onProgress) {
      return new Promise<any>(async (resolve, reject) => {
        try {
          const token = await this.getAuthToken();
          const form = new FormData();
          // Server accepts arbitrary field names via upload.any(); use a plural key
          (form as any).append('files', {
            uri: file.uri,
            name: file.name,
            type: file.type || 'application/octet-stream',
          } as any);
          (form as any).append('type', type);

          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${this.baseUrl}/upload`);
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              try { onProgress(percent); } catch (_) {}
            }
          };

          xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
              // Finalize progress at 100%
              try { onProgress(100); } catch (_) {}
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  const payload = JSON.parse(xhr.responseText || '{}');
                  resolve(payload);
                } catch (e) {
                  resolve({ success: true });
                }
              } else {
                reject(new Error(`HTTP error ${xhr.status}`));
              }
            }
          };

          // RN automatically sets proper multipart boundaries for FormData
          xhr.send(form as any);
        } catch (err) {
          reject(err);
        }
      });
    }

    // Fallback: simple fetch without progress
    const formData = new FormData();
    (formData as any).append('files', file as any);
    (formData as any).append('type', type);

    return this.makeRequest('/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      body: formData,
    });
  }

  // Download a remote media file to device storage with progress callback
  async downloadFile(
    url: string,
    filename: string,
    onProgress?: (percent: number) => void
  ) {
    try {
      // Prefer app documents directory for safe sharing (scoped storage friendly)
      const baseDir = RNFS.DocumentDirectoryPath;
      const safeFilename = (filename || `download-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = `${baseDir}/${safeFilename}`;
      try { await RNFS.mkdir(baseDir); } catch (_) {}

      const token = await this.getAuthToken();
      // Only send Authorization for same-host API endpoints
      const needsAuth = (() => {
        try {
          const target = new URL(url);
          const apiOrigin = new URL(this.baseUrl).origin;
          const rootOrigin = new URL(this.rootUrl).origin;
          const sameHost = (target.origin === apiOrigin || target.origin === rootOrigin);
          return sameHost && target.pathname.startsWith('/api');
        } catch {
          return false;
        }
      })();
      const headers = needsAuth && token ? { Authorization: `Bearer ${token}` } : undefined;
      const result = await RNFS.downloadFile({
        fromUrl: url,
        toFile: destPath,
        headers,
        progressDivider: 2,
        begin: (_res) => {
          try { onProgress?.(0); } catch (_) {}
        },
        progress: (data) => {
          const percent = Math.floor((data.bytesWritten / data.contentLength) * 100);
          try { onProgress?.(percent); } catch (_) {}
        },
      }).promise;

      if (result.statusCode && result.statusCode >= 200 && result.statusCode < 300) {
        try { onProgress?.(100); } catch (_) {}
        return { success: true, path: destPath } as any;
      }
      return { success: false, statusCode: result.statusCode } as any;
    } catch (err) {
      console.error('downloadFile error:', err);
      throw err;
    }
  }

  // Delete the currently authenticated account (or an identifier if provided)
  async deleteAccount(identifier?: string) {
    try {
      let id = identifier;
      if (!id) {
        try {
          const userJson = await AsyncStorage.getItem('currentUser');
          const user = userJson ? JSON.parse(userJson) : null;
          id = user?.username || user?._id || user?.id || user?.email || undefined;
        } catch (_) {}
      }
      const body = id ? { identifier: id } : {};
      return this.makeRequest('/auth/delete-account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error('deleteAccount error:', err);
      throw err;
    }
  }
}

// Export a lazy singleton to avoid constructor side effects during module import.
// The instance is created on first property access, deferring initialization
// until the service is actually used by a screen or another module.
let __apiSingleton: ApiService | null = null;
const apiServiceProxy: ApiService = new Proxy({} as ApiService, {
  get(_target, prop: keyof ApiService) {
    if (!__apiSingleton) __apiSingleton = new ApiService();
    const value = (__apiSingleton as any)[prop];
    return typeof value === 'function'
      ? (...args: any[]) => (value as any).apply(__apiSingleton, args)
      : value;
  },
  set(_target, prop: keyof ApiService, value: any) {
    if (!__apiSingleton) __apiSingleton = new ApiService();
    (__apiSingleton as any)[prop] = value;
    return true;
  },
}) as ApiService;

export default apiServiceProxy;