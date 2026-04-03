import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  client ??= new OpenAI({ apiKey });
  return client;
}

export function getModelCandidates() {
  return Array.from(
    new Set(
      [
        process.env.OPENAI_MODEL?.trim(),
        "gpt-5.4-mini",
        "gpt-4.1-mini",
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}
