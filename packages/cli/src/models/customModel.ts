import {Scenario} from "@korabench/benchmark";
import {Model} from "./model.js";

const API_KEY_ENV_VAR = "CUSTOM_API_KEY";
/** Set per-run from the UI or benchmark/.env — not compiled in */
const ENDPOINT_ENV_VAR = "CUSTOM_MODEL_API_ENDPOINT";
const PARSING_KEY_ENV_VAR = "CUSTOM_MODEL_PARSING_KEY";
const INCLUDE_SYSTEM_PROMPT = true;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

function getParsingKey(): string {
  return process.env[PARSING_KEY_ENV_VAR]?.trim() || "message";
}

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function getApiEndpoint(): string {
  const url = process.env[ENDPOINT_ENV_VAR]?.trim();
  if (!url) {
    throw new Error(
      `Missing ${ENDPOINT_ENV_VAR}. Pass it from the benchmark UI when running a custom model.`
    );
  }
  return url;
}

export async function createCustomModel(
  _modelSlug: string,
  _scenario: Scenario
): Promise<Model> {
  const apiKey = process.env[API_KEY_ENV_VAR];
  if (!apiKey) {
    throw new Error(`Missing ${API_KEY_ENV_VAR} for custom model`);
  }

  async function fetchCustom(prompt: string): Promise<string> {
    const apiEndpoint = getApiEndpoint();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(apiEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({message: prompt}),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          throw new Error(`Custom model API error (${response.status}): ${errText}`);
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const plain = await response.text();
          if (plain.trim()) return plain;
          throw new Error("Custom model API returned an empty non-JSON response");
        }

        const data = (await response.json()) as {
          response?: string;
          message?: string;
          output?: string;
          text?: string;
          data?: {response?: string; message?: string; output?: string; text?: string};
        };
        const parsingKey = getParsingKey();
        const parsedByKey = getByPath(data, parsingKey);

        const text =
          (typeof parsedByKey === "string" ? parsedByKey : undefined) ??
          data.response ??
          data.message ??
          data.output ??
          data.text ??
          data.data?.response ??
          data.data?.message ??
          data.data?.output ??
          data.data?.text;

        if (!text) {
          throw new Error("Custom model API returned no text content");
        }
        return text;
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 800));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return `I am unable to answer right now due to upstream custom model connectivity issues (${lastError?.message ?? "unknown error"}).`;
  }

  return {
    async getTextResponse(request) {
      const parts = request.messages.map((m) => {
        if (!INCLUDE_SYSTEM_PROMPT && m.role === "system") return "";
        return `${m.role}: ${m.content}`;
      });
      const prompt = parts.filter(Boolean).join("\n");
      return fetchCustom(prompt);
    },

    async getStructuredResponse(request) {
      const parts = request.messages.map((m) => {
        if (!INCLUDE_SYSTEM_PROMPT && m.role === "system") return "";
        return `${m.role}: ${m.content}`;
      });
      const body = parts.filter(Boolean).join("\n");
      const prompt = `${body}\n\nReturn strictly valid JSON only.`;

      const rawText = await fetchCustom(prompt);
      try {
        return JSON.parse(rawText);
      } catch {
        throw new Error("Custom model structured response was not valid JSON");
      }
    },
  };
}
