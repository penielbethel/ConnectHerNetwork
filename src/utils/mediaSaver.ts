import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';
import { PermissionsManager } from './permissions';
import apiService from '../services/ApiService';

export type MediaKind = 'image' | 'video' | 'audio' | 'file' | 'document';

export interface SaveOptions {
  url: string;
  type?: MediaKind;
  filename?: string;
  headers?: Record<string, string>;
  onProgress?: (percent: number) => void;
}

export interface SaveResult {
  success: boolean;
  path?: string;
  openedShareSheet?: boolean;
  statusCode?: number;
  message?: string;
}

const guessKindFromUrl = (url: string): MediaKind => {
  const lower = url.toLowerCase();
  const ext = lower.match(/\.([a-z0-9]+)(?:\?|$)/)?.[1];
  if (!ext) return 'file';
  if (['jpg','jpeg','png','webp','gif','heic'].includes(ext)) return 'image';
  if (['mp4','mov','webm','mkv'].includes(ext)) return 'video';
  if (['mp3','m4a','aac','wav','ogg'].includes(ext)) return 'audio';
  return ['pdf','doc','docx','ppt','pptx','xls','xlsx','txt'].includes(ext) ? 'document' : 'file';
};

const safeFilename = (filename?: string, fallbackExt?: string) => {
  const base = (filename && filename.trim().length > 0 ? filename : `file_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  // Ensure extension exists when guessing kind requires it
  if (!base.match(/\.[a-z0-9]+$/i) && fallbackExt) {
    return `${base}.${fallbackExt}`;
  }
  return base;
};

const getFilenameFromUrl = (url: string) => {
  try {
    const u = new URL(url);
    const pathname = u.pathname || '';
    const name = pathname.split('/').pop() || `file_${Date.now()}`;
    return decodeURIComponent(name);
  } catch (_) {
    const parts = url.split('?')[0].split('/');
    return parts[parts.length - 1] || `file_${Date.now()}`;
  }
};

const mimeFromExt = (ext: string) => {
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain'
  };
  return map[ext] || 'application/octet-stream';
};

export const saveMediaToDevice = async (opts: SaveOptions): Promise<SaveResult> => {
  const kind: MediaKind = opts.type || guessKindFromUrl(opts.url);
  const url = opts.url;
  const guessedName = getFilenameFromUrl(url);
  const extMatch = guessedName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : (kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'bin');
  const mime = mimeFromExt(ext);
  const filename = safeFilename(opts.filename || guessedName, ext);

  try {
    // Android: request storage permissions before writing to public dirs
    if (Platform.OS === 'android') {
      const perm = await PermissionsManager.requestStoragePermission();
      if (!perm?.granted) {
        return { success: false, message: 'Storage permission denied' };
      }
    }

    // Build candidate directories with safe fallbacks
    const candidates: string[] = [];
    if (Platform.OS === 'android') {
      if (kind === 'image' && (RNFS as any).PicturesDirectoryPath) candidates.push((RNFS as any).PicturesDirectoryPath);
      else if (kind === 'video' && (RNFS as any).MoviesDirectoryPath) candidates.push((RNFS as any).MoviesDirectoryPath);
      else if (kind === 'audio' && (RNFS as any).MusicDirectoryPath) candidates.push((RNFS as any).MusicDirectoryPath);
      if ((RNFS as any).DownloadDirectoryPath) candidates.push((RNFS as any).DownloadDirectoryPath);
      // Final fallback to app-scoped storage to avoid public dir issues
      candidates.push(RNFS.DocumentDirectoryPath);
    } else {
      candidates.push(RNFS.DocumentDirectoryPath);
    }

    const isLocalFile = url.startsWith('file://');
    let lastError: any = null;

    for (const baseDir of candidates) {
      try { await RNFS.mkdir(baseDir); } catch (_) {}
      const destPath = `${baseDir}/${filename}`;

      try {
        let res: { statusCode?: number } = {};
        if (isLocalFile) {
          const srcPath = url.replace(/^file:\/\//, '');
          await RNFS.copyFile(srcPath, destPath);
          try { opts.onProgress?.(100); } catch (_) {}
          res.statusCode = 200;
        } else {
          res = await RNFS.downloadFile({
            fromUrl: url,
            toFile: destPath,
            headers: opts.headers,
            progressDivider: 5,
            begin: () => { try { opts.onProgress?.(0); } catch (_) {} },
            progress: (p) => {
              const pct = Math.floor((p.bytesWritten / p.contentLength) * 100);
              try { opts.onProgress?.(Math.max(0, Math.min(100, pct))); } catch (_) {}
            },
          }).promise as any;
        }

        const ok = (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) || isLocalFile;
        if (ok) {
          try { opts.onProgress?.(100); } catch (_) {}
          if (Platform.OS === 'android') {
            try {
              const scan = (RNFS as any).scanFile;
              if (typeof scan === 'function') {
                await scan(destPath);
              }
            } catch (_) {}

            const usedAppDocs = baseDir === RNFS.DocumentDirectoryPath;
            if (usedAppDocs) {
              // Offer share sheet to export file from app storage
              try {
                const fileUri = destPath.startsWith('file://') ? destPath : `file://${destPath}`;
                await RNShare.open({ urls: [fileUri], type: mime, filename });
                return { success: true, path: destPath, openedShareSheet: true, message: `Downloaded to app storage (${destPath})` };
              } catch (_err: any) {
                return { success: true, path: destPath, message: `Downloaded to app storage (${destPath})` };
              }
            }
            return { success: true, path: destPath, message: `Saved to ${destPath}` };
          } else {
            // iOS: open share sheet so user can save to Files/Photos
            try {
              const fileUri = destPath.startsWith('file://') ? destPath : `file://${destPath}`;
              await RNShare.open({ urls: [fileUri], type: mime, filename });
              return { success: true, path: destPath, openedShareSheet: true };
            } catch (err: any) {
              const msg = String(err?.message || err);
              if (msg.includes('User did not share') || msg.includes('E_SHARING_CANCELLED')) {
                return { success: true, path: destPath, openedShareSheet: true };
              }
              return { success: true, path: destPath, message: `Downloaded to ${destPath}` };
            }
          }
        } else {
          // Cloudinary access control fallback via backend proxy
          try {
            const host = (() => { try { return (new URL(url)).hostname; } catch (_) { return ''; } })();
            const isCloudinary = /cloudinary\.com/i.test(host) || /res\.cloudinary\.com/i.test(host);
            const blocked = res.statusCode === 401 || res.statusCode === 403;
            if (isCloudinary && blocked) {
              const token = await (apiService as any)['getAuthToken']?.();
              const proxyBase = (apiService as any)?.baseUrl || (apiService as any)?.rootUrl || 'https://connecther.network/api';
              const proxyUrl = `${proxyBase}/media/proxy-download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
              const proxyRes = await RNFS.downloadFile({
                fromUrl: proxyUrl,
                toFile: destPath,
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                progressDivider: 5,
                begin: () => { try { opts.onProgress?.(0); } catch (_) {} },
                progress: (p) => {
                  const pct = Math.floor((p.bytesWritten / p.contentLength) * 100);
                  try { opts.onProgress?.(Math.max(0, Math.min(100, pct))); } catch (_) {}
                },
              }).promise as any;
              const proxyOk = proxyRes.statusCode && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300;
              if (proxyOk) {
                try { opts.onProgress?.(100); } catch (_) {}
                if (Platform.OS === 'android') {
                  try {
                    const scan = (RNFS as any).scanFile;
                    if (typeof scan === 'function') { await scan(destPath); }
                  } catch (_) {}
                  const usedAppDocs = baseDir === RNFS.DocumentDirectoryPath;
                  if (usedAppDocs) {
                    try {
                      const fileUri = destPath.startsWith('file://') ? destPath : `file://${destPath}`;
                      await RNShare.open({ urls: [fileUri], type: mime, filename });
                      return { success: true, path: destPath, openedShareSheet: true, message: `Downloaded via proxy to app storage (${destPath})` };
                    } catch (_err: any) {
                      return { success: true, path: destPath, message: `Downloaded via proxy to app storage (${destPath})` };
                    }
                  }
                  return { success: true, path: destPath, message: `Saved via proxy to ${destPath}` };
                } else {
                  try {
                    const fileUri = destPath.startsWith('file://') ? destPath : `file://${destPath}`;
                    await RNShare.open({ urls: [fileUri], type: mime, filename });
                    return { success: true, path: destPath, openedShareSheet: true };
                  } catch (err: any) {
                    const msg = String(err?.message || err);
                    if (msg.includes('User did not share') || msg.includes('E_SHARING_CANCELLED')) {
                      return { success: true, path: destPath, openedShareSheet: true };
                    }
                    return { success: true, path: destPath, message: `Downloaded via proxy to ${destPath}` };
                  }
                }
              }
            }
          } catch (_) {}
        }

        // Not ok, try next candidate
        lastError = res.statusCode ? `HTTP ${res.statusCode}` : lastError;
      } catch (err: any) {
        // Capture error and try next candidate directory
        lastError = err?.message || lastError || 'Download failed';
        continue;
      }
    }

    // All candidates failed
    return { success: false, message: lastError || 'Download failed' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Download failed' };
  }
};