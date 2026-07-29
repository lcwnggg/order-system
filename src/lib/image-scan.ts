// ─────────────────────────────────────────────────────────────
// Detección automática del sujeto de una foto + corrección de
// perspectiva. Es lo que hace el escáner de documentos de iOS:
// encuentra el papel/producto sobre la mesa, endereza las cuatro
// esquinas y tira el resto de la foto.
//
// Todo en canvas puro (sin OpenCV ni ninguna dependencia): el
// análisis se hace sobre una miniatura de ~480 px, así que sale
// barato aunque la foto original sea de 12 MP.
//
// El pipeline es el clásico de escaneo:
//   1. miniatura → gris
//   2. color de fondo = mediana del marco exterior de la foto
//   3. máscara = píxeles que se alejan de ese fondo (umbral de Otsu)
//   4. limpieza morfológica (cierre + apertura)
//   5. componente conexa más grande = el sujeto
//   6. sus 4 esquinas extremas → cuadrilátero
//   7. si el cuadrilátero "llena" bien la componente es un documento
//      (se rectifica con una homografía); si no, se usa el bbox.
// ─────────────────────────────────────────────────────────────

export type Point = { x: number; y: number };
/** Esquinas en coordenadas del original: superior-izq, sup-der, inf-der, inf-izq. */
export type Quad = [Point, Point, Point, Point];

export type Detection = {
  /** Cuadrilátero del sujeto, en píxeles de la imagen original. */
  quad: Quad;
  /** "document" → merece rectificar perspectiva; "object" → basta recortar el bbox. */
  kind: "document" | "object";
  /** Máscara del sujeto (1 = sujeto) a resolución de análisis, para quitar el fondo. */
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  /** Factor máscara → original (multiplicar coordenadas de máscara por esto). */
  maskScale: number;
};

/** Lado máximo de la miniatura de análisis. Más grande = máscara más fina y más lento. */
const ANALYSIS_MAX = 480;
/** Lado máximo del resultado rectificado. */
const OUTPUT_MAX = 1800;
/**
 * Lado máximo al que se trabaja píxel a píxel. Una foto de móvil de 12 MP
 * son ~48 MB de ImageData por copia: en un iPhone eso es quedarse sin memoria
 * a la mitad. Como la imagen final es de 1200 px, bajar a 2000 no pierde nada.
 */
const WORK_MAX = 2000;

/**
 * Pasa la imagen a un canvas de trabajo con el lado máximo acotado.
 * `scale` es el factor original → trabajo (para convertir coordenadas).
 */
function rasterize(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxDim: number
): { canvas: HTMLCanvasElement; w: number; h: number; scale: number } {
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = makeCanvas(w, h);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas, w, h, scale };
}

// ─────────────────────────── utilidades ───────────────────────────

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d no disponible");
  return ctx;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Umbral de Otsu sobre un histograma de 256 bins: parte los píxeles en dos
 * grupos maximizando la varianza entre ellos. Es el umbral automático
 * estándar y aquí evita tener que fijar a mano "cuánto tiene que diferir
 * del fondo" (depende muchísimo de la luz de cada foto).
 */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = i;
    }
  }
  return best;
}

/** Dilatación binaria con radio `r` (ventana cuadrada), separada en dos pasadas 1D. */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dx = -r; dx <= r && !v; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < w && mask[y * w + nx]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -r; dy <= r && !v; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < h && tmp[ny * w + x]) v = 1;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Erosión binaria = dilatar el complemento. */
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const dil = dilate(inv, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = dil[i] ? 0 : 1;
  return out;
}

/** Componente conexa (8-vecinos) más grande. Devuelve su máscara y su área. */
function largestComponent(
  mask: Uint8Array,
  w: number,
  h: number
): { mask: Uint8Array; area: number } | null {
  const labels = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  let bestLabel = -1;
  let bestArea = 0;
  let label = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    let area = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      area++;
      const x = idx % w;
      const y = (idx - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (mask[nIdx] && labels[nIdx] === -1) {
            labels[nIdx] = label;
            stack.push(nIdx);
          }
        }
      }
    }
    if (area > bestArea) {
      bestArea = area;
      bestLabel = label;
    }
    label++;
  }

  if (bestLabel === -1) return null;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = labels[i] === bestLabel ? 1 : 0;
  return { mask: out, area: bestArea };
}

