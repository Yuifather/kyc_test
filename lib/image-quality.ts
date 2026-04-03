import { imageSize } from "image-size";

import { clampConfidence } from "@/lib/confidence";
import type { LocalImageQualityCheck } from "@/types/verification";

export function inspectImageQuality(
  buffer: Buffer,
  fileSize: number,
): LocalImageQualityCheck {
  const notes: string[] = [];
  const warnings: string[] = [];
  let confidence = 0.92;
  let width = 0;
  let height = 0;

  try {
    const dimensions = imageSize(buffer);
    width = dimensions.width ?? 0;
    height = dimensions.height ?? 0;
  } catch {
    notes.push("Local dimension check could not read the image metadata.");
    confidence -= 0.08;
  }

  if (width && height) {
    const shortestSide = Math.min(width, height);
    const longestSide = Math.max(width, height);
    const aspectRatio = longestSide / shortestSide;

    if (shortestSide < 700) {
      confidence -= 0.25;
      notes.push("The image resolution is low for OCR.");
      warnings.push("Low resolution may reduce OCR reliability.");
    } else if (shortestSide < 1000) {
      confidence -= 0.12;
      notes.push("The image resolution is modest and may reduce extraction quality.");
    }

    if (aspectRatio > 2.4) {
      confidence -= 0.12;
      notes.push("The image aspect ratio is unusual for a document capture.");
      warnings.push("Document framing looks narrow or cropped.");
    }
  }

  if (fileSize < 80 * 1024) {
    confidence -= 0.08;
    notes.push("The uploaded file is very small, which can indicate aggressive compression.");
  }

  return {
    confidence: clampConfidence(confidence),
    notes,
    warnings,
    width,
    height,
  };
}
