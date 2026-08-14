// In-browser .pugc codec: AES-256-ECB (key derived from the file's own length+CRC footer) + the custom
// zlib framing. Mirrors web/pugc_codec.js byte-for-byte. zlib uses the browser's native
// (De)CompressionStream; only AES needs the local primitive.
import { ecbEncrypt, ecbDecrypt } from './aes256-ecb.js';

function crc32(buf, len = buf.length) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < len; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
  }
  return (~crc) >>> 0;
}
function adler32(data) {
  const MOD = 65521; let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % MOD; b = (b + a) % MOD; }
  return ((b << 16) | a) >>> 0;
}
// Game key: a 32-byte key derived from the payload length and CRC (no fixed secret).
function makeKey(payloadLen, payloadCrc) {
  const signedLen = payloadLen | 0;
  const product = Math.imul(payloadCrc, payloadCrc) >>> 0;
  const shifted = product >>> 11;
  const source = new TextEncoder().encode(`${signedLen}-${payloadCrc}-${product}-${shifted}`);
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = source[i % source.length];
  return key;
}
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const w32le = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; };
// The 13-byte wrapper the game puts in front of the encrypted payload:
//   [0..4] ".pugc"  [5..8] version u32LE  [9..12] crc32 of bytes 0..8, u32LE
// The trailing 4 bytes look like an opaque marker but are just that CRC, so any version's header can
// be built rather than tabulated: v1 -> 99 76 E5 CD, v3 -> 12 BE EC 67 both fall out of the formula.
const PUGC_MAGIC = new Uint8Array([0x2e, 0x70, 0x75, 0x67, 0x63]);
const PUGC_HEADER_LENGTH = 13;
// Wrapper version written on save. It tracks the JSON's dataVersion (the game bumped both 1 -> 3 in
// the 2608.1.1 build), and the game rejects a file whose header version is older than it expects.
export const PUGC_LATEST_VERSION = 3;

function buildPugcHeader(version) {
  const header = new Uint8Array(PUGC_HEADER_LENGTH);
  header.set(PUGC_MAGIC);
  w32le(header, 5, version >>> 0);
  w32le(header, 9, crc32(header.subarray(0, 9)));
  return header;
}

function hasPugcMagic(bytes) {
  if (bytes.length < PUGC_HEADER_LENGTH) return false;
  for (let i = 0; i < PUGC_MAGIC.length; i++) {
    if (bytes[i] !== PUGC_MAGIC[i]) return false;
  }
  return true;
}

// Version-agnostic: any ".pugc"-tagged file loses the same 13 bytes, so a future version bump reads
// without a code change (the payload format behind the header has never changed).
function stripPugcHeader(bytes) {
  return hasPugcMagic(bytes) ? bytes.subarray(PUGC_HEADER_LENGTH) : bytes;
}

