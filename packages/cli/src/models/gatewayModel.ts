import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import {gateway, generateText, jsonSchema, Output} from "ai";
import OpenAI from "openai";
import * as v from "valibot";
import {createLogRetryHandler, RetryOptions, withRetry} from "../retry.js";
import {Model} from "./model.js";
import {resolveModelConfig} from "./modelConfig.js";

export interface ModelOptions {
  retry?: RetryOptions;
}

const defaultRetryOptions: RetryOptions = {
  maxRetries: 8,
  initialDelayMs: 2000,
  maxDelayMs: 180000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
};

function buildRetryOptions(
  label: string,
  options?: ModelOptions
): Required<Pick<RetryOptions, "onRetry">> & RetryOptions {
  return {
    ...defaultRetryOptions,
    ...options?.retry,
    onRetry: options?.retry?.onRetry ?? createLogRetryHandler(label),
  };
}

function isGptModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized.startsWith("openai/gpt-") || normalized === "openai/gpt-4o";
}

function toOpenAiModelId(modelId: string): string {
  return modelId.startsWith("openai/") ? modelId.slice("openai/".length) : modelId;
}

function toOpenAiMessages(messages: ModelRequest["messages"]) {
  return messages.map(m => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }));
}

function getOpenAiReasoningEffort(
  providerOptions: Record<string, Record<string, unknown>> | undefined
): "low" | "medium" | "high" | undefined {
  const opts = providerOptions?.openai;
  if (!opts || typeof opts !== "object") return undefined;
  const effort = opts.reasoningEffort;
  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }
  return undefined;
}

function createOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({apiKey});
}

export function createGatewayModel(
  modelsJsonPath: string,
  modelSlug: string,
  options?: ModelOptions
): Model {
  const config = resolveModelConfig(modelsJsonPath, modelSlug);
  const retryOptions = buildRetryOptions(config.model, options);
  const isGpt = isGptModel(config.model);
  const openaiClient = isGpt ? createOpenAiClient() : null;
  const useOpenAiSdk = isGpt && openaiClient !== null;

  if (isGpt && !openaiClient) {
    console.warn(
      `[benchmark] OPENAI_API_KEY not set; using AI SDK gateway for GPT model "${config.model}". ` +
        `Set OPENAI_API_KEY to use the OpenAI SDK directly.`
    );
  }

  const openaiModelId = toOpenAiModelId(config.model);
  const openaiReasoningEffort = getOpenAiReasoningEffort(config.providerOptions);

  return {
    async getTextResponse(request: ModelRequest): Promise<string> {
      const maxTokens = request.maxTokens ?? config.maxTokens;
      const temperature = request.temperature ?? config.temperature;

      if (useOpenAiSdk && openaiClient) {
        const result = await withRetry(
          async () => {
            const response = await openaiClient.chat.completions.create({
              model: openaiModelId,
              messages: toOpenAiMessages(request.messages),
              max_completion_tokens: maxTokens,
              temperature,
              reasoning_effort: openaiReasoningEffort,
            });
            return response.choices[0]?.message?.content ?? "";
          },
          retryOptions
        );

        return result;
      }

      const result = await withRetry(
        () =>
          generateText({
            model: gateway(config.model),
            system: request.messages.find(m => m.role === "system")?.content,
            messages: request.messages
              .filter(m => m.role !== "system")
              .map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            maxOutputTokens: maxTokens,
            temperature,
            providerOptions: config.providerOptions as
              | Record<string, Record<string, never>>
              | undefined,
            maxRetries: 0,
          }),
        retryOptions
      );

      return result.text;
    },

    async getStructuredResponse<T>(request: TypedModelRequest<T>): Promise<T> {
      const outputSchema = toJsonSchema(request.outputType);
      const maxTokens = request.maxTokens ?? config.maxTokens;
      const temperature = request.temperature ?? config.temperature;

      if (useOpenAiSdk && openaiClient) {
        return withRetry(async () => {
          const response = await openaiClient.chat.completions.create({
            model: openaiModelId,
            messages: toOpenAiMessages(request.messages),
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "structured_output",
                schema: outputSchema as unknown as Record<string, unknown>,
                strict: true,
              },
            },
            max_completion_tokens: maxTokens,
            temperature,
            reasoning_effort: openaiReasoningEffort,
          });

          const text = response.choices[0]?.message?.content;
          if (!text) {
            throw new Error("OpenAI structured response did not include message content.");
          }

          return v.parse(request.outputType, JSON.parse(text));
        }, retryOptions);
      }

      return withRetry(async () => {
        const result = await generateText({
          model: gateway(config.model),
          system: request.messages.find(m => m.role === "system")?.content,
          messages: request.messages
            .filter(m => m.role !== "system")
            .map(m => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          output: Output.object({schema: jsonSchema(outputSchema)}),
          maxOutputTokens: maxTokens,
          temperature,
          providerOptions: config.providerOptions as any,
          maxRetries: 0,
        });

        return v.parse(request.outputType, result.output);
      }, retryOptions);
    },
  };
}
