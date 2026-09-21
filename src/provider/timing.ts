export interface ReplayChunk {
  text: string;
  delayMs: number;
}

export function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

function baseGraphemeDelayMs(grapheme: string): number {
  if (grapheme === "\n") return 120;
  if (/[。！？.!?]/u.test(grapheme)) return 180;
  if (/[,，、;；]/u.test(grapheme)) return 90;
  return 45;
}

export function graphemeDelayMs(grapheme: string, speed: number): number {
  return Math.max(1, Math.round(baseGraphemeDelayMs(grapheme) / speed));
}

export function replayChunkSize(speed: number): number {
  return speed <= 4 ? 1 : Math.min(25, Math.ceil(speed / 4));
}

export function toolCallChunkSize(speed: number): number {
  if (speed <= 1) return 1;
  return Math.min(80, Math.max(8, Math.ceil(speed * 2)));
}

export function splitToolCallChunks(text: string, speed: number): ReplayChunk[] {
  const graphemes = splitGraphemes(text);
  const maxSize = toolCallChunkSize(speed);
  const chunks: ReplayChunk[] = [];
  for (let index = 0; index < graphemes.length; index += maxSize) {
    const slice = graphemes.slice(index, index + maxSize);
    chunks.push({
      text: slice.join(""),
      delayMs: Math.max(1, Math.round((slice.length * 12) / speed)),
    });
  }
  return chunks;
}

export function splitReplayChunks(text: string, speed: number): ReplayChunk[] {
  const graphemes = splitGraphemes(text);
  const maxSize = replayChunkSize(speed);
  const chunks: ReplayChunk[] = [];
  let current: string[] = [];
  let baseDelay = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      text: current.join(""),
      delayMs: Math.max(1, Math.round(baseDelay / speed)),
    });
    current = [];
    baseDelay = 0;
  };

  for (const grapheme of graphemes) {
    current.push(grapheme);
    baseDelay += baseGraphemeDelayMs(grapheme);
    if (current.length >= maxSize || grapheme === "\n" || /[。！？.!?]/u.test(grapheme)) flush();
  }
  flush();
  return chunks;
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
