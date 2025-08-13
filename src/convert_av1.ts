#!/usr/bin/env bun
// @ts-nocheck

import { spawn } from "child_process";
import { readFile, rm, stat, writeFile, chmod } from "fs/promises";
import { createInterface } from "readline";
import { EOL } from "os";
import path from "path";
import { randomUUID } from "crypto";
import chalk from "chalk";
import cliProgress from "cli-progress";

type RunResult = { code: number | null; stdout: string; stderr: string };

// Optional Bun types at runtime (for Bun.file asset embedding)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Bun: any;

// Use static binaries if available
// @ts-expect-error no types
import ffmpegStaticPath from "ffmpeg-static";
// @ts-expect-error no types
import ffprobeStaticPath from "ffprobe-static";

// Hint bundler to embed the static binaries in the compiled executable
try {
    if (typeof Bun !== "undefined" && Bun?.file) {
        // Access at module scope to mark as assets during build
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const __embed_ffmpeg = Bun.file(ffmpegStaticPath as string);
        // Some ffprobe-static packages expose .path, others export the path string directly
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const __embed_ffprobe = Bun.file((ffprobeStaticPath?.path as string) || (ffprobeStaticPath as unknown as string));
    }
} catch { }

async function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<RunResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: any) => (stdout += d.toString()))
        child.stderr.on("data", (d: any) => (stderr += d.toString()))
        child.on("close", (code: number | null) => resolve({ code, stdout, stderr }));
    });
}

function formatTimeHMS(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function promptForPath(): Promise<string> {
    console.log(chalk.cyan("\n🎬 ConvertAV1 - Video Converter"));
    console.log(chalk.gray("═".repeat(40)));
    console.log(chalk.yellow("📁 Please drag and drop your video file here and press Enter:"));
    process.stdout.write(chalk.green("➤ "));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise((resolve) => rl.question("", resolve));
    rl.close();
    return answer.trim().replace(/^\"|\"|$/g, "");
}

async function ensureFileExists(filePath: string): Promise<void> {
    try {
        await stat(filePath);
    } catch {
        throw new Error(chalk.red(`❌ Error: File not found at '${filePath}'`));
    }
}

async function probeWithFfmpeg(inputPath: string): Promise<string> {
    const result = await runCommand(await getFfmpegPath(), ["-hide_banner", "-i", inputPath]);
    // ffmpeg prints probe to stderr
    return result.stderr || result.stdout;
}

function parseDurationSeconds(probeText: string): number {
    // Matches: Duration: HH:MM:SS.xx or Durée: HH:MM:SS.xx
    const re = /(?:Duration|Durée):\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{2}))?/;
    const m = probeText.match(re);
    if (!m) return 0;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const cs = m[4] ? Number(m[4]) : 0; // centiseconds
    let total = hh * 3600 + mm * 60 + ss;
    total += cs / 100;
    return total;
}

