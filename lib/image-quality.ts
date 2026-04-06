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
    notes.push("로컬 이미지 크기 점검에서 메타데이터를 읽지 못했습니다.");
    confidence -= 0.08;
  }

  if (width && height) {
    const shortestSide = Math.min(width, height);
    const longestSide = Math.max(width, height);
    const aspectRatio = longestSide / shortestSide;

    if (shortestSide < 700) {
      confidence -= 0.25;
      notes.push("이미지 해상도가 낮아 OCR 정확도에 불리합니다.");
      warnings.push("해상도가 낮아 OCR 신뢰도가 떨어질 수 있습니다.");
    } else if (shortestSide < 1000) {
      confidence -= 0.12;
      notes.push("이미지 해상도가 충분히 높지 않아 추출 품질이 낮아질 수 있습니다.");
    }

    if (aspectRatio > 2.4) {
      confidence -= 0.12;
      notes.push("문서 촬영치고는 이미지 비율이 비정상적입니다.");
      warnings.push("문서 프레이밍이 좁거나 일부가 잘렸을 수 있습니다.");
    }
  }

  if (fileSize < 80 * 1024) {
    confidence -= 0.08;
    notes.push("업로드한 파일 크기가 매우 작아 과도한 압축이 있었을 가능성이 있습니다.");
  }

  return {
    confidence: clampConfidence(confidence),
    notes,
    warnings,
    width,
    height,
  };
}
