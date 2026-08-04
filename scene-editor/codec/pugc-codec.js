// The .pugc codec boundary. The editor opens/saves .pugc only through getPugcCodec(), which
// resolves to the in-browser codec (pugc-codec-client.js + aes256-ecb.js).
// Interface: decode(bytes, name) -> { json, name, fileInfo };  encode(jsonObject, name) -> Uint8Array.
let codecPromise = null;
export function getPugcCodec() {
  if (!codecPromise) codecPromise = import("./pugc-codec-client.js").then((m) => m.clientCodec);
  return codecPromise;
}
