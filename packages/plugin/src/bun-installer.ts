import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface BunInstallerOptions {
  cacheDir?: string;
  version?: string;
}

/**
 * Bun installer - automatically downloads bun to local cache
 * Reference: https://github.com/oven-sh/setup-bun
 */
export class BunInstaller {
  private cacheDir: string;
  private version: string;

  constructor(options: BunInstallerOptions = {}) {
    this.cacheDir = options.cacheDir || join(process.env.HOME || '~', '.cache', 'synax');
    this.version = options.version || '1.3.9';
  }

  /**
   * Ensure bun is available, returns bun path
   */
  async ensureBun(): Promise<string> {
    // 1. Check system bun
    const systemBun = Bun.which('bun');
    if (systemBun) {
      return systemBun;
    }

    // 2. Check cached bun
    const cachedBun = this.getCachedBunPath();
    if (existsSync(cachedBun)) {
      return cachedBun;
    }

    // 3. Download bun
    return this.downloadBun();
  }

  /**
   * Get cached bun path
   */
  private getCachedBunPath(): string {
    const { platform, arch } = this.getPlatformArch();
    const ext = platform === 'windows' ? 'bun.exe' : 'bun';
    return join(this.cacheDir, 'bun', this.version, platform, arch, ext);
  }

  /**
   * Download bun
   */
  private async downloadBun(): Promise<string> {
    const { platform, arch } = this.getPlatformArch();
    const targetDir = join(this.cacheDir, 'bun', this.version, platform, arch);
    const bunPath = join(targetDir, platform === 'windows' ? 'bun.exe' : 'bun');

    // Create directory
    mkdirSync(targetDir, { recursive: true });

    // Build download URL
    const url = this.getDownloadUrl(platform, arch);
    console.log(`Downloading bun from ${url}`);

    // Download
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download bun: ${response.status} ${response.statusText}`);
    }

    // Handle based on platform
    if (platform === 'windows') {
      // Windows uses zip format
      const buffer = await response.arrayBuffer();
      await this.extractZip(buffer, targetDir);
    } else {
      // macOS/Linux uses binary or tar.gz
      const buffer = await response.arrayBuffer();
      await this.extractBinary(buffer, bunPath);
    }

    // Set executable permission
    if (platform !== 'windows') {
      chmodSync(bunPath, 0o755);
    }

    return bunPath;
  }

  /**
   * Get download URL
   */
  private getDownloadUrl(platform: string, arch: string): string {
    // GitHub releases format
    const platformMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      windows: 'windows',
    };
    
    const archMap: Record<string, string> = {
      x64: 'x64',
      arm64: 'aarch64',
    };

    const p = platformMap[platform] || platform;
    const a = archMap[arch] || arch;
    const ext = platform === 'windows' ? '.zip' : '';

    return `https://github.com/oven-sh/bun/releases/download/bun-v${this.version}/bun-${p}-${a}${ext}`;
  }

  /**
   * Get platform and architecture
   */
  private getPlatformArch(): { platform: string; arch: string } {
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return { platform, arch };
  }

  /**
   * Extract zip (Windows)
   */
  private async extractZip(buffer: ArrayBuffer, targetDir: string): Promise<void> {
    // Use Bun's built-in zip support
    const data = new Uint8Array(buffer);
    // Simplified implementation: use unzip command or third-party library
    // Write to temp file first, then extract using system command
    const tempFile = join(targetDir, 'temp.zip');
    writeFileSync(tempFile, data);
    
    const proc = Bun.spawn(['unzip', '-o', tempFile, '-d', targetDir], {
      cwd: targetDir,
    });
    await proc.exited;
    
    // Clean up temp file
    unlinkSync(tempFile);
  }

  /**
   * Extract binary (macOS/Linux)
   */
  private async extractBinary(buffer: ArrayBuffer, targetPath: string): Promise<void> {
    // Bun releases may be pure binary or gzip
    const data = new Uint8Array(buffer);
    
    // Check if gzip
    if (data[0] === 0x1f && data[1] === 0x8b) {
      // Is gzip, decompress
      const decompressed = Bun.gunzipSync(data);
      writeFileSync(targetPath, decompressed);
    } else {
      // Direct binary
      writeFileSync(targetPath, data);
    }
  }
}
