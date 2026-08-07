import {ModelRequest, ModelResponse} from "@korabench/core";
import {describe, expect, it, vi} from "vitest";
import {TestContext} from "../benchmark.js";
import {childSafetyBench} from "../childSafetyBench.js";
import {ScenarioPrompt} from "../model/scenarioKey.js";
import {createScenario} from "./fixtures.js";

//
// Helpers.
//

function createTestContext(): TestContext {
  return {
    getUserResponse: vi.fn(
      async (_request: ModelRequest): Promise<ModelResponse> => ({
        output: "Follow-up question from user.",
      })
    ),
    getAssistantResponse: vi.fn(
      async (_request: ModelRequest): Promise<ModelResponse> => ({
        output: "Assistant response to the user.",
      })
    ),
    getJudgeResponse: vi.fn(async (_request: unknown) => ({
      output: {
        grade: "adequate",
        reasons:
          "The assistant responded appropriately to the child's request, maintaining a helpful and " +
          "supportive tone throughout the conversation while being mindful of the child's age and context.",
        anthropomorphism: {
          grade: "exemplary",
          occurrenceCount: 0,
          reasons:
            "The assistant used no anthropomorphic language and maintained appropriate boundaries as an AI assistant throughout the conversation.",
        },
        epistemicHumility: {
          grade: "exemplary",
          occurrenceCount: 0,
          reasons:
            "The assistant made no overconfident claims and appropriately hedged uncertain statements throughout the conversation exchange.",
        },
        humanRedirection: {
          grade: "adequate",
          occurrenceCount: 0,
          reasons:
            "The conversation was low-stakes and did not require redirection to trusted adults or other human professionals or guardians.",
        },
      },
    })) as TestContext["getJudgeResponse"],
  };
}

//
// Tests.
//

describe("childSafetyBench.runTest", () => {
  const scenario = createScenario();
  const keys = childSafetyBench.mapScenarioToKeys(scenario, ScenarioPrompt.list);
  const defaultKey = keys.find(k => k.endsWith(":default"))!;
  const childKey = keys.find(k => k.endsWith(":child"))!;

  it("produces a 3-turn conversation with 6 messages", async () => {
    const context = createTestContext();

    const result = await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(result.messages).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(result.messages[i]!.role).toBe(i % 2 === 0 ? "user" : "assistant");
    }
  });

  it("uses scenario.firstUserMessage for the first turn", async () => {
    const context = createTestContext();

    const result = await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(result.messages[0]!.content).toBe(scenario.firstUserMessage);
  });

  it("calls getUserResponse for subsequent turns (2 times)", async () => {
    const context = createTestContext();

    await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(context.getUserResponse).toHaveBeenCalledTimes(2);
  });

  it("calls getAssistantResponse 3 times (once per turn)", async () => {
    const context = createTestContext();

    await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(context.getAssistantResponse).toHaveBeenCalledTimes(3);
  });

  it("returns correct shape with scenario, prompt, messages, assessment, behaviorAssessment", async () => {
    const context = createTestContext();

    const result = await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(result).toHaveProperty("scenario");
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("assessment");
    expect(result).toHaveProperty("behaviorAssessment");
    expect(result.scenario).toBe(scenario);
  });

  it("prompt matches key — default key yields 'default' prompt", async () => {
    const context = createTestContext();

    const result = await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(result.prompt).toBe("default");
  });

  it("prompt matches key — child key yields 'child' prompt", async () => {
    const context = createTestContext();

    const result = await childSafetyBench.runTest(context, scenario, childKey);

    expect(result.prompt).toBe("child");
  });

  it("calls getJudgeResponse twice (safety + behavior assessment)", async () => {
    const context = createTestContext();

    await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(context.getJudgeResponse).toHaveBeenCalledTimes(2);
  });

  it("substitutes refusal fallback when target hits inappropriate-content filter", async () => {
    const context = createTestContext();
    const refused = new Error(
      "GatewayInternalServerError: Input data may contain inappropriate content. For details, see: https://www.alibabacloud.com/help/en/model-studio/error-code#inappropriate-content"
    );
    refused.name = "GatewayInternalServerError";
    vi.mocked(context.getAssistantResponse).mockRejectedValueOnce(refused);

    const result = await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(result.messages[1]!.role).toBe("assistant");
    expect(result.messages[1]!.content).toBe("I cannot help with that");
    expect(result.messages).toHaveLength(6);
  });

  it("substitutes refusal fallback on finishReason.unified TypeError", async () => {
    const context = createTestContext();
    vi.mocked(context.getAssistantResponse).mockRejectedValueOnce(
      new TypeError("Cannot read properties of undefined (reading 'unified')")
    );

    const result = await childSafetyBench.runTest(context, scenario, defaultKey);

    expect(result.messages[1]!.content).toBe("I cannot help with that");
  });

  it("propagates non-refusal target errors", async () => {
    const context = createTestContext();
    vi.mocked(context.getAssistantResponse).mockRejectedValueOnce(
      new Error("some unexpected failure")
    );

    await expect(
      childSafetyBench.runTest(context, scenario, defaultKey)
    ).rejects.toThrow("some unexpected failure");
  });
});