/**
 * Rellena los huecos interiores: se inunda el fondo desde el borde y todo lo
 * que no se alcanza (un hueco rodeado por el sujeto) pasa a ser sujeto.
 * Sin esto, una hoja blanca sobre mesa clara se detecta solo por sus bordes
 * y la componente sale hueca.
 */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (idx: number) => {
    if (!mask[idx] && !outside[idx]) {
      outside[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] || !outside[i] ? 1 : 0;
  return out;
}

/**
 * Empuja hacia fuera los cuatro lados del cuadrilátero hasta que encierre
 * TODOS los píxeles del sujeto, manteniendo la orientación de cada lado.
 *
 * Hace falta porque las "esquinas extremas" solo son las esquinas de verdad
 * si el sujeto es un rectángulo con vértices en pico. En un móvil con las
 * esquinas redondeadas los extremos caen sobre la curva, y el cuadrilátero
 * que sale corta un trocito de cada esquina. Empujando los lados hasta
 * tocar la silueta se recupera el rectángulo real.
 */
function expandQuadToContain(
  quad: Quad,
  mask: Uint8Array,
  w: number,
  h: number,
  centroid: Point,
  padding: number
): Quad | null {
  const lines: { nx: number; ny: number; c: number }[] = [];

  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return null;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    // La normal tiene que apuntar hacia fuera (lejos del centro del sujeto)
    if (nx * (centroid.x - a.x) + ny * (centroid.y - a.y) > 0) {
      nx = -nx;
      ny = -ny;
    }
    lines.push({ nx, ny, c: nx * a.x + ny * a.y });
  }

  // Una sola pasada por la máscara actualizando los cuatro desplazamientos
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (const l of lines) {
        const s = l.nx * x + l.ny * y;
        if (s > l.c) l.c = s;
      }
    }
  }
  for (const l of lines) l.c += padding;

  // Esquina i = corte del lado anterior con el lado i
  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4];
    const l2 = lines[i];
    const det = l1.nx * l2.ny - l2.nx * l1.ny;
    if (Math.abs(det) < 1e-6) return null;
    corners.push({
      x: (l1.c * l2.ny - l2.c * l1.ny) / det,
      y: (l1.nx * l2.c - l2.nx * l1.c) / det,
    });
  }
  return corners as Quad;
}

/** ¿Los lados están (casi) alineados con los ejes? Entonces enderezar no aporta nada. */
function isAxisAligned(quad: Quad, toleranceDeg = 4): boolean {
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const deg = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90;
    const off = Math.min(deg, 90 - deg);
    if (off > toleranceDeg) return false;
  }
  return true;
}

function polygonArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ─────────────────────────── detección ───────────────────────────

/**
 * Busca el sujeto de la foto. Devuelve `null` si no encuentra nada fiable
 * (fondo tan parecido al sujeto que la máscara sale toda la foto, o casi nada).
 * Que devuelva null es parte del diseño: mejor decirle a la usuaria "no lo veo
 * claro, recorta a mano" que entregarle una foto mal cortada.
 */
