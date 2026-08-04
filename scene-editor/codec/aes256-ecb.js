// Minimal AES-256 in ECB mode (no padding) for the .pugc codec. The browser's Web Crypto has no ECB
// mode, so this is a self-contained implementation. Tables are generated (not hand-typed) to avoid
// transcription errors. Data passed to ecbEncrypt/ecbDecrypt must be a 16-byte-aligned Uint8Array.

function gfMul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p & 0xff;
}
const rotl8 = (x, n) => ((x << n) | (x >> (8 - n))) & 0xff;

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(function buildSbox() {
  const exp = new Uint8Array(256), log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x = gfMul(x, 3); }
  const inv = new Uint8Array(256);
  for (let i = 1; i < 256; i++) inv[i] = exp[(255 - log[i]) % 255];
  for (let i = 0; i < 256; i++) {
    const s = inv[i];
    SBOX[i] = (s ^ rotl8(s, 1) ^ rotl8(s, 2) ^ rotl8(s, 3) ^ rotl8(s, 4) ^ 0x63) & 0xff;
  }
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();

const NR = 14; // AES-256
function expandKey(key) {
  const Nk = 8, words = [];
  for (let i = 0; i < Nk; i++) words.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
  let rcon = 1;
  for (let i = Nk; i < 4 * (NR + 1); i++) {
    let t = words[i - 1].slice();
    if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= rcon; rcon = gfMul(rcon, 2); }
    else if (i % Nk === 4) { t = t.map(b => SBOX[b]); }
    words.push([0, 1, 2, 3].map(j => words[i - Nk][j] ^ t[j]));
  }
  const rk = new Uint8Array(16 * (NR + 1)); // rk[R*16 + c*4 + r] = words[R*4+c][r] (column-major state)
  for (let R = 0; R <= NR; R++) for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) rk[R * 16 + c * 4 + r] = words[R * 4 + c][r];
  return rk;
}

const addRoundKey = (s, rk, off) => { for (let i = 0; i < 16; i++) s[i] ^= rk[off + i]; };
const subBytes = (s, box) => { for (let i = 0; i < 16; i++) s[i] = box[s[i]]; };
function shiftRows(s, inv) {
  const t = s.slice();
  for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) s[c * 4 + r] = t[(((inv ? c - r : c + r) % 4) + 4) % 4 * 4 + r];
}
function mixColumns(s, inv) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
    if (!inv) {
      s[i]     = gfMul(a0, 2) ^ gfMul(a1, 3) ^ a2 ^ a3;
      s[i + 1] = a0 ^ gfMul(a1, 2) ^ gfMul(a2, 3) ^ a3;
      s[i + 2] = a0 ^ a1 ^ gfMul(a2, 2) ^ gfMul(a3, 3);
      s[i + 3] = gfMul(a0, 3) ^ a1 ^ a2 ^ gfMul(a3, 2);
    } else {
      s[i]     = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9);
      s[i + 1] = gfMul(a0, 9) ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13);
      s[i + 2] = gfMul(a0, 13) ^ gfMul(a1, 9) ^ gfMul(a2, 14) ^ gfMul(a3, 11);
      s[i + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9) ^ gfMul(a3, 14);
    }
  }
}

function encryptBlock(s, rk) {
  addRoundKey(s, rk, 0);
  for (let round = 1; round < NR; round++) { subBytes(s, SBOX); shiftRows(s, false); mixColumns(s, false); addRoundKey(s, rk, round * 16); }
  subBytes(s, SBOX); shiftRows(s, false); addRoundKey(s, rk, NR * 16);
}
function decryptBlock(s, rk) {
  addRoundKey(s, rk, NR * 16);
  for (let round = NR - 1; round >= 1; round--) { shiftRows(s, true); subBytes(s, INV_SBOX); addRoundKey(s, rk, round * 16); mixColumns(s, true); }
  shiftRows(s, true); subBytes(s, INV_SBOX); addRoundKey(s, rk, 0);
}

function ecb(key, data, encrypt) {
  if (data.length % 16 !== 0) throw new Error("AES-ECB: data not 16-byte aligned");
  const rk = expandKey(key);
  const out = new Uint8Array(data.length);
  const block = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    block.set(data.subarray(off, off + 16));
    if (encrypt) encryptBlock(block, rk); else decryptBlock(block, rk);
    out.set(block, off);
  }
  return out;
}
export const ecbEncrypt = (key, data) => ecb(key, data, true);
export const ecbDecrypt = (key, data) => ecb(key, data, false);
