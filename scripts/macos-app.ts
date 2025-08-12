#!/usr/bin/env bun
// @ts-nocheck

import fs from "node:fs/promises";
import path from "node:path";

async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
}

async function writePlist(appName: string, bundleId: string, execName: string): Promise<string> {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>${execName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.video</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>`;
}

async function main() {
    const [, , binPath, appName = "Convert AV1", icnsPath = "assets/icon.icns", bundleId = "com.example.convertav1"] = process.argv;
    if (!binPath) throw new Error("Usage: bun scripts/macos-app.ts <binary> [App Name] [icon.icns] [bundleId]");

    const binAbs = path.resolve(binPath);
    const execName = path.basename(binAbs);
    const appBundle = `${appName}.app`;
    const contents = path.join(appBundle, "Contents");
    const macos = path.join(contents, "MacOS");
    const resources = path.join(contents, "Resources");
    const plistPath = path.join(contents, "Info.plist");

    await ensureDir(macos);
    await ensureDir(resources);

    // Copy binary
    await fs.copyFile(binAbs, path.join(macos, execName));
    // Copy icns
    await fs.copyFile(path.resolve(icnsPath), path.join(resources, "icon.icns"));
    // Write Info.plist
    const plist = await writePlist(appName, bundleId, execName);
    await fs.writeFile(plistPath, plist);

    console.log(`Created ${appBundle}`);
    console.log(`  Contents/MacOS/${execName}`);
    console.log(`  Contents/Resources/icon.icns`);
    console.log(`  Contents/Info.plist`);
}

await main();