function hexBytes(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function pugcHeaderInfo(bytes) {
  const hasHeader = hasPugcMagic(bytes);
  if (!hasHeader) {
    return { hasHeader: false, format: "Legacy PUGC payload", headerLength: 0, headerHex: "", magic: "", version: null, marker: "", saveHeader: true };
  }
  const header = bytes.subarray(0, PUGC_HEADER_LENGTH);
  const version = u32le(header, 5);
  return {
    hasHeader: true,
    format: `PUGC v${version} wrapper`,
    headerLength: PUGC_HEADER_LENGTH,
    headerHex: hexBytes(header),
    magic: ".pugc",
    version,
    marker: hexBytes(header.subarray(9)),
    markerValid: u32le(header, 9) === crc32(header.subarray(0, 9)),
    saveHeader: true,
  };
}

function addPugcHeader(bytes, version) {
  const header = buildPugcHeader(version);
  const result = new Uint8Array(header.length + bytes.length);
  result.set(header);
  result.set(bytes, header.length);
  return result;
}

async function streamBytes(transform, bytes) {
  const out = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const inflateZlib = (bytes) => streamBytes(new DecompressionStream("deflate"), bytes);   // zlib (0x78 header)
const deflateRaw = (bytes) => streamBytes(new CompressionStream("deflate-raw"), bytes);   // raw deflate

async function decode(fileBytes, name = "project.pugc") {
  const raw = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  const fileInfo = pugcHeaderInfo(raw);
  const f = stripPugcHeader(raw);
  if (f.length < 24) throw new Error("File too small");
  const payloadLen = u32le(f, f.length - 8);
  const payloadCrc = u32le(f, f.length - 4);
  const encryptedLen = f.length - 8;
  if (encryptedLen & 0x0f) throw new Error("Encrypted payload not 16-byte aligned");
  if (payloadLen === 0 || payloadLen > encryptedLen) throw new Error("Invalid payload length in footer");

  const decrypted = ecbDecrypt(makeKey(payloadLen, payloadCrc), f.subarray(0, encryptedLen));
  if (crc32(decrypted, payloadLen) !== payloadCrc) throw new Error("CRC mismatch (wrong key or corrupt file)");
  const payload = decrypted.subarray(0, payloadLen);
  const compressedLen = (payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24)); // int32LE
  if (compressedLen <= 6 || compressedLen + 8 > payload.length) throw new Error("Invalid compression header");
  if (payload[8] !== 0x78) throw new Error("Not a zlib stream (expected 0x78 header)");

  const jsonBytes = await inflateZlib(payload.subarray(8, 8 + compressedLen));
  let end = jsonBytes.length;
  if (end > 0 && jsonBytes[end - 1] === 0) end--; // strip the game's null terminator
  const json = JSON.parse(new TextDecoder("utf-8").decode(jsonBytes.subarray(0, end)));
  return { json, name, fileInfo };
}

// version: the wrapper version to stamp. Defaults to the JSON's own dataVersion so a file round-trips
// as the game wrote it; a scene built from scratch (no dataVersion) gets the latest.
async function encode(jsonObject, name, version) {
  const headerVersion = Number.isInteger(version) ? version
    : Number.isInteger(jsonObject?.dataVersion) ? jsonObject.dataVersion
    : PUGC_LATEST_VERSION;
  let jsonBytes = new TextEncoder().encode(JSON.stringify(jsonObject));
  if (!jsonBytes.length || jsonBytes[jsonBytes.length - 1] !== 0) { // game expects null-terminated JSON
    const tmp = new Uint8Array(jsonBytes.length + 1); tmp.set(jsonBytes); jsonBytes = tmp;
  }
  const raw = await deflateRaw(jsonBytes);
  const adler = adler32(jsonBytes);
  const zlib = new Uint8Array(2 + raw.length + 4);
  zlib[0] = 0x78; zlib[1] = 0x9c; zlib.set(raw, 2);
  const za = 2 + raw.length; // Adler32 big-endian
  zlib[za] = (adler >>> 24) & 0xff; zlib[za + 1] = (adler >>> 16) & 0xff; zlib[za + 2] = (adler >>> 8) & 0xff; zlib[za + 3] = adler & 0xff;

  const payload = new Uint8Array(8 + zlib.length);
  w32le(payload, 0, zlib.length);     // compressedLen
  w32le(payload, 4, jsonBytes.length); // originalLen
  payload.set(zlib, 8);

  const payloadLen = payload.length >>> 0;
  const payloadCrc = crc32(payload);
  const encryptedLen = (payload.length + 15) & ~15;
  const padded = new Uint8Array(encryptedLen); padded.set(payload);
  const encrypted = ecbEncrypt(makeKey(payloadLen, payloadCrc), padded);

  const result = new Uint8Array(encrypted.length + 8);
  result.set(encrypted);
  w32le(result, encrypted.length, payloadLen);
  w32le(result, encrypted.length + 4, payloadCrc);
  return addPugcHeader(result, headerVersion);
}

export const clientCodec = { decode, encode, headerInfo: pugcHeaderInfo };
