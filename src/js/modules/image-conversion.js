import { encode as encodeAvif } from '@jsquash/avif';
import { init as initAvifEncoder } from '@jsquash/avif/encode.js';
import { decodeHeic, isHeic } from '@su-engineering/heic';
import {
  Gif2Webp,
  runGif2Webp,
  writeFileWithUint8ArrayData
} from '@libwebp-wasm/gif2webp/es/gif2webp.js';

const IMAGE_WIDTHS = [480, 960, 1600, 2400];
const MAX_IMAGE_DIMENSION = IMAGE_WIDTHS.at(-1);
const AVIF_QUALITY = 58;
const ANIMATED_WEBP_QUALITY = 75;
const GIF2WEBP_WASM_URL = new URL('/assets/gif2webp.wasm', window.location.origin).href;
const AVIF_WASM_URL = new URL('/assets/', window.location.origin);
let avifEncoderReady;

async function encodeAvifImage(imageData) {
  avifEncoderReady ??= initAvifEncoder(undefined, {
    locateFile: path => new URL(path, AVIF_WASM_URL).href
  });
  try {
    await avifEncoderReady;
  } catch (error) {
    avifEncoderReady = undefined;
    throw error;
  }
  return encodeAvif(imageData, {
    quality: AVIF_QUALITY,
    qualityAlpha: -1,
    denoiseLevel: 0,
    tileRowsLog2: 0,
    tileColsLog2: 0,
    speed: 6,
    subsample: 1,
    chromaDeltaQ: false,
    sharpness: 0,
    enableSharpYUV: false,
    tune: 0,
    bitDepth: 8,
    lossless: false
  });
}

async function isAnimatedWebp(file) {
  const bytes = new Uint8Array(await file.slice(0, 21).arrayBuffer());
  return bytes.length >= 21
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 16)) === 'WEBPVP8X'
    && (bytes[20] & 0x02) !== 0;
}

async function decodeStillImage(file) {
  const format = await isHeic(file);
  if (format.isHeic) {
    const decoded = await decodeHeic(file, {
      maxDimension: MAX_IMAGE_DIMENSION,
      wasmLoader: async () => (await import('@su-engineering/heic/wasm')).wasmDecoder
    });
    return { image: decoded.image, close: () => decoded.image.close?.() };
  }

  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { image, close: () => image.close() };
}

async function convertStillImageToAvifVariants(file) {
  const decoded = await decodeStillImage(file);
  try {
    const { width, height } = decoded.image;
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
    const maxWidth = Math.max(1, Math.round(width * scale));
    const stem = file.name.replace(/\.[^.]*$/, '') || 'image';
    const variantWidths = [...new Set([...IMAGE_WIDTHS.filter(size => size < maxWidth), maxWidth])];
    const files = [];

    for (const variantWidth of variantWidths) {
      const variantScale = variantWidth / width;
      const canvas = document.createElement('canvas');
      canvas.width = variantWidth;
      canvas.height = Math.max(1, Math.round(height * variantScale));
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('This browser could not prepare the image for conversion.');
      context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);

      const output = await encodeAvifImage(context.getImageData(0, 0, canvas.width, canvas.height));
      if (!output?.byteLength) throw new Error('The image encoder returned an empty file.');
      files.push(new File([output], `${stem}-w${variantWidth}.avif`, {
        type: 'image/avif',
        lastModified: file.lastModified
      }));
    }
    return files;
  } finally {
    decoded.close();
  }
}

async function convertGifToAnimatedWebp(file) {
  const wasm = await Gif2Webp({
    locateFile: path => path.endsWith('.wasm') ? GIF2WEBP_WASM_URL : path
  });
  const inputPath = '/upload.gif';
  const outputPath = '/converted.webp';
  writeFileWithUint8ArrayData(wasm, inputPath, await file.arrayBuffer());

  try {
    try {
      runGif2Webp(wasm, '_main', '-q', String(ANIMATED_WEBP_QUALITY), '-m', '6', '-o', outputPath, inputPath);
    } catch (error) {
      if (error?.status !== 0) throw error;
    }
    const output = wasm.FS.readFile(outputPath);
    if (!output?.byteLength) throw new Error('The animated image encoder returned an empty file.');
    return new File([output.slice()], `${file.name.replace(/\.[^.]*$/, '') || 'image'}.webp`, {
      type: 'image/webp',
      lastModified: file.lastModified
    });
  } finally {
    for (const path of [inputPath, outputPath]) {
      try { wasm.FS.unlink(path); } catch { /* The encoder may not have created its output. */ }
    }
  }
}

export async function convertImageVariantsForUpload(file) {
  if (!(file instanceof File)) {
    throw new Error(`“${file?.name || 'This file'}” is not a supported image.`);
  }

  try {
    if ((file.type === 'image/webp' || /\.webp$/i.test(file.name)) && await isAnimatedWebp(file)) {
      return [new File([file], file.name, { type: 'image/webp', lastModified: file.lastModified })];
    }
    if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
      return [await convertGifToAnimatedWebp(file)];
    }
    return await convertStillImageToAvifVariants(file);
  } catch (error) {
    console.error('Image conversion failed:', { name: file.name, error });
    throw new Error(`Could not convert “${file.name}”. Try a JPEG, PNG, AVIF, WebP, GIF, or HEIC/HEIF image.`);
  }
}

export async function convertImageForUpload(file) {
  const variants = await convertImageVariantsForUpload(file);
  return variants.at(-1);
}
