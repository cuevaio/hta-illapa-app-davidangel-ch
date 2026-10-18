import { describe, expect, it } from 'vitest';
import { panelSections } from '../src/ui/sections';
import { ICONS, iconDataUrl } from '../src/ui/icons';

describe('panelSections', () => {
  it('shows only the options of the active tool', () => {
    expect(panelSections({ tool: 'navigate', mode: 'maquette' })).toMatchObject({ source: false, wall: false, hint: expect.stringMatching(/grip/) });
    expect(panelSections({ tool: 'source', mode: 'maquette' })).toMatchObject({ source: true, wall: false });
    expect(panelSections({ tool: 'wall', mode: 'maquette' })).toMatchObject({ source: false, wall: true });
    expect(panelSections({ tool: 'erase', mode: 'maquette' })).toMatchObject({ source: false, wall: false, hint: expect.stringMatching(/gatillo/) });
  });
  it('shows maquette settings only in maquette mode', () => {
    expect(panelSections({ tool: 'navigate', mode: 'maquette' }).maquette).toBe(true);
    expect(panelSections({ tool: 'navigate', mode: 'immersive' }).maquette).toBe(false);
  });
});

describe('panelSections on the web', () => {
  it('uses mouse hints and the same tool sections', () => {
    expect(panelSections({ tool: 'navigate', mode: 'maquette', input: 'web' }).hint).toMatch(/rueda/);
    expect(panelSections({ tool: 'erase', mode: 'maquette', input: 'web' }).hint).toMatch(/clic/);
    expect(panelSections({ tool: 'wall', mode: 'maquette', input: 'web' })).toMatchObject({ wall: true, source: false, hint: null });
    expect(panelSections({ tool: 'source', mode: 'maquette', input: 'web' })).toMatchObject({ wall: false, source: true, hint: null });
  });
});

describe('icons', () => {
  it('has an icon for every action and encodes it as an SVG data URL', () => {
    for (const name of ['navigate', 'source', 'wall', 'erase', 'play', 'pause', 'reset', 'undo', 'redo', 'earth', 'concrete', 'maquette', 'immersive', 'exit'] as const) {
      expect(ICONS[name]).toBeTruthy();
      const url = iconDataUrl(name, '#fff');
      expect(url.startsWith('data:image/svg+xml')).toBe(true);
      expect(decodeURIComponent(url)).toContain('<svg');
    }
  });
});
