/**
 * Magic-byte media type detection.
 *
 * Replaces the Python library's `filetype` dependency. Covers the formats
 * x.com accepts for uploads; anything else returns `null`.
 */

export interface DetectedType {
  mime: string;
  extension: string;
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

const ascii = (buffer: Buffer, offset: number, length: number): string =>
  buffer.subarray(offset, offset + length).toString('latin1');

export function detectMediaType(buffer: Buffer): DetectedType | null {
  if (buffer.length < 12) return null;

  // JPEG
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }

  // PNG
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', extension: 'png' };
  }

  // GIF
  if (ascii(buffer, 0, 3) === 'GIF') {
    return { mime: 'image/gif', extension: 'gif' };
  }

  // WEBP
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }

  // BMP
  if (ascii(buffer, 0, 2) === 'BM') {
    return { mime: 'image/bmp', extension: 'bmp' };
  }

  // ISO base media (MP4 / MOV / M4V) — 'ftyp' at offset 4.
  if (ascii(buffer, 4, 4) === 'ftyp') {
    const brand = ascii(buffer, 8, 4).trim().toLowerCase();
    if (brand.startsWith('qt')) {
      return { mime: 'video/quicktime', extension: 'mov' };
    }
    return { mime: 'video/mp4', extension: 'mp4' };
  }

  // Matroska / WebM
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    const header = buffer.subarray(0, Math.min(buffer.length, 64)).toString('latin1');
    if (header.includes('webm')) return { mime: 'video/webm', extension: 'webm' };
    return { mime: 'video/x-matroska', extension: 'mkv' };
  }

  // AVI
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'AVI ') {
    return { mime: 'video/x-msvideo', extension: 'avi' };
  }

  return null;
}
