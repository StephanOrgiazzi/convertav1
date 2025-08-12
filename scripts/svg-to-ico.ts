#!/usr/bin/env bun
// @ts-nocheck

import fs from "node:fs/promises";
import path from "node:path";

const sharp = (await import("sharp")).default;
const toIco = (await import("to-ico")).default;

async function ensureDirFor(filePath: string) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
}

async function svgToPngBuffer(svgPath: string, size: number): Promise<Buffer> {
    const svg = await fs.readFile(svgPath);
    return await sharp(svg).resize(size, size, { fit: "contain" }).png().toBuffer();
}

async function main() {
    const [, , inputSvg = "assets/icon.svg", outIco = "assets/icon.ico"] = process.argv;
    const outPng256 = "assets/icon-256.png";

    // Avoid 256x256 PNG-compressed layer for older Windows compatibility
    const sizes = [16, 24, 32, 48, 64, 128];
    const pngBuffers: Buffer[] = [];

    for (const s of sizes) {
        const buf = await svgToPngBuffer(inputSvg, s);
        pngBuffers.push(buf);
        // also export a 256px PNG for marketing/assets when we hit the largest size
        if (s === sizes[sizes.length - 1]) {
            const svgBuf = await fs.readFile(inputSvg);
            const png256 = await sharp(svgBuf).resize(256, 256, { fit: "contain" }).png().toBuffer();
            await ensureDirFor(outPng256);
            await fs.writeFile(outPng256, png256);
        }
    }

    const icoBuffer = await toIco(pngBuffers);
    await ensureDirFor(outIco);
    await fs.writeFile(outIco, icoBuffer);
    console.log(`Generated ${outIco} and ${outPng256}`);
}

await main();


