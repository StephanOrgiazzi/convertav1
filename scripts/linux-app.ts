#!/usr/bin/env bun
// @ts-nocheck

import fs from "node:fs/promises";
import path from "node:path";

async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
}

async function writeDesktopFile(appName: string, execPath: string, iconPath: string): Promise<string> {
    return `[Desktop Entry]
Version=1.0
Type=Application
Name=${appName}
Comment=CLI to convert a video to AV1 at ~50% of original size
Exec=${execPath}
Icon=${iconPath}
Terminal=true
Categories=AudioVideo;Video;
MimeType=video/mp4;video/avi;video/mkv;video/mov;video/wmv;video/flv;video/webm;
Keywords=video;convert;av1;ffmpeg;
`;
}

async function main() {
    const [, , binPath, appName = "Convert AV1", iconPath = "assets/icon.png", installDir = "convert-av1-linux"] = process.argv;
    if (!binPath) throw new Error("Usage: bun scripts/linux-app.ts <binary> [App Name] [icon.png] [install-dir]");

    const binAbs = path.resolve(binPath);
    const execName = path.basename(binAbs);
    const appDir = installDir;
    const binDir = path.join(appDir, "bin");
    const shareDir = path.join(appDir, "share");
    const iconsDir = path.join(shareDir, "icons");
    const applicationsDir = path.join(shareDir, "applications");
    const desktopFileName = `${execName}.desktop`;
    const desktopPath = path.join(applicationsDir, desktopFileName);
    const iconFileName = "icon.png";
    const finalIconPath = path.join(iconsDir, iconFileName);

    await ensureDir(binDir);
    await ensureDir(iconsDir);
    await ensureDir(applicationsDir);

    // Copy binary
    await fs.copyFile(binAbs, path.join(binDir, execName));
    // Make binary executable
    await fs.chmod(path.join(binDir, execName), 0o755);
    
    // Copy icon (convert from SVG to PNG if needed)
    const iconSrc = path.resolve(iconPath);
    await fs.copyFile(iconSrc, finalIconPath);
    
    // Write .desktop file
    const execFullPath = path.join(process.cwd(), binDir, execName);
    const iconFullPath = path.join(process.cwd(), finalIconPath);
    const desktopContent = await writeDesktopFile(appName, execFullPath, iconFullPath);
    await fs.writeFile(desktopPath, desktopContent);
    
    // Create install script
    const installScript = `#!/bin/bash
# Install script for ${appName}
set -e

INSTALL_DIR="/opt/convert-av1"
BIN_LINK="/usr/local/bin/${execName}"
DESKTOP_FILE="/usr/share/applications/${desktopFileName}"

echo "Installing ${appName}..."

# Create install directory
sudo mkdir -p "$INSTALL_DIR"

# Copy files
sudo cp -r bin share "$INSTALL_DIR/"

# Create symlink for binary
sudo ln -sf "$INSTALL_DIR/bin/${execName}" "$BIN_LINK"

# Install desktop file
sudo cp "share/applications/${desktopFileName}" "$DESKTOP_FILE"

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    sudo update-desktop-database /usr/share/applications
fi

echo "${appName} installed successfully!"
echo "You can now run '${execName}' from anywhere or find it in your applications menu."
`;
    
    await fs.writeFile(path.join(appDir, "install.sh"), installScript);
    await fs.chmod(path.join(appDir, "install.sh"), 0o755);
    
    // Create uninstall script
    const uninstallScript = `#!/bin/bash
# Uninstall script for ${appName}
set -e

INSTALL_DIR="/opt/convert-av1"
BIN_LINK="/usr/local/bin/${execName}"
DESKTOP_FILE="/usr/share/applications/${desktopFileName}"

echo "Uninstalling ${appName}..."

# Remove symlink
sudo rm -f "$BIN_LINK"

# Remove desktop file
sudo rm -f "$DESKTOP_FILE"

# Remove install directory
sudo rm -rf "$INSTALL_DIR"

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    sudo update-desktop-database /usr/share/applications
fi

echo "${appName} uninstalled successfully!"
`;
    
    await fs.writeFile(path.join(appDir, "uninstall.sh"), uninstallScript);
    await fs.chmod(path.join(appDir, "uninstall.sh"), 0o755);
    
    // Create README
    const readme = `# ${appName} - Linux Installation

## Quick Install
\`\`\`bash
./install.sh
\`\`\`

## Manual Installation
1. Copy the \`bin\` and \`share\` directories to \`/opt/convert-av1/\`
2. Create a symlink: \`sudo ln -s /opt/convert-av1/bin/${execName} /usr/local/bin/${execName}\`
3. Copy the desktop file: \`sudo cp share/applications/${desktopFileName} /usr/share/applications/\`
4. Update desktop database: \`sudo update-desktop-database /usr/share/applications\`

## Usage
After installation, you can run \`${execName}\` from anywhere in the terminal or find "${appName}" in your applications menu.

## Uninstall
\`\`\`bash
./uninstall.sh
\`\`\`
`;
    
    await fs.writeFile(path.join(appDir, "README.md"), readme);

    console.log(`Created Linux app bundle: ${appDir}`);
    console.log(`  bin/${execName}`);
    console.log(`  share/icons/${iconFileName}`);
    console.log(`  share/applications/${desktopFileName}`);
    console.log(`  install.sh`);
    console.log(`  uninstall.sh`);
    console.log(`  README.md`);
    console.log(`\nTo install: cd ${appDir} && ./install.sh`);
}

await main();