// Photos are scaled down before they are stored, so a phone's storage and
// the export stay small. Orientation from EXIF is applied by the browser.

const MAX_SIDE = 1600;
const QUALITY = 0.82;

export async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // a format the browser cannot decode: keep it as it is
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === 'image/jpeg' && file.size < 600_000) {
    bitmap.close?.();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', QUALITY));
}

// A date for the photo: the file's own date, as YYYY-MM-DD.
export function fileDate(file) {
  const d = new Date(file.lastModified || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