export function detectSubject(
  source: CanvasImageSource,
  width: number,
  height: number
): Detection | null {
  if (!(width > 0) || !(height > 0)) return null;

  const scale = Math.min(1, ANALYSIS_MAX / Math.max(width, height));
  const aw = Math.max(8, Math.round(width * scale));
  const ah = Math.max(8, Math.round(height * scale));

  const canvas = makeCanvas(aw, ah);
  const ctx = ctx2d(canvas);
  ctx.drawImage(source, 0, 0, aw, ah);
  const { data } = ctx.getImageData(0, 0, aw, ah);

  // 1. color de fondo = mediana del marco exterior (más robusto que la media:
  //    si una esquina del marco ya pilla el sujeto, la mediana lo ignora)
  const border = Math.max(2, Math.round(Math.min(aw, ah) * 0.04));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const onBorder = x < border || y < border || x >= aw - border || y >= ah - border;
      if (!onBorder) continue;
      const i = (y * aw + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  const bg = { r: median(rs), g: median(gs), b: median(bs) };

  // 2. distancia al fondo, normalizada a 0..255
  const diff = new Uint8Array(aw * ah);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < diff.length; p++, i += 4) {
    const d =
      Math.abs(data[i] - bg.r) + Math.abs(data[i + 1] - bg.g) + Math.abs(data[i + 2] - bg.b);
    const v = Math.min(255, Math.round(d / 3) * 2);
    diff[p] = v;
    hist[v]++;
  }

  // 3. umbral automático, con suelo y techo: Otsu se vuelve loco en fotos
  //    planas (fondo y sujeto casi del mismo color) y devuelve umbrales de 3-4
  //    que marcan como sujeto hasta el ruido del sensor.
  const threshold = Math.min(110, Math.max(26, otsu(hist, diff.length)));
  let mask: Uint8Array<ArrayBufferLike> = new Uint8Array(aw * ah);
  for (let i = 0; i < mask.length; i++) mask[i] = diff[i] > threshold ? 1 : 0;

  // 4. limpieza: cierre (une el sujeto consigo mismo) + apertura (mata motas)
  const r = Math.max(1, Math.round(Math.min(aw, ah) / 90));
  mask = erode(dilate(mask, aw, ah, r), aw, ah, r);
  mask = dilate(erode(mask, aw, ah, r), aw, ah, r);

  // 5. componente más grande + relleno de huecos
  const comp = largestComponent(mask, aw, ah);
  if (!comp) return null;
  const filled = fillHoles(comp.mask, aw, ah);
  let area = 0;
  for (let i = 0; i < filled.length; i++) area += filled[i];

  const fraction = area / (aw * ah);
  // Ni un puntito de ruido ni "toda la foto": en ambos casos no hemos
  // detectado nada útil y recortar solo empeoraría la imagen.
  if (fraction < 0.02 || fraction > 0.97) return null;

  // 6. esquinas extremas. Para un rectángulo (aunque esté girado o en
  //    perspectiva) min(x+y)/max(x−y)/max(x+y)/min(x−y) son exactamente
  //    sus cuatro vértices.
  let minSum = Infinity, maxSum = -Infinity, minDif = Infinity, maxDif = -Infinity;
  let tl: Point = { x: 0, y: 0 };
  let br: Point = { x: 0, y: 0 };
  let tr: Point = { x: 0, y: 0 };
  let bl: Point = { x: 0, y: 0 };
  let minX = aw, maxX = 0, minY = ah, maxY = 0;
  let sumX = 0, sumY = 0;

  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      if (!filled[y * aw + x]) continue;
      const sum = x + y;
      const dif = x - y;
      if (sum < minSum) { minSum = sum; tl = { x, y }; }
      if (sum > maxSum) { maxSum = sum; br = { x, y }; }
      if (dif > maxDif) { maxDif = dif; tr = { x, y }; }
      if (dif < minDif) { minDif = dif; bl = { x, y }; }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
    }
  }

  const bboxQuad: Quad = [
    { x: minX, y: minY },
    { x: maxX + 1, y: minY },
    { x: maxX + 1, y: maxY + 1 },
    { x: minX, y: maxY + 1 },
  ];
  const bboxArea = polygonArea(bboxQuad);

  // 7. Los extremos dan la ORIENTACIÓN correcta pero pueden quedarse cortos
  //    (esquinas redondeadas); se empujan los lados hasta abrazar la silueta.
  const expanded = expandQuadToContain(
    [tl, tr, br, bl],
    filled,
    aw,
    ah,
    { x: sumX / area, y: sumY / area },
    1
  );

  // 8. ¿Merece la pena enderezar? Solo si el cuadrilátero abraza de verdad la
  //    silueta. Un objeto redondo deja un 21 % de hueco contra su cuadrilátero
  //    y enderezarlo solo conseguiría girarlo 45° sin motivo.
  const expandedArea = expanded ? polygonArea(expanded) : 0;
  const fits = expanded !== null && expandedArea > 0 && expandedArea <= bboxArea * 1.15;
  const fillRatio = fits ? area / expandedArea : 0;
  const useExpanded = fits && fillRatio > 0.86;

  const chosen: Quad = useExpanded && expanded ? expanded : bboxQuad;
  // Un cuadrilátero ya recto no necesita homografía: se etiqueta como "objeto"
  // para no prometerle a la usuaria un enderezado que no ha ocurrido.
  const kind: Detection["kind"] = useExpanded && !isAxisAligned(chosen) ? "document" : "object";

  const inv = 1 / scale;
  const quad = chosen.map((p) => ({ x: p.x * inv, y: p.y * inv })) as Quad;

  return {
    quad,
    kind,
    mask: filled,
    maskWidth: aw,
    maskHeight: ah,
    maskScale: inv,
  };
}

