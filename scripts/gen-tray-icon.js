// One-off generator for the embedded tray icon (32x32 PNG, base64).
// Dark rounded square with a zombie-green "Z". Output is pasted into
// electron-src/main.ts as TRAY_ICON_B64.
const zlib = require('zlib')

const W = 32, H = 32
const px = Buffer.alloc(W * H * 4) // RGBA

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
}

const BG = [26, 26, 26]      // #1a1a1a
const GREEN = [46, 204, 113] // #2ecc71

// Rounded-square background (radius 6)
const R = 6
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // distance check against the four corner circles
    const cx = x < R ? R : x >= W - R ? W - R - 1 : x
    const cy = y < R ? R : y >= H - R ? H - R - 1 : y
    const dx = x - cx, dy = y - cy
    if (dx * dx + dy * dy <= R * R) set(x, y, ...BG)
  }
}

// "Z": top bar, diagonal, bottom bar — 3px stroke, inset 7
const x0 = 7, x1 = W - 8, yTop = 7, yBot = H - 8, T = 3
for (let t = 0; t < T; t++) {
  for (let x = x0; x <= x1; x++) { set(x, yTop + t, ...GREEN); set(x, yBot - t, ...GREEN) }
}
// diagonal from (x1, yTop+T) down-left to (x0, yBot-T)
const dy0 = yTop + T, dy1 = yBot - T
for (let y = dy0; y <= dy1; y++) {
  const f = (y - dy0) / (dy1 - dy0)
  const cx = Math.round(x1 - f * (x1 - x0))
  for (let t = -1; t <= 1; t++) set(cx + t, y, ...GREEN)
}

// --- PNG encode ---
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc & 0xffffff00) | c
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
// crc32 above is wrong (mangled loop) — use a clean table-based version:
const TBL = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, c])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8-bit RGBA

const raw = Buffer.alloc(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0 // filter: none
  px.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

require('fs').writeFileSync(__dirname + '/tray-icon.png', png)
console.log(png.toString('base64'))
