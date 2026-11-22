// 线性图标集：统一 stroke 1.7、圆角端点，currentColor 着色，禁止 emoji 替代
type IconName =
  | 'gallery' | 'analysis' | 'layers' | 'pigment' | 'print' | 'carving'
  | 'plus' | 'upload' | 'trash' | 'edit' | 'zoom-in' | 'zoom-out'
  | 'play' | 'swap' | 'target' | 'empty' | 'check' | 'split' | 'merge'
  | 'download' | 'light' | 'print-icon'

const PATHS: Record<IconName, string> = {
  gallery: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  analysis: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
  layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  pigment: '<path d="M12 2a7 7 0 0 0-7 7c0 3 2 5 2 8a5 5 0 0 0 10 0c0-3 2-5 2-8a7 7 0 0 0-7-7z"/><path d="M9 17h6"/>',
  print: '<path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M6 14h12v8H6z"/>',
  carving: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  play: '<path d="M6 4l14 8-14 8V4z"/>',
  swap: '<path d="M7 4L3 8l4 4"/><path d="M3 8h13a5 5 0 0 1 5 5v1"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8a5 5 0 0 1-5-5v-1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
  empty: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  split: '<path d="M12 3v18"/><path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  merge: '<path d="M8 3l4 4-4 4M16 3l-4 4 4 4"/><path d="M12 7v14"/>',
  download: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  'print-icon': '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
}

export const iconSvg = (name: IconName, size = 18): string =>
  `<svg class="nav-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    ${PATHS[name]}
  </svg>`

export type { IconName }
