import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import sharp from 'sharp';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_VIDEO_SIZE = { width: 640, height: 360 };

app.use(cors({ origin: '*', credentials: false }));
app.use((req: Request, res: Response, next: NextFunction) => {
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const MOSAIC_GRIDS = [4, 8, 16, 32, 64] as const;

async function getImageMetadata(buffer: Buffer): Promise<{
  width: number;
  height: number;
  hasAlpha: boolean;
} | null> {
  try {
    const meta = await sharp(buffer).metadata();
    return {
      width: meta.width || 100,
      height: meta.height || 100,
      hasAlpha: meta.channels === 4
    };
  } catch {
    return null;
  }
}

function getVideoDimensionsFromBuffer(buffer: Buffer): { width: number; height: number } {
  try {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const len = buffer.length;
    let i = 0;
    while (i < len - 8) {
      const size = view.getUint32(i, false);
      const type = buffer.toString('ascii', i + 4, i + 8);
      if (type === 'tkhd' && size >= 84) {
        const version = view.getUint8(i + 8);
        const off = version === 1 ? 84 : 76;
        const w = view.getUint32(i + off, false) / 65536;
        const h = view.getUint32(i + off + 4, false) / 65536;
        if (w > 0 && h > 0 && w < 10000 && h < 10000) {
          return { width: Math.round(w), height: Math.round(h) };
        }
      }
      i += size > 1 ? size : 8;
    }
  } catch (_) {}
  return DEFAULT_VIDEO_SIZE;
}

async function createMosaicMockup(
  buffer: Buffer,
  width: number,
  height: number,
  grid: number,
  hasAlpha: boolean,
  label?: string
): Promise<Buffer> {
  const minDim = Math.min(width, height);
  const minBlockSize = 8;
  const maxGridForBlockSize = Math.max(2, Math.floor(minDim / minBlockSize));
  const clampedGrid = Math.min(Math.max(grid, 2), minDim, maxGridForBlockSize);
  const small = await sharp(buffer)
    .resize(clampedGrid, clampedGrid, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = small.info.channels ?? (hasAlpha ? 4 : 3);
  let mosaic = await sharp(small.data, {
    raw: {
      width: clampedGrid,
      height: clampedGrid,
      channels
    }
  })
    .resize(width, height, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  if (label) {
    const safeLabel = String(label).replace(/[<>&"']/g, '');
    const fontSize = Math.min(24, Math.floor(Math.min(width, height) / 12));
    const textSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="50%" y="50%" text-anchor="middle" dy=".35em" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#333">${safeLabel}</text>
      </svg>`;
    const textBuf = await sharp(Buffer.from(textSvg)).png().toBuffer();
    mosaic = await sharp(mosaic)
      .composite([{ input: textBuf, blend: 'over' }])
      .png()
      .toBuffer();
  }
  return mosaic;
}

function createSvgPlaceholder(width: number, height: number, label?: string, solid = false): Promise<Buffer> {
  const safeLabel = label ? String(label).replace(/[<>&"']/g, '') : '';
  const text = safeLabel ? `${safeLabel} ${width}×${height}` : `${width}×${height}`;
  const fontWeight = solid ? 'font-weight="700"' : '';
  const fill = solid ? '#333' : '#666';
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e0e0e0"/>
      <text x="50%" y="50%" text-anchor="middle" dy=".35em" font-family="sans-serif" font-size="24" ${fontWeight} fill="${fill}">${text}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function handleFetch(req: Request, res: Response, showLabel: boolean) {
  let url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).send('Missing url parameter');
    return;
  }

  if (url.startsWith('/')) {
    const base = (req.query.base as string) || process.env.BASE_URL;
    if (!base) {
      res.status(400).send('Relative URL requires base parameter or BASE_URL env');
      return;
    }
    url = new URL(url, base).href;
  }

  const gridParam = req.query.grid as string | undefined;
  const grid = gridParam && MOSAIC_GRIDS.includes(Number(gridParam) as (typeof MOSAIC_GRIDS)[number])
    ? Number(gridParam)
    : 16;

  let label: string | undefined;
  if (showLabel) {
    try {
      label = new URL(url).pathname.split('/').filter(Boolean).pop() || undefined;
    } catch {
      label = undefined;
    }
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ImageMockupProxy/1.0' }
    });

    if (!response.ok) {
      const { width, height } = DEFAULT_VIDEO_SIZE;
      const mockup = await createSvgPlaceholder(width, height, label, showLabel);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(mockup);
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());

    if (/\.(svg|ico)(\?|$)/i.test(url)) {
      const ct = contentType.split(';')[0].trim() || (/\.ico(\?|$)/i.test(url) ? 'image/x-icon' : 'image/svg+xml');
      res.set('Content-Type', ct);
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(buffer);
      return;
    }

    let width: number;
    let height: number;
    let imageMeta: { width: number; height: number; hasAlpha: boolean } | null = null;

    if (contentType.startsWith('image/')) {
      imageMeta = await getImageMetadata(buffer);
      if (imageMeta) {
        width = imageMeta.width;
        height = imageMeta.height;
      } else {
        width = 100;
        height = 100;
      }
    } else if (contentType.startsWith('video/') || /\.(mp4|webm|ogg)(\?|$)/i.test(url)) {
      const dims = getVideoDimensionsFromBuffer(buffer);
      width = dims.width;
      height = dims.height;
    } else {
      imageMeta = await getImageMetadata(buffer);
      if (imageMeta) {
        width = imageMeta.width;
        height = imageMeta.height;
      } else {
        width = DEFAULT_VIDEO_SIZE.width;
        height = DEFAULT_VIDEO_SIZE.height;
      }
    }

    let mockup: Buffer;
    if (imageMeta) {
      try {
        mockup = await createMosaicMockup(
          buffer,
          width,
          height,
          grid,
          imageMeta.hasAlpha,
          showLabel ? label : undefined
        );
      } catch {
        mockup = await createSvgPlaceholder(width, height, label, showLabel);
      }
    } else {
      mockup = await createSvgPlaceholder(width, height, label, showLabel);
    }

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(mockup);
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Unknown error');
    const mockup = await createSvgPlaceholder(100, 100, label, showLabel);
    res.set('Content-Type', 'image/png');
    res.send(mockup);
  }
}

app.get('/fetch', (req, res) => handleFetch(req, res, false));
app.get('/fetch/figma', (req, res) => handleFetch(req, res, true));

async function start() {
  const useHttps = process.env.HTTPS === '1';
  if (useHttps) {
    const { default: selfsigned } = await import('selfsigned');
    const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 365 });
    https.createServer({ key: pems.private, cert: pems.cert }, app).listen(PORT, () => {
      console.log(`Proxy server (HTTPS) at https://localhost:${PORT}`);
    });
  } else {
    http.createServer(app).listen(PORT, () => {
      console.log(`Proxy server at http://localhost:${PORT}`);
    });
  }
}

start();