function findAttachedPicMapIndex(probeText: string): string | null {
    // Example line: Stream #0:1: Video: mjpeg ... (attached pic)
    // Some builds add brackets like #0:1[0x2]
    const lines = probeText.split(/\r?\n/);
    for (const line of lines) {
        if (line.includes("attached pic")) {
            const m = line.match(/Stream\s+#(\d+:\d+)/);
            if (m) return m[1];
        }
    }
    return null;
}

async function extractOrGenerateThumbnail(inputPath: string, tempThumb: string, probeText: string): Promise<void> {
    const mapIdx = findAttachedPicMapIndex(probeText);
    if (mapIdx) {
        process.stdout.write(`Embedded thumbnail found (stream ${mapIdx}). Extracting...` + EOL);
        const r = await runCommand(await getFfmpegPath(), ["-y", "-hide_banner", "-i", inputPath, "-map", mapIdx, "-c", "copy", tempThumb]);
        if (r.code !== 0) {
            process.stdout.write("Error extracting thumbnail, will generate a new one." + EOL);
            const r2 = await runCommand(await getFfmpegPath(), ["-y", "-hide_banner", "-i", inputPath, "-ss", "00:00:01", "-vframes", "1", tempThumb]);
            if (r2.code !== 0) throw new Error("Failed to extract or generate thumbnail");
        }
    } else {
        process.stdout.write("No embedded thumbnail found. Generating from the first second..." + EOL);
        const r = await runCommand(await getFfmpegPath(), ["-y", "-hide_banner", "-i", inputPath, "-ss", "00:00:01", "-vframes", "1", tempThumb]);
        if (r.code !== 0) throw new Error("Failed to generate thumbnail");
    }
}

async function getAudioBitrateInfo(inputPath: string, probeText: string): Promise<{ totalKbps: number; streamCount: number }> {
    try {
        const r = await runCommand(await getFfprobePath(), [
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=index,bit_rate",
            "-of", "json",
            inputPath,
        ]);
        if (r.code === 0 && r.stdout) {
            const json = JSON.parse(r.stdout) as { streams?: Array<{ index: number; bit_rate?: string | number }> };
            if (json.streams && json.streams.length) {
                let kbps = 0;
                let cnt = 0;
                for (const s of json.streams) {
                    cnt += 1;
                    if (s.bit_rate != null) {
                        const br = typeof s.bit_rate === "string" ? Number(s.bit_rate) : s.bit_rate;
                        if (Number.isFinite(br)) kbps += Math.round(br / 1000);
                    }
                }
                if (kbps === 0 && cnt > 0) {
                    // assume 192 kbps per stream when missing
                    kbps = 192 * cnt;
                }
                return { totalKbps: kbps, streamCount: cnt };
            }
        }
    } catch { }

    // Fallbacks
    const audioCount = (probeText.match(/Audio:/g) || []).length;
    const totalKbps = audioCount > 0 ? 192 * audioCount : 0;
    return { totalKbps, streamCount: audioCount };
}

async function detectNvenc(): Promise<boolean> {
    const r = await runCommand(await getFfmpegPath(), ["-hide_banner", "-encoders"]);
    const text = (r.stdout + "\n" + r.stderr).toLowerCase();
    return text.includes("av1_nvenc");
}

function tokenizeOptions(options: string): string[] {
    // split by spaces while keeping tokens intact
    return options.trim().split(/\s+/).filter(Boolean);
}

async function encodeWithProgress(args: string[], totalDurationSeconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegSpawnPathCached, args, { stdio: ["ignore", "pipe", "pipe"] });

        let progressBar: any = null;
        let lastPercent = -1;
        let start = Date.now();

        // Create progress bar if we have duration info
        if (totalDurationSeconds > 0) {
            progressBar = new cliProgress.SingleBar({
                format: chalk.cyan('🔄 Converting') + ' |' + chalk.green('{bar}') + '| {percentage}% | ETA: {eta}s | Speed: {speed}x',
                barCompleteChar: '█',
                barIncompleteChar: '░',
                hideCursor: true
            });
            progressBar.start(100, 0, {
                speed: "0.0",
                eta: "calculating..."
            });
        }

        const onProgressLine = (line: string) => {
            // When using -progress pipe:1, look for out_time_ms= and progress=
            if (totalDurationSeconds > 0) {
                const m = line.match(/^out_time_ms=(\d+)/);
                if (m) {
                    const ms = Number(m[1]);
                    const seconds = ms / 1_000_000;
                    const percent = Math.max(0, Math.min(100, (seconds / totalDurationSeconds) * 100));
                    if (percent - lastPercent >= 0.5 || percent === 100) {
                        lastPercent = percent;
                        const elapsedSec = (Date.now() - start) / 1000;
                        const speed = seconds / elapsedSec;
                        const remainingPercent = Math.max(0.001, 100 - percent);
                        const etaSec = elapsedSec * (remainingPercent / Math.max(0.001, percent));
                        
                        if (progressBar) {
                            progressBar.update(percent, {
                                speed: speed.toFixed(1),
                                eta: Math.round(etaSec)
                            });
                        } else {
                            const status = `${percent.toFixed(2)}% complete - ETA: ${formatTimeHMS(etaSec)}`;
                            process.stdout.write(`\r${status.padEnd(60, " ")}`);
                        }
                    }
                }
            }
        };

        const stdoutBuf: string[] = [];
        const stderrBuf: string[] = [];

        const handleChunk = (chunk: Buffer, isStdout: boolean) => {
            const str = (chunk as any).toString();
            // progress key=value lines are on stdout
            if (isStdout) {
                str.split(/\r?\n/).forEach(onProgressLine);
            }
            (isStdout ? stdoutBuf : stderrBuf).push(str);
        };

        child.stdout.on("data", (d) => handleChunk(d as Buffer, true));
        child.stderr.on("data", (d) => handleChunk(d as Buffer, false));

        child.on("close", (code) => {
            if (progressBar) {
                progressBar.stop();
            } else {
                process.stdout.write("\n");
            }
            if (code === 0) return resolve(0);
            const stderr = stderrBuf.join("");
            const stdout = stdoutBuf.join("");
            const lastLines = (stderr + "\n" + stdout).split(/\r?\n/).slice(-20).join("\n");
            const err = new Error(`FFmpeg failed with exit code ${code}.\n--- Last 20 lines ---\n${lastLines}`);
            reject(err);
        });
    });
}

