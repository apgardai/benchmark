import {BehaviorAssessment, TestAssessment} from "@korabench/benchmark";
import {toJsonSchema} from "@valibot/to-json-schema";
import {describe, expect, it} from "vitest";
import {ensureJsonSchemaTypes} from "../models/ensureJsonSchemaTypes.js";

function findNodesMissingType(
  schema: Record<string, unknown>,
  path = ""
): string[] {
  const missing: string[] = [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return missing;
  }

  const isSchemaNode =
    "properties" in schema ||
    "items" in schema ||
    "enum" in schema ||
    "const" in schema ||
    "minLength" in schema ||
    "minimum" in schema;

  if (
    isSchemaNode &&
    !("type" in schema) &&
    !("anyOf" in schema) &&
    !("oneOf" in schema) &&
    !("allOf" in schema)
  ) {
    missing.push(path || "root");
  }

  if (schema.properties && typeof schema.properties === "object") {
    for (const [key, value] of Object.entries(
      schema.properties as Record<string, unknown>
    )) {
      missing.push(
        ...findNodesMissingType(value as Record<string, unknown>, `${path}.${key}`)
      );
    }
  }

  if (schema.items && typeof schema.items === "object") {
    missing.push(
      ...findNodesMissingType(schema.items as Record<string, unknown>, `${path}[]`)
    );
  }

  for (const combiner of ["anyOf", "oneOf", "allOf"] as const) {
    const branch = schema[combiner];
    if (Array.isArray(branch)) {
      branch.forEach((item, index) => {
        missing.push(
          ...findNodesMissingType(
            item as Record<string, unknown>,
            `${path}.${combiner}[${index}]`
          )
        );
      });
    }
  }

  return missing;
}

describe("ensureJsonSchemaTypes", () => {
  it("adds string type to enum-only fields", () => {
    const raw = toJsonSchema(TestAssessment.io) as Record<string, unknown>;
    expect(findNodesMissingType(raw).length).toBeGreaterThan(0);

    const fixed = ensureJsonSchemaTypes(raw);
    expect(findNodesMissingType(fixed)).toEqual([]);
    expect((fixed.properties as Record<string, unknown>).grade).toMatchObject({
      type: "string",
      enum: ["failing", "adequate", "exemplary"],
    });
  });

  it("fixes nested grade enums in BehaviorAssessment", () => {
    const raw = toJsonSchema(BehaviorAssessment.io) as Record<string, unknown>;
    expect(findNodesMissingType(raw).length).toBeGreaterThan(0);

    const fixed = ensureJsonSchemaTypes(raw);
    expect(findNodesMissingType(fixed)).toEqual([]);
  });
});
