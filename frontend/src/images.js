/**
 * Shrink a phone photo (often several MB) to at most 1600 px as a JPEG, so it uploads quickly on a weak connection.
 * An image the browser cannot read is returned as it is (the server decides whether to accept it).
 */
export async function shrinkPhoto(file, name = 'photo.jpg') {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ? new File([blob], name, { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}
