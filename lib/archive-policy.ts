// Transfer is streamed by the Worker; these limits apply before allocation in
// the browser too. Do not silently drop/compress user assets to fit a preview.
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 10_000;

export function safeRepositoryPath(path: string): string {
  if (!path || path.length > 1000 || path.startsWith('/') || /[\\\x00-\x1f]/.test(path)) throw new Error('Invalid repository-relative path.');
  const parts = path.split('/');
  if (parts.some(part => !part || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Unsafe repository-relative path.');
  return path;
}

export function boundedStream(body: ReadableStream<Uint8Array>, limit = MAX_ARCHIVE_BYTES) {
  let size = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) throw new Error('Repository archive exceeds the 128 MiB transfer limit.');
      controller.enqueue(chunk);
    },
  }));
}
