import DocumentPickerLib, { types as libTypes } from 'react-native-document-picker';

type CopyDestination = 'documentDirectory' | 'cachesDirectory';

type PickOptions = {
  type?: string[];
  allowMultiSelection?: boolean;
  copyTo?: CopyDestination | null;
};

type PickedFile = {
  uri: string;
  name?: string;
  type?: string;
  size?: number;
  fileCopyUri?: string | null;
};

async function maybeCopy(files: PickedFile[], copyTo?: CopyDestination | null): Promise<PickedFile[]> {
  // react-native-document-picker handles copyTo internally when provided in options
  return files;
}

async function pick(options: PickOptions = {}): Promise<PickedFile[]> {
  const res = await DocumentPickerLib.pick({ type: options.type || [libTypes.allFiles], allowMultiSelection: !!options.allowMultiSelection, copyTo: options.copyTo || null } as any);
  const filesArray: any[] = Array.isArray(res) ? res : [res];
  const normalized: PickedFile[] = filesArray.map((f: any) => ({ uri: f.uri, name: f.name, type: f.type, size: f.size, fileCopyUri: f.fileCopyUri }));
  return maybeCopy(normalized, options.copyTo);
}

async function pickSingle(options: PickOptions = {}): Promise<PickedFile> {
  const res: any = await DocumentPickerLib.pickSingle({ type: options.type || [libTypes.allFiles], copyTo: options.copyTo || null } as any);
  const file: PickedFile = { uri: res.uri, name: res.name, type: res.type, size: res.size, fileCopyUri: res.fileCopyUri };
  return file;
}

async function pickMultiple(options: PickOptions = {}): Promise<PickedFile[]> {
  const files: any[] = await DocumentPickerLib.pickMultiple({ type: options.type || [libTypes.allFiles], copyTo: options.copyTo || null } as any);
  const normalized: PickedFile[] = files.map((f: any) => ({ uri: f.uri, name: f.name, type: f.type, size: f.size, fileCopyUri: f.fileCopyUri }));
  return maybeCopy(normalized, options.copyTo);
}

const DocumentPicker = {
  types: libTypes,
  isCancel: DocumentPickerLib.isCancel,
  pick,
  pickSingle,
  pickMultiple,
};

export default DocumentPicker;
