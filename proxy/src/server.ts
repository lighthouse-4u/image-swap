import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import sharp from 'sharp';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';

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
  hasAlpha: boolean
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
  return sharp(small.data, {
    raw: {
      width: clampedGrid,
      height: clampedGrid,
      channels
    }
  })
    .resize(width, height, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
}

function createSvgPlaceholder(width: number, height: number): Promise<Buffer> {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e0e0e0"/>
      <text x="50%" y="50%" text-anchor="middle" dy=".35em" font-family="sans-serif" font-size="24" fill="#666">${width}×${height}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

app.get('/fetch', async (req: Request, res: Response) => {
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

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ImageMockupProxy/1.0' }
    });

    if (!response.ok) {
      const { width, height } = DEFAULT_VIDEO_SIZE;
      const mockup = await createSvgPlaceholder(width, height);
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
          imageMeta.hasAlpha
        );
      } catch {
        mockup = await createSvgPlaceholder(width, height);
      }
    } else {
      mockup = await createSvgPlaceholder(width, height);
    }

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(mockup);
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Unknown error');
    const mockup = await createSvgPlaceholder(100, 100);
    res.set('Content-Type', 'image/png');
    res.send(mockup);
  }
});

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
