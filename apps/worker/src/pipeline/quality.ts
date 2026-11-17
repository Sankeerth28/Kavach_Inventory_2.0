import type { PageQualityDto, QualityIssue, QualityReportDto } from '@kavach/shared';
import sharp from 'sharp';

/**
 * Document quality check before AI extraction (PRD §7.3 step 2).
 *
 * What is measured here, from the pixels: resolution, focus (blur), lighting and contrast.
 * Orientation from the camera's EXIF tag is corrected, not reported. What pixels cannot tell
 * (a cropped page, missing pages, a document photographed sideways, heavy shadows) is reported
 * by the model during extraction and merged into the same report.
 *
 * A handwritten document is never rejected for being handwritten: nothing here looks at the
 * kind of writing, and the thresholds were set so that the handwritten samples pass.
 */
export const QUALITY_THRESHOLDS = {
  /** Long side in pixels below which text is too small to read. */
  minLongSide: 600,
  /** Long side below which a warning is given but extraction still runs. */
  warnLongSide: 1000,
  /** Variance of the Laplacian on a 1024-px greyscale copy. Below: out of focus. */
  minSharpness: 40,
  /** Mean brightness (0–255) below which the photo is too dark. */
  minBrightness: 55,
  /** Standard deviation of brightness below which there is no contrast to read. */
  minContrast: 14,
} as const;

const ADVICE: Record<QualityIssue, string> = {
  BLURRY: 'The photo is out of focus. Hold the phone steady and retake it.',
  LOW_RESOLUTION: 'The image is too small to read. Move closer or use a higher camera quality.',
  POOR_LIGHTING: 'The photo is too dark or washed out. Retake it in better light.',
  WRONG_ORIENTATION: 'The document is sideways or upside down. Retake it upright.',
  CROPPED: 'Part of the document is cut off. Retake it with all four edges in view.',
  MISSING_PAGES: 'Some pages seem to be missing. Add every page of the document.',
  SHADOWS: 'Shadows cover part of the document. Retake it without a shadow across the page.',
  UNREADABLE: 'The document cannot be read. Retake a clear photo or upload the PDF.',
};

/** Issues that stop processing until the user retakes the photo or chooses to go on (Q27). */
const BLOCKING: ReadonlySet<QualityIssue> = new Set(['BLURRY', 'POOR_LIGHTING', 'UNREADABLE']);

export function adviceFor(issues: readonly QualityIssue[]): string[] {
  return [...new Set(issues)].map((i) => ADVICE[i]);
}

export interface ImageMeasurement {
  widthPx: number;
  heightPx: number;
  sharpness: number;
  brightness: number;
  contrast: number;
}

/** Variance of a 4-neighbour Laplacian: high for crisp edges (text), near zero for a blur. */
function laplacianVariance(px: Uint8Array | Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const v = px[i - width]! + px[i + width]! + px[i - 1]! + px[i + 1]! - 4 * px[i]!;
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export async function measureImage(data: Buffer): Promise<ImageMeasurement> {
  const upright = sharp(data, { failOn: 'error' }).rotate();
  const meta = await upright.metadata();
  // After .rotate() the output is upright, but metadata still describes the stored orientation.
  const swap = (meta.orientation ?? 1) >= 5;
  const widthPx = (swap ? meta.height : meta.width) ?? 0;
  const heightPx = (swap ? meta.width : meta.height) ?? 0;

  const { data: px, info } = await sharp(data)
    .rotate()
    .greyscale()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < px.length; i += 1) {
    sum += px[i]!;
    sumSq += px[i]! * px[i]!;
  }
  const brightness = sum / px.length;
  const contrast = Math.sqrt(Math.max(0, sumSq / px.length - brightness * brightness));
  return {
    widthPx,
    heightPx,
    sharpness: laplacianVariance(px, info.width, info.height),
    brightness,
    contrast,
  };
}

export function judgeImage(m: ImageMeasurement): PageQualityDto {
  const issues: QualityIssue[] = [];
  const longSide = Math.max(m.widthPx, m.heightPx);
  const tooSmall = longSide < QUALITY_THRESHOLDS.minLongSide;
  if (longSide < QUALITY_THRESHOLDS.warnLongSide) issues.push('LOW_RESOLUTION');
  if (m.sharpness < QUALITY_THRESHOLDS.minSharpness) issues.push('BLURRY');
  if (
    m.brightness < QUALITY_THRESHOLDS.minBrightness ||
    m.contrast < QUALITY_THRESHOLDS.minContrast
  ) {
    issues.push('POOR_LIGHTING');
  }
  const ok = !tooSmall && !issues.some((i) => BLOCKING.has(i));
  return { ok, issues, advice: adviceFor(issues), widthPx: m.widthPx, heightPx: m.heightPx };
}

/** A PDF is not measured: a generated PDF is sharp, and a scanned one is judged by the model. */
export function pdfQuality(): PageQualityDto {
  return { ok: true, issues: [], advice: [], widthPx: null, heightPx: null };
}

export async function assessImage(data: Buffer): Promise<PageQualityDto> {
  try {
    return judgeImage(await measureImage(data));
  } catch {
    return {
      ok: false,
      issues: ['UNREADABLE'],
      advice: adviceFor(['UNREADABLE']),
      widthPx: null,
      heightPx: null,
    };
  }
}

/** Upright, at most 2200 px on the long side, JPEG: what is sent to the model. */
export async function prepareImage(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .rotate()
    .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

export function combineQuality(
  pages: readonly PageQualityDto[],
  model?: { readable: boolean; issues: QualityIssue[]; note: string | null; handwritten: boolean },
): QualityReportDto {
  const issues = new Set<QualityIssue>();
  for (const p of pages) for (const i of p.issues) issues.add(i);
  for (const i of model?.issues ?? []) issues.add(i);
  if (model && !model.readable) issues.add('UNREADABLE');
  const list = [...issues];
  return {
    ok: pages.every((p) => p.ok) && (model?.readable ?? true),
    issues: list,
    advice: adviceFor(list),
    handwritten: model?.handwritten ?? false,
    note: model?.note ?? null,
  };
}
