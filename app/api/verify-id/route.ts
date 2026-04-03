import { NextResponse } from "next/server";

import { VerificationError, verifyIdDocument } from "@/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REQUEST_WINDOW_MS = 10 * 60 * 1000;
const REQUEST_LIMIT = 10;

const requestLog = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  const rateLimit = enforceRateLimit(getClientKey(request));

  if (!rateLimit.allowed) {
    return jsonError(
      "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      429,
      rateLimit.retryAfterSeconds,
    );
  }

  try {
    const formData = await request.formData();
    const englishName = String(formData.get("englishName") ?? "");
    const countryHint = String(formData.get("countryHint") ?? "");
    const documentTypeHint = String(formData.get("documentTypeHint") ?? "");
    const file = formData.get("image");

    if (!(file instanceof File)) {
      throw new VerificationError(
        400,
        "신분증 이미지를 먼저 업로드해주세요.",
        "No image file was provided.",
      );
    }

    const result = await verifyIdDocument({
      englishName,
      countryHint,
      documentTypeHint,
      file,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof VerificationError) {
      return jsonError(error.userMessage, error.statusCode);
    }

    if (error instanceof Error && error.message.includes("OPENAI_API_KEY")) {
      return jsonError("서버에 OpenAI API 키가 아직 설정되지 않았습니다.", 500);
    }

    console.error("ID verification failed:", error);
    return jsonError(
      "신분증을 분석하는 중 문제가 발생했습니다. 이미지를 다시 확인한 뒤 재시도해주세요.",
      500,
    );
  }
}

function enforceRateLimit(clientKey: string) {
  const now = Date.now();
  const existing = requestLog.get(clientKey);

  if (!existing || existing.resetAt <= now) {
    requestLog.set(clientKey, {
      count: 1,
      resetAt: now + REQUEST_WINDOW_MS,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= REQUEST_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  requestLog.set(clientKey, existing);
  return { allowed: true, retryAfterSeconds: 0 };
}

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "local";
  }

  return request.headers.get("x-real-ip") ?? "local";
}

function jsonError(message: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(retryAfterSeconds
          ? { "Retry-After": String(retryAfterSeconds) }
          : {}),
      },
    },
  );
}
