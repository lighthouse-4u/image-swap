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

async function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(buffer).metadata();
    return { width: meta.width || 100, height: meta.height || 100 };
  } catch {
    return { width: 100, height: 100 };
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

async function createMockupImage(
  width: number,
  height: number,
  _contentType: string
): Promise<Buffer> {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e0e0e0"/>
      <text x="50%" y="50%" text-anchor="middle" dy=".35em" font-family="sans-serif" font-size="24" fill="#666">${width}×${height}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

app.get('/fetch', async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).send('Missing url parameter');
    return;
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ImageMockupProxy/1.0' }
    });

    if (!response.ok) {
      const { width, height } = DEFAULT_VIDEO_SIZE;
      const mockup = await createMockupImage(width, height, 'image/png');
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(mockup);
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());

    let width: number;
    let height: number;

    if (contentType.startsWith('image/')) {
      const dims = await getImageDimensions(buffer);
      width = dims.width;
      height = dims.height;
    } else if (contentType.startsWith('video/') || /\.(mp4|webm|ogg)(\?|$)/i.test(url)) {
      const dims = getVideoDimensionsFromBuffer(buffer);
      width = dims.width;
      height = dims.height;
    } else {
      try {
        const dims = await getImageDimensions(buffer);
        width = dims.width;
        height = dims.height;
      } catch {
        width = DEFAULT_VIDEO_SIZE.width;
        height = DEFAULT_VIDEO_SIZE.height;
      }
    }

    const mockup = await createMockupImage(width, height, contentType);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(mockup);
  } catch (err) {
    console.error(err);
    const mockup = await createMockupImage(100, 100, 'image/png');
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
