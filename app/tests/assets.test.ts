import { describe, expect, it } from 'vitest';
import { readImageSize, sniffImageMime, svgIntrinsicSize } from '../src/assets';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('SVG size', () => {
  it('reads width and height, including decimals and px', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="18.64" height="18.64" viewBox="0 0 18.64 18.64" fill="none">')).toEqual({ width: 18.64, height: 18.64 });
    expect(svgIntrinsicSize("<svg width='24px' height='12px'>")).toEqual({ width: 24, height: 12 });
  });

  it('falls back to the viewBox, and keeps its ratio when only one side is given', () => {
    expect(svgIntrinsicSize('<svg viewBox="0 0 1920 1213">')).toEqual({ width: 1920, height: 1213 });
    expect(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0,0,40,20">')).toEqual({ width: 40, height: 20 });
    expect(svgIntrinsicSize('<svg width="80" viewBox="0 0 40 20">')).toEqual({ width: 80, height: 40 });
  });

  it('skips the XML prolog and comments, and returns null without any size', () => {
    expect(svgIntrinsicSize('<?xml version="1.0"?>\n<!-- icon -->\n<svg\n  width="16"\n  height="16">')).toEqual({ width: 16, height: 16 });
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg">')).toBeNull();
    expect(svgIntrinsicSize('<svg width="0" height="0" viewBox="0 0 0 0">')).toBeNull();
    expect(svgIntrinsicSize('<html></html>')).toBeNull();
  });

  it('gives a size for SVG bytes without decoding them as a bitmap', async () => {
    const icon = encode('<svg xmlns="http://www.w3.org/2000/svg" width="10.67" height="12" viewBox="0 0 10.67 12"><path d="M0 0h1v1z"/></svg>');
    expect(sniffImageMime(icon)).toBe('image/svg+xml');
    await expect(readImageSize(icon, 'image/svg+xml')).resolves.toEqual({ width: 10.67, height: 12 });
    await expect(readImageSize(encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).resolves.toEqual({ width: 100, height: 100 });
  });
});
