#!/usr/bin/env bun
// @ts-nocheck

import fs from "node:fs/promises";
import path from "node:path";

const sharp = (await import("sharp")).default;
const png2icons = await import("png2icons");

async function ensureDirFor(filePath: string) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
}

async function main() {
    const [, , inputSvg = "assets/icon.svg", outIcns = "assets/icon.icns"] = process.argv;

    const svg = await fs.readFile(inputSvg);
    // macOS prefers 1024x1024 source for best scaling
    const png1024 = await sharp(svg).resize(1024, 1024, { fit: "contain" }).png().toBuffer();

    const icnsBuf = png2icons.createICNS(png1024, png2icons.BILINEAR, 0, false);
    if (!icnsBuf) {
        throw new Error("Failed to create ICNS from PNG");
    }

    await ensureDirFor(outIcns);
    await fs.writeFile(outIcns, icnsBuf);
    console.log(`Generated ${outIcns}`);
}

await main();


