import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type CaptureSource = 'camera' | 'gallery';

/** An image exactly as the picker returned it: full resolution, not yet downscaled. */
export type RawPick = { uri: string; width: number; height: number };

export type PickResult =
  | { kind: 'ok'; picks: RawPick[] }
  | { kind: 'canceled' }
  /** openSettings: the cause is a refused permission, so the alert should offer to open Settings. */
  | { kind: 'error'; title: string; message: string; openSettings?: boolean };

export const MAX_GALLERY_PICKS = 20;

/**
 * Camera (single photo) or gallery (several photos) via expo-image-picker.
 * Quality 1 and no built-in crop: cropping is done by our own crop screen.
 */
export async function pickImages(source: CaptureSource): Promise<PickResult> {
  try {
    let result: ImagePicker.ImagePickerResult;

    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        return {
          kind: 'error',
          title: 'Camera access is off',
          message:
            'KiteScan needs the camera to photograph documents. Photos never leave your phone. You can allow it in Settings, or import from your gallery instead.',
          openSettings: true,
        };
      }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: MAX_GALLERY_PICKS,
        orderedSelection: true,
      });
    }

    if (result.canceled || result.assets.length === 0) return { kind: 'canceled' };
    return {
      kind: 'ok',
      picks: result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })),
    };
  } catch {
    return {
      kind: 'error',
      title: 'Could not open your photos',
      message: 'Something went wrong while opening the camera or gallery. Please try again.',
    };
  }
}

/**
 * Android can kill the app while the camera is open (low memory). The photo is then delivered the next
 * time the app starts; this picks it up so it is not lost. Returns null when there is nothing pending.
 */
export async function recoverPendingPick(): Promise<RawPick[] | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    if (!pending || !('assets' in pending) || pending.canceled || !pending.assets?.length) return null;
    return pending.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
  } catch {
    return null;
  }
}