// ─────────────────────── rectificación (homografía) ───────────────────────

/**
 * Resuelve un sistema lineal n×n por eliminación gaussiana con pivoteo parcial.
 * Devuelve null si la matriz es singular (cuadrilátero degenerado).
 */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = a[row][col] / a[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) a[row][k] -= f * a[col][k];
    }
  }
  // Es Gauss-Jordan (se elimina arriba y abajo), así que la matriz queda
  // diagonal y despejar es una división por fila.
  return a.map((row, i) => row[n] / row[i]);
}

/**
 * Homografía destino → origen: dado (u,v) del resultado, dice de qué píxel
 * (x,y) del original hay que tomar el color. Se calcula en esta dirección
 * (inversa) precisamente para poder recorrer el destino píxel a píxel sin
 * dejar agujeros.
 */
function inverseHomography(dstW: number, dstH: number, quad: Quad): number[] | null {
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];
  const m: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i];
    const { x, y } = quad[i];
    m.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    rhs.push(x);
    m.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    rhs.push(y);
  }
  return solve(m, rhs);
}

/**
 * Rectifica el cuadrilátero `quad` del original a un rectángulo recto.
 * Muestreo bilineal; lo que cae fuera del original queda blanco (no negro,
 * que en un JPEG canta muchísimo).
 */
