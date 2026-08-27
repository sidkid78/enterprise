/**
 * Parent/child chunking.
 *
 * No `server-only` guard: this is pure string handling with no client, no
 * credentials, and no database access, so it is safe (and useful) to import
 * from a Client Component for a live preview of how a document will split.
 */

/**
 * Target chunk size in characters, not tokens.
 *
 * A tokenizer would be more accurate, but pulling one in to decide where to cut
 * a string buys precision this does not need — the embedding model's limit is
 * far above this and the only cost of being slightly off is a marginally
 * shorter chunk. Roughly 4 characters per token puts this near 300 tokens.
 */
const TARGET_CHUNK_CHARS = 1200;

/**
 * How much of the previous chunk each chunk repeats.
 *
 * Without overlap, a fact that straddles a boundary is in neither chunk in a
 * retrievable form: half the sentence lands in each and neither embeds to
 * anything close to the question it answers.
 */
const CHUNK_OVERLAP_CHARS = 200;

/** Below this a chunk carries no retrievable meaning and is dropped. */
const MIN_CHUNK_CHARS = 60;

export type Chunk = {
  index: number;
  content: string;
  /**
   * The markdown heading trail this chunk sits under, outermost first.
   *
   * Carried so the embedding can be given the chunk's place in the document.
   * A paragraph reading "the limit is 30 days" is retrievable only if
   * something says which limit — and in the source that is the heading three
   * paragraphs above, which naive chunking throws away.
   */
  headings: string[];
};

/**
 * Splits on paragraph boundaries, packing paragraphs up to the target size.
 *
 * Splitting on a fixed character count instead would cut mid-sentence and
 * mid-word; paragraphs are the smallest unit that reliably survives being read
 * on its own. A single paragraph longer than the target is broken on sentence
 * boundaries rather than being allowed to become one enormous chunk.
 */
export function chunkDocument(content: string): Chunk[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: { text: string; headings: string[] }[] = [];
  let current = "";
  // Heading trail indexed by markdown level: trail[0] is the current H1.
  const trail: string[] = [];
  let currentHeadings: string[] = [];

  const flush = () => {
    if (current.trim()) {
      pieces.push({ text: current.trim(), headings: currentHeadings });
    }
    current = "";
  };

  for (const paragraph of paragraphs) {
    // A heading closes whatever chunk is being packed. Text under a new
    // heading is about something else, and packing across the boundary makes a
    // chunk whose own heading trail is wrong for half its content.
    const heading = paragraph.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      // Truncate deeper levels: an H2 ends any H3 that was open under it.
      trail.length = level - 1;
      trail[level - 1] = heading[2].trim();
      currentHeadings = trail.filter(Boolean);
      continue;
    }

    if (paragraph.length > TARGET_CHUNK_CHARS) {
      flush();
      for (const sentence of splitLongParagraph(paragraph)) {
        pieces.push({ text: sentence, headings: currentHeadings });
      }
      continue;
    }

    if (current.length + paragraph.length + 2 > TARGET_CHUNK_CHARS) {
      flush();
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return withOverlap(pieces)
    .filter((piece) => piece.text.length >= MIN_CHUNK_CHARS)
    .map((piece, index) => ({
      index,
      content: piece.text,
      headings: piece.headings,
    }));
}

/** Breaks an oversized paragraph on sentence ends, then hard-cuts as a last resort. */
function splitLongParagraph(paragraph: string): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [
    paragraph,
  ];

  const out: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > TARGET_CHUNK_CHARS) {
      if (current.trim()) out.push(current.trim());
      current = "";
      // A "sentence" this long has no internal punctuation to cut on — a table
      // row, a base64 blob, minified text. Hard-cut rather than emit it whole.
      for (let i = 0; i < sentence.length; i += TARGET_CHUNK_CHARS) {
        out.push(sentence.slice(i, i + TARGET_CHUNK_CHARS).trim());
      }
      continue;
    }

    if (current.length + sentence.length > TARGET_CHUNK_CHARS) {
      if (current.trim()) out.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());

  return out;
}

/** Prefixes each piece with the tail of the one before it. */
function withOverlap(
  pieces: { text: string; headings: string[] }[],
): { text: string; headings: string[] }[] {
  return pieces.map((piece, index) => {
    if (index === 0) return piece;
    const previous = pieces[index - 1];
    const tail = previous.text.slice(-CHUNK_OVERLAP_CHARS);
    return { ...piece, text: `${tail}\n\n${piece.text}`.trim() };
  });
}
