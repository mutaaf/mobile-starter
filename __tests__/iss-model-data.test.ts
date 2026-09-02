import { base64ToArrayBuffer, issModelBuffer } from '@/lib/sky/iss-model-data';

describe('base64ToArrayBuffer', () => {
  it('round-trips known values', () => {
    const decode = (s: string) => new TextDecoder().decode(base64ToArrayBuffer(s));
    expect(decode('aGVsbG8=')).toBe('hello');
    expect(decode('aGVsbG8gd29ybGQ=')).toBe('hello world');
    expect(decode('YQ==')).toBe('a');
  });

  it('handles input with no padding', () => {
    expect(new TextDecoder().decode(base64ToArrayBuffer('aGVsbG8'))).toBe('hello');
  });

  it('decodes bytes above 0x7f correctly', () => {
    const bytes = new Uint8Array(base64ToArrayBuffer('//79/A=='));
    expect(Array.from(bytes)).toEqual([255, 254, 253, 252]);
  });
});

describe('embedded ISS model', () => {
  it('decodes to a valid glTF 2.0 binary', () => {
    const buffer = issModelBuffer();
    const view = new DataView(buffer);

    // Magic is the ASCII string "glTF".
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)))
      .toBe('glTF');
    expect(view.getUint32(4, true)).toBe(2);
    // The header's declared length must match what we actually decoded, which
    // catches a truncated or corrupted embed.
    expect(view.getUint32(8, true)).toBe(buffer.byteLength);
  });

  it('carries a JSON chunk describing at least one mesh', () => {
    const buffer = issModelBuffer();
    const view = new DataView(buffer);
    const chunkLength = view.getUint32(12, true);

    const json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 20, chunkLength)),
    );
    expect(json.asset.version).toBe('2.0');
    expect(json.meshes.length).toBeGreaterThan(0);
  });
});