// --- Bundled ffmpeg/ffprobe handling ---
let ffmpegSpawnPathCached = "ffmpeg";
let ffprobeSpawnPathCached = "ffprobe";

async function extractEmbeddedBinaryToTemp(assetPath: string, outBase: string): Promise<string> {
    const tmpDir = process.env.TEMP || process.env.TMPDIR || process.cwd();
    const ext = path.extname(assetPath) || (process.platform === "win32" ? ".exe" : "");
    const outPath = path.join(tmpDir, `${outBase}-${crypto.randomUUID()}${ext}`);
    try {
        if (typeof Bun !== "undefined" && Bun?.file) {
            const file = Bun.file(assetPath);
            const ab = await file.arrayBuffer();
            await writeFile(outPath, Buffer.from(ab));
        } else {
            const buf = await readFile(assetPath);
            await writeFile(outPath, buf);
        }
        if (process.platform !== "win32") {
            await chmod(outPath, 0o755);
        }
        return outPath;
    } catch (e) {
        throw new Error(`Failed to prepare embedded binary '${assetPath}': ${String(e)}`);
    }
}

async function getFfmpegPath(): Promise<string> {
    if (ffmpegSpawnPathCached && ffmpegSpawnPathCached !== "ffmpeg") return ffmpegSpawnPathCached;
    const assetPath = (ffmpegStaticPath as string | undefined) || "";
    if (assetPath) {
        ffmpegSpawnPathCached = await extractEmbeddedBinaryToTemp(assetPath, "ffmpeg");
        return ffmpegSpawnPathCached;
    }
    ffmpegSpawnPathCached = "ffmpeg";
    return ffmpegSpawnPathCached;
}

async function getFfprobePath(): Promise<string> {
    if (ffprobeSpawnPathCached && ffprobeSpawnPathCached !== "ffprobe") return ffprobeSpawnPathCached;
    const assetPath = (ffprobeStaticPath?.path as string | undefined) || (ffprobeStaticPath as string | undefined) || "";
    if (assetPath) {
        ffprobeSpawnPathCached = await extractEmbeddedBinaryToTemp(assetPath, "ffprobe");
        return ffprobeSpawnPathCached;
    }
    ffprobeSpawnPathCached = "ffprobe";
    return ffprobeSpawnPathCached;
}

