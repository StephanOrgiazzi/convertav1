#!/usr/bin/env bun
// @ts-nocheck

// Sets the Windows PE icon on an existing .exe using rcedit (Windows-only)
import fs from "node:fs/promises";
import path from "node:path";
const rcedit = (await import("rcedit")).default ?? (await import("rcedit"));

async function main() {
    const [, , exePath = "convert-av1-win.exe", icoPath = "assets/icon.ico"] = process.argv;
    const outPath = exePath.replace(/\.exe$/i, "-icon.exe");
    await fs.copyFile(path.resolve(exePath), path.resolve(outPath));
    await rcedit(outPath, { icon: icoPath });
    console.log(`Set icon '${icoPath}' on '${outPath}'`);
}

await main();


