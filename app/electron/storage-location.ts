import path from 'node:path';

export type Distribution = 'installed' | 'portable' | 'development' | 'test';
export function storageLocation(input: {
  packaged: boolean; distribution?: string; exe: string; localAppData: string;
  developmentRoot: string; testMode?: boolean; testData?: string;
}): {distribution: Distribution; dataDir: string} {
  if (input.testMode && input.testData) return {distribution: 'test', dataDir: path.resolve(input.testData)};
  if (!input.packaged) return {distribution: 'development', dataDir: path.resolve(input.developmentRoot, '.local-data')};
  if (input.distribution === 'installed') return {distribution: 'installed', dataDir: path.resolve(input.localAppData, '随手记')};
  return {distribution: 'portable', dataDir: path.join(path.dirname(input.exe), '我的数据')};
}