async function main() {
    try {
        const argPath = process.argv[2];
        const inputPath = argPath ? argPath : await promptForPath();
        await ensureFileExists(inputPath);

        const dir = path.dirname(inputPath);
        const fileNameNoExt = path.parse(inputPath).name;
        const outputPath = path.join(dir, `${fileNameNoExt}_av1.mp4`);
        const tempThumb = path.join(process.env.TEMP || dir, `video_thumbnail_${randomUUID()}.jpg`);

        console.log(chalk.blue("\n🔍 Probing video file..."));
        const probeText = await probeWithFfmpeg(inputPath);

        let totalDurationSeconds = parseDurationSeconds(probeText);
        if (totalDurationSeconds > 0) {
            console.log(chalk.green(`⏱️  Video duration found: ${chalk.bold(formatTimeHMS(totalDurationSeconds))}`));
        } else {
            console.log(chalk.yellow("⚠️  Warning: Could not determine video duration. ETA will not be available."));
        }

        // Extract or generate thumbnail
        await extractOrGenerateThumbnail(inputPath, tempThumb, probeText);
        // Verify thumbnail
        try {
            const buf = await readFile(tempThumb);
            if (!buf || buf.length === 0) throw new Error("Thumbnail file is empty");
        } catch {
            throw new Error("Thumbnail file is missing or empty. Cannot proceed.");
        }

        // Size targeting (~50%)
        const st = await stat(inputPath);
        const inputSizeBytes = st.size;
        let origTotalBitrateKbps = 0;
        if (totalDurationSeconds > 0) {
            origTotalBitrateKbps = Math.round((inputSizeBytes * 8) / totalDurationSeconds / 1000);
        }

        const { totalKbps: audioTotalBitrateKbps, streamCount: audioStreamCount } = await getAudioBitrateInfo(inputPath, probeText);

        let targetVideoBitrateKbps = 0;
        if (origTotalBitrateKbps > 0) {
            const targetTotalBitrateKbps = Math.round(origTotalBitrateKbps * 0.5);
            targetVideoBitrateKbps = targetTotalBitrateKbps - audioTotalBitrateKbps;
            if (targetVideoBitrateKbps < 300) targetVideoBitrateKbps = 300;
        }

        if (origTotalBitrateKbps > 0) {
            console.log(chalk.cyan("\n📊 File Analysis:"));
            console.log(chalk.gray("─".repeat(30)));
            console.log(`📁 Original size: ${chalk.bold.white((inputSizeBytes / (1024 * 1024)).toFixed(2))} ${chalk.gray('MB')}`);
            console.log(`📈 Total bitrate: ${chalk.bold.cyan(origTotalBitrateKbps)} ${chalk.gray('kbps')}`);
            console.log(`🔊 Audio bitrate: ${chalk.bold.magenta(audioTotalBitrateKbps)} ${chalk.gray(`kbps (${audioStreamCount} stream(s))`)}`);
            console.log(`🎯 Target video bitrate: ${chalk.bold.green(targetVideoBitrateKbps)} ${chalk.gray('kbps (~50% size)')}`);
        } else {
            console.log(chalk.yellow("⚠️  Could not compute original bitrate; will use quality-based defaults."));
        }

        // Choose encoder
        const usingNvenc = await detectNvenc();
        let videoEncoder = "libsvtav1";
        let videoEncoderOptions = "-crf 30 -b:v 0 -preset 8 -tune 0";
        if (usingNvenc) {
            console.log(chalk.green("\n🚀 GPU detected! Using NVIDIA NVENC (av1_nvenc)"));
            videoEncoder = "av1_nvenc";
            videoEncoderOptions = "-rc vbr -cq 28 -b:v 0 -preset p6 -tune hq -spatial-aq 1 -aq-strength 8";
        } else {
            console.log(chalk.blue("\n💻 Using CPU encoder (libsvtav1)"));
        }
        if (targetVideoBitrateKbps > 0) {
            const b = `${targetVideoBitrateKbps}k`;
            const max = `${Math.round(targetVideoBitrateKbps * 1.5)}k`;
            const buf = `${Math.round(targetVideoBitrateKbps * 3.0)}k`;
            if (usingNvenc) {
                videoEncoderOptions = `-rc vbr -b:v:0 ${b} -maxrate:v:0 ${max} -bufsize:v:0 ${buf} -preset p6 -tune hq -spatial-aq 1 -aq-strength 8`;
            } else {
                videoEncoderOptions = `-b:v:0 ${b} -maxrate:v:0 ${max} -bufsize:v:0 ${buf} -preset 8 -tune 0`;
            }
        }

        // Build ffmpeg args
        ffmpegSpawnPathCached = await getFfmpegPath();
        const ffArgs = [
            "-hide_banner",
            "-y",
            "-i", inputPath,
            "-i", tempThumb,
            "-map", "0",
            "-map", "1",
            "-c:v:0", videoEncoder,
            ...tokenizeOptions(videoEncoderOptions),
            "-c:a", "copy",
            "-c:s", "copy",
            "-c:v:1", "copy",
            "-disposition:v:1", "attached_pic",
            "-movflags", "+faststart",
            "-pix_fmt", "yuv420p",
            "-progress", "pipe:1",
            outputPath,
        ];

        console.log(chalk.cyan("\n🎬 Starting AV1 conversion targeting ~50% size..."));
        console.log(chalk.gray("═".repeat(50)));
        const start = Date.now();
        try {
            await encodeWithProgress(ffArgs, totalDurationSeconds);
            const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
            console.log(chalk.green("\n✅ Conversion completed successfully!"));
            console.log(chalk.gray("─".repeat(40)));
            console.log(`📁 Output file: ${chalk.bold.white(path.basename(outputPath))}`);
            console.log(`📍 Location: ${chalk.gray(path.dirname(outputPath))}`);
            console.log(`⏱️  Time taken: ${chalk.bold.cyan(elapsed)} minutes`);
            try {
                const outStat = await stat(outputPath);
                const outputSizeMB = (outStat.size / (1024 * 1024)).toFixed(2);
                const compressionRatio = ((1 - outStat.size / inputSizeBytes) * 100).toFixed(1);
                console.log(`📊 Output size: ${chalk.bold.green(outputSizeMB)} MB`);
                console.log(`🗜️  Compression: ${chalk.bold.magenta(compressionRatio)}% smaller`);
            } catch { }
        } catch (err: any) {
            console.error(chalk.red("\n❌ Conversion failed!"));
            console.error(chalk.red(err?.message ?? String(err)));
            process.exitCode = 1;
        } finally {
            // cleanup
            try { await rm(tempThumb, { force: true }); } catch { }
        }
    } catch (err: any) {
        process.stderr.write((err?.message ?? String(err)) + EOL);
        process.exitCode = 1;
    }
}

main();


