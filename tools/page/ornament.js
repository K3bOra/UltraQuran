// Illumination helpers shared by every template (pure SVG strings).
const O = {
  defs() {
    return `<defs>
      <linearGradient id="gilt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff3c9"/><stop offset=".32" stop-color="#ebcb7d"/>
        <stop offset=".64" stop-color="#b98a39"/><stop offset=".82" stop-color="#8a6526"/><stop offset="1" stop-color="#e2bf6b"/></linearGradient>
      <linearGradient id="giltH" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8a6526"/><stop offset=".5" stop-color="#f6e2a6"/><stop offset="1" stop-color="#8a6526"/></linearGradient>
      <linearGradient id="ruby" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#a42f43"/><stop offset=".55" stop-color="#7f1d2e"/><stop offset="1" stop-color="#4f0f1b"/></linearGradient>
      <linearGradient id="emer" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#17503f"/><stop offset="1" stop-color="#0a2a21"/></linearGradient>
      <pattern id="braid" width="22" height="12" patternUnits="userSpaceOnUse">
        <rect width="22" height="12" fill="#0b2a21"/>
        <path d="M0 6 L5.5 1 L11 6 L5.5 11 Z M11 6 L16.5 1 L22 6 L16.5 11 Z" fill="none" stroke="#c99a43" stroke-width="1.1"/>
        <circle cx="11" cy="6" r="1.4" fill="#f0d389"/><circle cx="0" cy="6" r="1.4" fill="#f0d389"/><circle cx="22" cy="6" r="1.4" fill="#f0d389"/>
      </pattern>
      <pattern id="braidV" width="12" height="22" patternUnits="userSpaceOnUse">
        <rect width="12" height="22" fill="#0b2a21"/>
        <path d="M6 0 L11 5.5 L6 11 L1 5.5 Z M6 11 L11 16.5 L6 22 L1 16.5 Z" fill="none" stroke="#c99a43" stroke-width="1.1"/>
        <circle cx="6" cy="11" r="1.4" fill="#f0d389"/><circle cx="6" cy="0" r="1.4" fill="#f0d389"/><circle cx="6" cy="22" r="1.4" fill="#f0d389"/>
      </pattern>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>`;
  },

  // eight-pointed star (rub el hizb) rosette with a ruby heart
  rosette(cx, cy, r, ruby = true) {
    const s = r * 0.72;
    return `<g transform="translate(${cx} ${cy})">
      <circle r="${r * 1.05}" fill="#d6b25e" opacity=".18" filter="url(#glow)"/>
      <rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}" fill="#0b2a21" stroke="url(#gilt)" stroke-width="${r * 0.09}"/>
      <rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}" fill="#0b2a21" stroke="url(#gilt)" stroke-width="${r * 0.09}" transform="rotate(45)"/>
      <circle r="${s * 0.62}" fill="${ruby ? 'url(#ruby)' : '#0f3a2e'}" stroke="url(#gilt)" stroke-width="${r * 0.06}"/>
      <circle r="${s * 0.2}" fill="#f6e2a6"/>
    </g>`;
  },

  // Mushaf page border: gilt rule, braided band, inner rule, rosettes on the corners
  frame(w, h, m = 18, band = 12, corner = 22) {
    const x0 = m, y0 = m, x1 = w - m, y1 = h - m, b = band;
    return `
      <rect x="${x0 - 5}" y="${y0 - 5}" width="${x1 - x0 + 10}" height="${y1 - y0 + 10}" fill="none" stroke="url(#gilt)" stroke-width="1" opacity=".55"/>
      <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${b}" fill="url(#braid)"/>
      <rect x="${x0}" y="${y1 - b}" width="${x1 - x0}" height="${b}" fill="url(#braid)"/>
      <rect x="${x0}" y="${y0}" width="${b}" height="${y1 - y0}" fill="url(#braidV)"/>
      <rect x="${x1 - b}" y="${y0}" width="${b}" height="${y1 - y0}" fill="url(#braidV)"/>
      <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="url(#gilt)" stroke-width="2.4"/>
      <rect x="${x0 + b}" y="${y0 + b}" width="${x1 - x0 - 2 * b}" height="${y1 - y0 - 2 * b}" fill="none" stroke="url(#gilt)" stroke-width="2"/>
      <rect x="${x0 + b + 6}" y="${y0 + b + 6}" width="${x1 - x0 - 2 * b - 12}" height="${y1 - y0 - 2 * b - 12}" fill="none" stroke="#c99a43" stroke-width=".8" opacity=".55"/>
      ${O.rosette(x0 + b / 2, y0 + b / 2, corner)}${O.rosette(x1 - b / 2, y0 + b / 2, corner)}
      ${O.rosette(x0 + b / 2, y1 - b / 2, corner)}${O.rosette(x1 - b / 2, y1 - b / 2, corner)}`;
  },

  // lobed surah-header cartouche
  cartouche(cx, cy, w, h, fill = 'url(#ruby)') {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, r = h / 2;
    const shape = (i) => {
      const a = x0 + i, b = x1 - i, t = y0 + i, u = y1 - i, q = r - i;
      return `M${a + q} ${t} H${b - q} C${b - q * 0.25} ${t} ${b + q * 0.35} ${cy - q * 0.35} ${b + q * 0.55} ${cy}
              C${b + q * 0.35} ${cy + q * 0.35} ${b - q * 0.25} ${u} ${b - q} ${u} H${a + q}
              C${a + q * 0.25} ${u} ${a - q * 0.35} ${cy + q * 0.35} ${a - q * 0.55} ${cy}
              C${a - q * 0.35} ${cy - q * 0.35} ${a + q * 0.25} ${t} ${a + q} ${t} Z`;
    };
    return `<path d="${shape(-7)}" fill="none" stroke="#c99a43" stroke-width="1" opacity=".6"/>
      <path d="${shape(0)}" fill="${fill}" stroke="url(#gilt)" stroke-width="2.6"/>
      <path d="${shape(6)}" fill="none" stroke="#e7c56f" stroke-width=".9" opacity=".7"/>
      <circle cx="${x0 - r * 0.62}" cy="${cy}" r="3.2" fill="#f6e2a6"/><circle cx="${x1 + r * 0.62}" cy="${cy}" r="3.2" fill="#f6e2a6"/>`;
  },

  // thin gilt rule with a centred rosette
  rule(x0, x1, y, r = 9) {
    const c = (x0 + x1) / 2;
    return `<path d="M${x0} ${y}H${c - r * 2}M${c + r * 2} ${y}H${x1}" stroke="#c99a43" stroke-width="1.6"/>
      <path d="M${c - r * 2 - 10} ${y} l5 -5 l5 5 l-5 5z M${c + r * 2 + 10} ${y} l-5 -5 l-5 5 l5 5z" fill="#d6b25e"/>
      ${O.rosette(c, y, r)}`;
  },

  svg(inner) {
    return `<svg class="layer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${innerWidth} ${innerHeight}">${O.defs()}${inner}</svg>`;
  },
};
