import zlib from "node:zlib";

let crcTable;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

export function createZoneMaskPng(zone, width = 1280, height = 820) {
  const raw = Buffer.alloc((width + 1) * height);
  const x0 = Math.max(0, Math.round((zone.xPct ?? 0) * width));
  const y0 = Math.max(0, Math.round((zone.yPct ?? 0) * height));
  const x1 = Math.min(width, Math.round(((zone.xPct ?? 0) + (zone.widthPct ?? 0)) * width));
  const y1 = Math.min(height, Math.round(((zone.yPct ?? 0) + (zone.heightPct ?? 0)) * height));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[rowStart + 1 + x] = x >= x0 && x < x1 && y >= y0 && y < y1 ? 255 : 0;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
