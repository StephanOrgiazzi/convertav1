#!/usr/bin/env bun
// @ts-nocheck

import { spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(spawn);

async function runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, { stdio: 'inherit' });
        
        process.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with exit code ${code}`));
            }
        });
        
        process.on('error', (error) => {
            reject(error);
        });
    });
}

async function codesignApp(appPath: string, identity: string = "-"): Promise<void> {
    try {
        console.log(`Signing ${appPath} with identity: ${identity}`);
        
        // Sign the app bundle with ad-hoc signature (no developer certificate required)
        await runCommand('codesign', [
            '--force',
            '--deep',
            '--sign', identity,
            '--options', 'runtime',
            appPath
        ]);
        
        console.log(`Successfully signed ${appPath}`);
        
        // Verify the signature
        console.log('Verifying signature...');
        await runCommand('codesign', ['--verify', '--verbose', appPath]);
        console.log('Signature verification successful');
        
    } catch (error) {
        console.error(`Error signing ${appPath}:`, error.message);
        console.log('Note: Code signing requires macOS. This step will be skipped on other platforms.');
    }
}

async function main() {
    const [, , appPath, identity = "-"] = process.argv;
    
    if (!appPath) {
        console.error("Usage: bun scripts/codesign-macos.ts <app-bundle-path> [identity]");
        console.log("Example: bun scripts/codesign-macos.ts 'Convert AV1 (Intel).app'");
        console.log("Identity defaults to '-' for ad-hoc signing (no certificate required)");
        process.exit(1);
    }
    
    const appAbsPath = path.resolve(appPath);
    
    try {
        await fs.access(appAbsPath);
    } catch {
        console.error(`App bundle not found: ${appAbsPath}`);
        process.exit(1);
    }
    
    await codesignApp(appAbsPath, identity);
}

if (import.meta.main) {
    await main();
}