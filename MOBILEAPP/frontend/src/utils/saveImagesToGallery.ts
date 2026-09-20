// Keep a copy of every photo on the technician's own phone before it is sent.
//
// The upload is the moment the photos leave the device, and it is also the
// moment they can be lost: a failed request, a dropped connection or a closed
// app after the pictures were taken but before they reached Drive leaves the
// technician with nothing to show for the visit. Saving to the gallery first
// means the evidence exists somewhere the technician controls, whatever the
// network does next.
//
// Deliberately best-effort: a refused permission or a failed write never blocks
// a submission. Losing the save is a nuisance; losing the submission because of
// it would be worse.

import * as MediaLibrary from 'expo-media-library';
import * as ExpoFileSystem from 'expo-file-system/legacy';

/** One photo to keep, named by the form field it was captured for. */
export interface GallerySaveItem {
  /** The form field, which becomes the first half of the filename. */
  field: string;
  /** Where the photo is now. Only on-device files are saved. */
  uri?: string | null;
}

/**
 * Is this a file we can actually copy?
 *
 * A photo the technician just took is a local file. A value that is already an
 * http(s) URL is a picture the server sent back: it is on Drive already and
 * there is nothing to rescue, so it is skipped rather than downloaded again.
 */
const isLocalFile = (uri?: string | null): uri is string =>
  typeof uri === 'string' && uri !== '' && !/^https?:\/\//i.test(uri);

/**
 * Strip the characters a filesystem cannot take, and tidy the spacing.
 *
 * Commas and spaces are kept on purpose: both are legal in Android and iOS
 * filenames, and they are what make the name readable at a glance in the
 * gallery. Hyphens and full stops are left alone too, since they turn up in
 * real names. Only path separators and the reserved punctuation go.
 */
const sanitize = (value: string): string =>
  String(value == null ? '' : value)
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The name a saved photo is filed under: "<field>, <first name> <last name>".
 *
 * Both halves are needed. The field says which photo it is, the client's name
 * says which visit it belongs to: a gallery full of "setup_image.jpg" from
 * different jobs would be unusable.
 *
 * A record with no name still gets a usable filename rather than one ending in
 * a stray comma.
 */
export const buildGalleryFileName = (field: string, clientName: string): string => {
  const safeField = sanitize(field) || 'image';
  const safeName = sanitize(clientName);

  return safeName ? `${safeField}, ${safeName}.jpg` : `${safeField}.jpg`;
};

/**
 * Copy each photo into the phone's gallery under its own name.
 *
 * The copy through the cache is what allows the name to be chosen at all:
 * MediaLibrary files an asset under the source file's own name, so saving the
 * picker's temporary file directly would land a random string in the gallery.
 *
 * @returns how many photos were saved. Zero is a normal outcome (no new photos,
 *          or permission refused) and never an error.
 */
export const saveImagesToGallery = async (
  items: GallerySaveItem[],
  clientName: string
): Promise<number> => {
  const savable = (items || []).filter(item => isLocalFile(item && item.uri));
  if (savable.length === 0) {
    return 0;
  }

  try {
    // Write-only: this is all the app needs to file a photo, and asking for
    // read access as well would put a broader prompt in front of the
    // technician than the feature warrants.
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      console.warn('[Gallery] Permission not granted, photos were not saved to the phone');
      return 0;
    }
  } catch (error) {
    console.warn('[Gallery] Could not ask for permission, photos were not saved to the phone', error);
    return 0;
  }

  let saved = 0;

  for (const item of savable) {
    // Per photo, so one unwritable file does not cost the technician the rest.
    try {
      const fileName = buildGalleryFileName(item.field, clientName);
      const target = `${ExpoFileSystem.cacheDirectory}${fileName}`;

      await ExpoFileSystem.copyAsync({ from: item.uri as string, to: target });
      await MediaLibrary.createAssetAsync(target);
      saved += 1;
    } catch (error) {
      console.warn(`[Gallery] Failed to save "${item.field}" to the phone`, error);
    }
  }

  return saved;
};
