#!/usr/bin/env bun
// @ts-nocheck

import { spawn } from "node:child_process";
import path from "node:path";

function runPowershell(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
            stdio: "inherit"
        });
        p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`PowerShell exited ${code}`))));
    });
}

async function main() {
    const [, , exe = "convert-av1-win.exe", icon = "assets/icon.ico", shortcutName = "Convert AV1.lnk"] = process.argv;
    const exeAbs = path.resolve(exe);
    const iconAbs = path.resolve(icon);
    const shortcutPath = path.join(process.env.USERPROFILE || process.cwd(), "Desktop", shortcutName);

    const ps = `
  $WshShell = New-Object -ComObject WScript.Shell;
  $Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}');
  $Shortcut.TargetPath = '${exeAbs.replace(/'/g, "''")}';
  $Shortcut.WorkingDirectory = '${path.dirname(exeAbs).replace(/'/g, "''")}';
  $Shortcut.IconLocation = '${iconAbs.replace(/'/g, "''")}';
  $Shortcut.Save();
  `;

    await runPowershell(ps);
    console.log(`Created desktop shortcut: ${shortcutPath}`);
}

await main();


