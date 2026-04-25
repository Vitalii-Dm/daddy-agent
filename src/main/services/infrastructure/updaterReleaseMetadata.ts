const REPO_OWNER = 'Vitalii-Dm';
const REPO_NAME = 'daddy-agent';

export function buildReleaseAssetBase(version: string): string {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}`;
}

export function getExpectedReleaseAssetUrl(
  version: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string | null {
  const base = buildReleaseAssetBase(version);

  switch (platform) {
    case 'darwin':
      return arch === 'arm64'
        ? `${base}/Daddy.Agent-${version}-arm64.dmg`
        : `${base}/Daddy.Agent-${version}.dmg`;
    case 'win32':
      return `${base}/Daddy.Agent.Setup.${version}.exe`;
    case 'linux':
      return `${base}/Daddy.Agent-${version}.AppImage`;
    default:
      return null;
  }
}

export function getLatestMacMetadataUrl(version: string): string {
  return `${buildReleaseAssetBase(version)}/latest-mac.yml`;
}

export function getExpectedLatestMacArtifacts(
  version: string,
  arch: Extract<NodeJS.Architecture, 'arm64' | 'x64'>
): readonly string[] {
  return arch === 'arm64'
    ? [`Daddy.Agent-${version}-arm64-mac.zip`, `Daddy.Agent-${version}-arm64.dmg`]
    : [`Daddy.Agent-${version}-mac.zip`, `Daddy.Agent-${version}.dmg`];
}

function stripYamlScalar(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseReleaseMetadataAssetNames(metadataText: string): Set<string> {
  const assets = new Set<string>();

  for (const rawLine of metadataText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^(?:-\s+)?(url|path):\s+(.+)$/u.exec(line);
    if (!match) {
      continue;
    }

    assets.add(stripYamlScalar(match[2]));
  }

  return assets;
}

export function isLatestMacMetadataCompatible(
  metadataText: string,
  version: string,
  arch: Extract<NodeJS.Architecture, 'arm64' | 'x64'>
): boolean {
  const assets = parseReleaseMetadataAssetNames(metadataText);
  return getExpectedLatestMacArtifacts(version, arch).every((asset) => assets.has(asset));
}
