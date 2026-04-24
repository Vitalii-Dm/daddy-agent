export function highlightCode(code: string, _language?: string): string {
  return code;
}

export function highlightLines(lines: string | string[], _language?: string): string | string[] {
  return lines;
}

export function getLanguageFromFilename(_filename: string): string {
  return 'text';
}
