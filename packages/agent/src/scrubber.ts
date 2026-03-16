export interface ScrubConfig {
  patterns: string[];
  replacement: string;
}

const DEFAULT_PATTERNS = [
  'sk-ant-[a-zA-Z0-9\\-_]+',
  'ANTHROPIC_API_KEY=[^ \\n]+',
  'Bearer [a-zA-Z0-9\\-_.]+',
  'ghp_[a-zA-Z0-9]+',
  'ghs_[a-zA-Z0-9]+',
  'github_pat_[a-zA-Z0-9_]+',
  'xoxb-[a-zA-Z0-9\\-]+',
  'xoxp-[a-zA-Z0-9\\-]+',
];

export class Scrubber {
  private readonly regexes: RegExp[];
  private readonly replacement: string;

  constructor(config?: Partial<ScrubConfig>) {
    const patterns = config?.patterns ?? DEFAULT_PATTERNS;
    this.replacement = config?.replacement ?? '[REDACTED]';
    this.regexes = patterns.map((p) => new RegExp(p, 'g'));
  }

  scrub(text: string): string {
    let result = text;
    for (const regex of this.regexes) {
      regex.lastIndex = 0;
      result = result.replace(regex, this.replacement);
    }
    return result;
  }
}
