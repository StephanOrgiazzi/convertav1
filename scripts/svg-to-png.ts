#!/usr/bin/env bun
// @ts-nocheck

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

async function convertSvgToPng(svgPath: string, pngPath: string, size: number = 256) {
    try {
        const svgBuffer = await fs.readFile(svgPath);
        
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(pngPath);
            
        console.log(`Converted ${svgPath} to ${pngPath} (${size}x${size})`);
    } catch (error) {
        console.error(`Error converting SVG to PNG: ${error}`);
        throw error;
    }
}

async function main() {
    const [, , svgPath, pngPath, sizeStr] = process.argv;
    
    if (!svgPath || !pngPath) {
        console.error("Usage: bun scripts/svg-to-png.ts <input.svg> <output.png> [size]");
        process.exit(1);
    }
    
    const size = sizeStr ? parseInt(sizeStr, 10) : 256;
    
    if (isNaN(size) || size <= 0) {
        console.error("Size must be a positive number");
        process.exit(1);
    }
    
    // Ensure output directory exists
    const outputDir = path.dirname(pngPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    await convertSvgToPng(svgPath, pngPath, size);
}

await main();