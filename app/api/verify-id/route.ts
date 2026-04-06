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
      "Too many verification attempts. Please try again later.",
      429,
      rateLimit.retryAfterSeconds,
    );
  }

  try {
    const formData = await request.formData();
    const englishName = String(formData.get("englishName") ?? "");
    const countryHint = String(formData.get("countryHint") ?? "");
    const documentTypeHint = String(formData.get("documentTypeHint") ?? "");
    const frontFile = formData.get("frontImage");
    const backFile = formData.get("backImage");

    if (!(frontFile instanceof File)) {
      throw new VerificationError(
        400,
        "Upload the front image of the ID.",
        "No front image file was provided.",
      );
    }

    const result = await verifyIdDocument({
      englishName,
      countryHint,
      documentTypeHint,
      frontFile,
      backFile: backFile instanceof File ? backFile : undefined,
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
      return jsonError("The server is missing OPENAI_API_KEY.", 500);
    }

    console.error("ID verification failed:", error);
    return jsonError(
      "An error occurred while analyzing the ID images. Check the uploaded files and try again.",
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
