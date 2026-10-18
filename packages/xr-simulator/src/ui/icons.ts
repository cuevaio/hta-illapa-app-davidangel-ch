/**
 * Action icons as 24×24 stroke paths, shared by the web toolbar (inline SVG) and the 3D panel
 * (SVG data URLs), so both read the same and nothing depends on emoji fonts.
 */
export const ICONS = {
  navigate: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  source: 'M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11zM12 11v6M9.5 14.5L12 17l2.5-2.5',
  wall: 'M3 6h18v12H3zM3 12h18M9 6v6M15 6v6M6 12v6M12 12v6M18 12v6',
  erase: 'M16 3l5 5-11 11H5l-2-2zM9 10l5 5M5 21h16',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3',
  earth: 'M2 19h20M4 19l5-8h6l5 8M8 15h1M12 14h1M15 16h1',
  concrete: 'M6 4h12v15H6zM2 19h20M6 9l12 0M6 14h12',
  maquette: 'M3 15l9 4 9-4M3 15l9-4 9 4M12 11V5M8 7l4-2 4 2',
  immersive: 'M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-5l-3-3-3 3H4a2 2 0 0 1-2-2zM7 12h.01M17 12h.01',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  record: 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z',
  stop: 'M6 6h12v12H6z',
  stepBack: 'M6 5v14M19 5l-10 7 10 7z',
  stepForward: 'M18 5v14M5 5l10 7-10 7z',
  result: 'M3 5h18v14H3zM3 9h18M3 15h18M7 5v4M12 5v4M17 5v4M7 15v4M12 15v4M17 15v4',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  close: 'M6 6l12 12M18 6L6 18',
  fly: 'M2 16l20-8-8 12-2-6zM12 14l-4 4',
  live: 'M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  cloud: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z',
  rain: 'M7 13h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 13zM8 16l-1 4M12 16l-1 4M16 16l-1 4',
  bolt: 'M13 2L4 14h7l-2 8 9-12h-7z',
  storm: 'M7 12h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 12zM13 13l-3 5h4l-2 4',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  thermo: 'M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0zM12 9v8',
} as const;

export type IconName = keyof typeof ICONS;

export function iconSvg(name: IconName, color = 'currentColor', size = 24): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

export function iconDataUrl(name: IconName, color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, color, 96))}`;
}
