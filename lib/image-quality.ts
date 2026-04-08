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
    notes.push(
      "\ub85c\uceec \uc774\ubbf8\uc9c0 \ud06c\uae30 \ubd84\uc11d\uc5d0\uc11c \uba54\ud0c0\ub370\uc774\ud130\ub97c \uc77d\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.",
    );
    confidence -= 0.08;
  }

  if (width && height) {
    const shortestSide = Math.min(width, height);

    if (shortestSide < 420) {
      confidence -= 0.2;
      notes.push("\uc774\ubbf8\uc9c0 \ud574\uc0c1\ub3c4\uac00 \ub9e4\uc6b0 \ub0ae\uc544 OCR \uc815\ud655\ub3c4\uc5d0 \ubd88\ub9ac\ud569\ub2c8\ub2e4.");
      warnings.push("\ud574\uc0c1\ub3c4\uac00 \ub0ae\uc544 OCR \uc2e0\ub8b0\ub3c4\uac00 \ub5a8\uc5b4\uc9c8 \uc218 \uc788\uc2b5\ub2c8\ub2e4.");
    } else if (shortestSide < 640) {
      confidence -= 0.08;
      notes.push(
        "\uc774\ubbf8\uc9c0 \ud574\uc0c1\ub3c4\uac00 \ucda9\ubd84\ud788 \ub192\uc9c0 \uc54a\uc544 OCR \uc815\ud655\ub3c4\uac00 \ub2e4\uc18c \ub5a8\uc5b4\uc9c8 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
      );
    }
  }

  if (fileSize < 45 * 1024) {
    confidence -= 0.08;
    notes.push(
      "\uc5c5\ub85c\ub4dc\ud55c \ud30c\uc77c \ud06c\uae30\uac00 \ub9e4\uc6b0 \uc791\uc544 \uacfc\ub3c4\ud55c \uc555\ucd95\uc774 \uc788\uc5c8\uc744 \uac00\ub2a5\uc131\uc774 \uc788\uc2b5\ub2c8\ub2e4.",
    );
  }

  return {
    confidence: clampConfidence(confidence),
    notes,
    warnings,
    width,
    height,
  };
}