export function warpQuad(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  quad: Quad
): HTMLCanvasElement | null {
  const work = rasterize(source, srcW, srcH, WORK_MAX);
  const workQuad = quad.map((p) => ({ x: p.x * work.scale, y: p.y * work.scale })) as Quad;

  const [tl, tr, br, bl] = workQuad;
  const targetW = Math.max(dist(tl, tr), dist(bl, br));
  const targetH = Math.max(dist(tl, bl), dist(tr, br));
  if (!(targetW > 1) || !(targetH > 1)) return null;

  const k = Math.min(1, OUTPUT_MAX / Math.max(targetW, targetH));
  const dstW = Math.max(1, Math.round(targetW * k));
  const dstH = Math.max(1, Math.round(targetH * k));

  const h = inverseHomography(dstW, dstH, workQuad);
  if (!h) return null;
  const [a, b, c, d, e, f, g, i] = h;

  const srcW2 = work.w;
  const srcH2 = work.h;
  const src = ctx2d(work.canvas).getImageData(0, 0, srcW2, srcH2).data;

  const out = makeCanvas(dstW, dstH);
  const outCtx = ctx2d(out);
  const outImg = outCtx.createImageData(dstW, dstH);
  const dstData = outImg.data;

  for (let v = 0; v < dstH; v++) {
    for (let u = 0; u < dstW; u++) {
      const uu = u + 0.5;
      const vv = v + 0.5;
      const w = g * uu + i * vv + 1;
      const sx = (a * uu + b * vv + c) / w;
      const sy = (d * uu + e * vv + f) / w;
      const o = (v * dstW + u) * 4;

      if (sx < 0 || sy < 0 || sx > srcW2 - 1 || sy > srcH2 - 1) {
        dstData[o] = 255;
        dstData[o + 1] = 255;
        dstData[o + 2] = 255;
        dstData[o + 3] = 255;
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(srcW2 - 1, x0 + 1);
      const y1 = Math.min(srcH2 - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * srcW2 + x0) * 4;
      const i10 = (y0 * srcW2 + x1) * 4;
      const i01 = (y1 * srcW2 + x0) * 4;
      const i11 = (y1 * srcW2 + x1) * 4;

      for (let ch = 0; ch < 3; ch++) {
        const top = src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx;
        const bot = src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx;
        dstData[o + ch] = top * (1 - fy) + bot * fy;
      }
      dstData[o + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return out;
}

/**
 * Deja el sujeto y pinta de blanco todo lo demás, usando la máscara de la
 * detección. La máscara se sube de la resolución de análisis a la real con
 * el suavizado del propio canvas, lo que además le da un borde blando en vez
 * de un recorte a escalones.
 */
export function whitenBackground(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  detection: Detection
): HTMLCanvasElement {
  const { mask, maskWidth, maskHeight } = detection;
  const work = rasterize(source, srcW, srcH, WORK_MAX);

  // Máscara como canvas en escala de grises → alfa
  const maskCanvas = makeCanvas(maskWidth, maskHeight);
  const maskCtx = ctx2d(maskCanvas);
  const maskImg = maskCtx.createImageData(maskWidth, maskHeight);
  for (let p = 0; p < mask.length; p++) {
    const o = p * 4;
    maskImg.data[o] = 255;
    maskImg.data[o + 1] = 255;
    maskImg.data[o + 2] = 255;
    maskImg.data[o + 3] = mask[p] ? 255 : 0;
  }
  maskCtx.putImageData(maskImg, 0, 0);

  const layer = makeCanvas(work.w, work.h);
  const layerCtx = ctx2d(layer);
  layerCtx.imageSmoothingEnabled = true;
  layerCtx.imageSmoothingQuality = "high";
  layerCtx.drawImage(maskCanvas, 0, 0, work.w, work.h);
  layerCtx.globalCompositeOperation = "source-in";
  layerCtx.drawImage(work.canvas, 0, 0);

  const out = makeCanvas(work.w, work.h);
  const outCtx = ctx2d(out);
  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, work.w, work.h);
  outCtx.drawImage(layer, 0, 0);
  return out;
}

/**
 * Recorta el polígono dibujado a mano: dentro se ve la foto, fuera blanco,
 * y el lienzo se ajusta al bounding box del trazo (con un pequeño margen)
 * para que el sujeto no quede perdido en una esquina.
 */
export function cutOutPolygon(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  points: Point[],
  paddingRatio = 0.02
): HTMLCanvasElement | null {
  if (points.length < 3) return null;

  const work = rasterize(source, srcW, srcH, WORK_MAX);
  const pts = points.map((p) => ({ x: p.x * work.scale, y: p.y * work.scale }));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * paddingRatio);
  minX = Math.max(0, Math.floor(minX) - pad);
  minY = Math.max(0, Math.floor(minY) - pad);
  maxX = Math.min(work.w, Math.ceil(maxX) + pad);
  maxY = Math.min(work.h, Math.ceil(maxY) + pad);

  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 1) || !(h > 1)) return null;

  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x - minX, pts[0].y - minY);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x - minX, pts[i].y - minY);
  }
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(work.canvas, -minX, -minY);
  ctx.restore();

  return out;
}

/** Canvas → Blob JPEG. */
export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob devolvió null"))),
      "image/jpeg",
      quality
    );
  });
}
