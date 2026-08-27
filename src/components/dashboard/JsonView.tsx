import { Fragment } from "react";

/**
 * Syntax-highlighted JSON.
 *
 * The previous implementation built an HTML string with regex replacements and
 * injected it via dangerouslySetInnerHTML. These payloads come from agent
 * output and upstream systems, so a value containing markup would have executed
 * in the reviewer's session — on the screen whose entire purpose is approving
 * high-value actions. Tokenizing into React elements escapes by construction.
 */
export default function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "null";

  return (
    <>
      {text.split("\n").map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {renderLine(line)}
          {"\n"}
        </Fragment>
      ))}
    </>
  );
}

const LINE_PATTERN = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g;

function renderLine(line: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  LINE_PATTERN.lastIndex = 0;

  while ((match = LINE_PATTERN.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    const [raw, key, str, num, literal] = match;
    const className = key
      ? "text-cyan-300"
      : str
        ? "text-emerald-300"
        : num
          ? "text-amber-300"
          : literal
            ? "text-purple-300"
            : undefined;

    parts.push(
      <span key={`${match.index}-${raw}`} className={className}>
        {raw}
      </span>,
    );
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts;
}
