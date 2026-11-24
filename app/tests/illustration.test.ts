import { describe, expect, it } from 'vitest';
import { exportTsx, findIllustrations } from '../src/export';
import type { DesignDocument, DesignNode, Page } from '../src/model';

const shape = (id: string, parentId: string, x: number, y: number, size: number, patch: Partial<DesignNode> = {}): DesignNode =>
  ({ id, type: 'vector', name: id, parentId, x, y, width: size, height: size, transform: [1, 0, 0, 1, 0, 0], fills: [{ type: 'solid', color: '#336699' }], vectorPaths: [{ d: `M0 0L${size} 0L${size} ${size}Z`, fill: '#336699' }], ...patch });

/** 화면(1000×800) 안에 도형 count개로 된 묶음 하나. */
function screen(count: number, group: Partial<DesignNode> = {}, extra: DesignNode[] = []): Page {
  const kids = Array.from({ length: count }, (_, index) => shape(`v${index}`, 'art', 100 + (index % 10) * 10, 100 + Math.floor(index / 10) * 10, 8));
  const art: DesignNode = { id: 'art', type: 'group', name: 'City skyline', parentId: 'root', x: 100, y: 100, width: 200, height: 120, transform: [1, 0, 0, 1, 0, 0], fills: [], children: [...kids.map((kid) => kid.id), ...extra.map((kid) => kid.id)], ...group };
  const root: DesignNode = { id: 'root', type: 'frame', name: 'Home', parentId: null, x: 0, y: 0, width: 1000, height: 800, transform: [1, 0, 0, 1, 0, 0], fills: [{ type: 'solid', color: '#ffffff' }], children: ['art'] };
  return { id: 'p', name: 'P', children: ['root'], objects: Object.fromEntries([root, art, ...kids, ...extra].map((node) => [node.id, node])) };
}
const docOf = (page: Page): DesignDocument => ({ version: 5, name: 'Doc', components: {}, tokens: {}, pages: [page] }) as unknown as DesignDocument;

describe('illustrations as one SVG file', () => {
  it('exports a group of many shapes as an SVG file and an img, outside the stored asset list', () => {
    const result = exportTsx(docOf(screen(25)), 'p', 'root');
    expect(result.code).toContain("import imageSrc1 from './assets/city-skyline.svg';");
    expect(result.code).toMatch(/<img className="home__city-skyline" src=\{imageSrc1\} alt="City skyline" \/>/);
    const svg = result.files.find((file) => file.path === 'assets/city-skyline.svg');
    expect(svg?.data).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200" height="120"/);
    expect((svg?.data.match(/<path /g) ?? []).length).toBe(25);
    // 내보내기가 만든 파일이라 저장소에서 찾는 그림 목록(zip 받기가 IndexedDB에서 읽는 목록)에는 없다.
    expect(result.assets).toEqual([]);
    expect(result.missingAssets).toEqual([]);
    // 도형 25개가 TSX에 풀려 나오지 않는다.
    expect(result.code).not.toContain('<path');
  });

  it('keeps text, small icons, rotated groups and simple groups inline', () => {
    const text: DesignNode = { ...shape('label', 'art', 120, 200, 20), type: 'text', text: 'City', vectorPaths: undefined };
    expect(findIllustrations(screen(25, {}, [text]), 'root', new Set()).size).toBe(0);
    expect(findIllustrations(screen(25, { width: 24, height: 24 }), 'root', new Set()).size).toBe(0);
    expect(findIllustrations(screen(25, { transform: [0.7, 0.7, -0.7, 0.7, 0, 0] }), 'root', new Set()).size).toBe(0);
    expect(findIllustrations(screen(19), 'root', new Set()).size).toBe(0);
    // 숨긴 도형은 세지 않는다.
    expect(findIllustrations(screen(25), 'root', new Set(['v0', 'v1', 'v2', 'v3', 'v4', 'v5'])).size).toBe(0);
  });

  it('does not flip a mirrored illustration twice, and scales one that sticks out of the screen', () => {
    // 뒤집은 그림: SVG 좌표에 뒤집기가 들어 있으므로 CSS transform이 없다.
    const flipped = exportTsx(docOf(screen(25, { transform: [-1, 0, 0, 1, 0, 0] })), 'p', 'root');
    expect(/\n\.home__city-skyline \{([^}]*)\}/.exec(flipped.css)![1]).not.toContain('transform');
    // 화면 밖으로 삐져나온 배경 그림은 흐름에서 빠져 절대 위치이고, 왼쪽과 폭이 화면 폭에 대한 %라 화면과 함께 줄어든다.
    const wide = exportTsx(docOf(screen(25, { x: -50, width: 1100 })), 'p', 'root');
    const rule = /\n\.home__city-skyline \{([^}]*)\}/.exec(wide.css)![1]!;
    expect(rule).toContain('position: absolute;');
    expect(rule).toContain('left: -5%;');
    expect(rule).toContain('width: 110%;');
    expect(rule).toContain('aspect-ratio: 1100 / 120;');
  });
});
