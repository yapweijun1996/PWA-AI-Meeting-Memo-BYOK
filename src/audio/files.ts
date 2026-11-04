import type { Meeting } from "../domain/model";
const MAX_AUDIO = 50 * 1024 * 1024;
const accepted = /\.(wav|mp3|mp4|m4a|webm|ogg|flac|mpeg|mpga)$/i;
export async function inspectAudio(
  file: File,
): Promise<NonNullable<Meeting["audio"]>> {
  if (!file.size || file.size > MAX_AUDIO)
    throw new Error(
      "Choose a non-empty audio file up to 50 MB. Larger recordings need an externally prepared transcript.",
    );
  if (!accepted.test(file.name))
    throw new Error(
      "Supported inputs: WAV, MP3, M4A, MP4, WebM, OGG, FLAC, MPEG. Actual decoding depends on the provider/browser.",
    );
  const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const hash = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("File checksum timed out.")),
        30000,
      );
      worker.onmessage = (event) => {
        clearTimeout(timer);
        if (event.data.error) reject(new Error("Could not verify the file."));
        else resolve(event.data.hash);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error("File worker failed."));
      };
      worker.postMessage(file);
    });
    return {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      duration: null,
      hash,
      present: true,
    };
  } finally {
    worker.terminate();
  }
}
