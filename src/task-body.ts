export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n*/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  return {
    frontmatter: match[1] ?? "",
    body: content.slice(match[0].length),
  };
}

export function joinFrontmatter(frontmatter: string | null, body: string): string {
  const normalizedBody = body.trimEnd();
  if (frontmatter === null) {
    return `${normalizedBody}\n`;
  }
  return `---\n${frontmatter.trimEnd()}\n---\n\n${normalizedBody}\n`;
}

export function appendCapture(body: string, capture: string, sourceLink: string, date: Date): string {
  const heading = formatCaptureHeading(sourceLink, date);
  const trimmedCapture = capture.trim();
  const normalizedBody = body.trimEnd();
  const capturesHeading = "## Captures";
  const entry = `${heading}\n\n${trimmedCapture}`;

  if (normalizedBody.includes(capturesHeading)) {
    return `${normalizedBody}\n\n${entry}\n`;
  }

  const separator = normalizedBody.length > 0 ? "\n\n" : "";
  return `${normalizedBody}${separator}${capturesHeading}\n\n${entry}\n`;
}

export function formatCaptureHeading(sourceLink: string, date: Date): string {
  return `### ${formatLocalDateTime(date)} from ${sourceLink}`;
}

function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

