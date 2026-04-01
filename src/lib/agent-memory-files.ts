export function buildAgentMemoryPaths(agentSlug: string, date: string) {
  const baseDir = `memory/agents/${agentSlug}`;

  return {
    baseDir,
    memoryFile: `${baseDir}/MEMORY.md`,
    dailyDir: `${baseDir}/daily`,
    dailyFile: `${baseDir}/daily/${date}.md`,
  };
}

type MemoryFrontmatterValue = string | number | boolean;

function formatFrontmatterValue(value: MemoryFrontmatterValue) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  return String(value);
}

function parseFrontmatterValue(value: string): MemoryFrontmatterValue {
  const trimmed = value.trim();

  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsedNumber = Number(trimmed);
    if (!Number.isNaN(parsedNumber)) {
      return parsedNumber;
    }
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

export function serializeMemoryMarkdown(input: {
  frontmatter: Record<string, MemoryFrontmatterValue>;
  body: string;
}) {
  const frontmatterEntries = Object.entries(input.frontmatter).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  const frontmatter = frontmatterEntries
    .map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`)
    .join('\n');

  if (!frontmatter) {
    return input.body;
  }

  return `---\n${frontmatter}\n---\n\n${input.body}`;
}

export function parseMemoryMarkdown(markdown: string) {
  const frontmatter: Record<string, MemoryFrontmatterValue> = {};

  if (markdown.startsWith('---\n') || markdown.startsWith('---\r\n')) {
    const frontmatterStart = markdown.startsWith('---\r\n') ? 5 : 4;
    const closingFenceMatch = markdown.slice(frontmatterStart).match(/\r?\n---\r?\n/);
    if (closingFenceMatch && typeof closingFenceMatch.index === 'number') {
      const closingFenceIndex = frontmatterStart + closingFenceMatch.index;
      const closingFenceLength = closingFenceMatch[0].length;
      const frontmatterBlock = markdown.slice(frontmatterStart, closingFenceIndex);
      const body = markdown.slice(closingFenceIndex + closingFenceLength).replace(/^\r?\n/, '');

      frontmatterBlock.split(/\r?\n/).forEach((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) {
          return;
        }

        const key = line.slice(0, separatorIndex).trim();
        if (!key) {
          return;
        }

        const value = line.slice(separatorIndex + 1);
        frontmatter[key] = parseFrontmatterValue(value);
      });

      return {
        frontmatter,
        body,
      };
    }
  }

  return {
    frontmatter,
    body: markdown,
  };
}
