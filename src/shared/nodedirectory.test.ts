import { describe, expect, it } from 'vitest';
import { classifyNode, parseAstdb } from './nodedirectory.js';

describe('nodedirectory', () => {
  it('classifies US nodes with state from location', () => {
    expect(classifyNode('WB6NIL', 'Los Angeles, CA')).toEqual({ country: 'United States', state: 'California' });
    expect(classifyNode('WB6NIL', 'Columbus, OH, US')).toEqual({ country: 'United States', state: 'Ohio' });
    expect(classifyNode('KC3DRE', 'Blue Bell, PA, United States')).toEqual({ country: 'United States', state: 'Pennsylvania' });
    expect(classifyNode('KG5IRU', 'Love, MS 38632')).toEqual({ country: 'United States', state: 'Mississippi' });
  });

  it('classifies international nodes by callsign prefix', () => {
    expect(classifyNode('GB3AO', 'Aboyne').country).toBe('United Kingdom');
    expect(classifyNode('VK3ABC', 'Melbourne').country).toBe('Australia');
    expect(classifyNode('VE3XYZ', 'Toronto').country).toBe('Canada');
    expect(classifyNode('DL1ABC', 'Berlin').country).toBe('Germany');
  });

  it('falls back to International for unknown prefixes', () => {
    expect(classifyNode('YO2ABC', 'Nowhere').country).toBe('International');
  });

  it('parses astdb lines and skips malformed rows', () => {
    const text = ['2000|WB6NIL|ASL Public Hub|Los Angeles, CA', 'garbage line', '3001|G7ABC|Repeater|Leeds'].join('\n');
    const nodes = parseAstdb(text);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ node: '2000', callsign: 'WB6NIL', state: 'California' });
    expect(nodes[1]).toMatchObject({ node: '3001', country: 'United Kingdom' });
  });
});
