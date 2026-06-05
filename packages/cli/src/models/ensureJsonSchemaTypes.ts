type JsonSchema = Record<string, unknown>;

/**
 * Vertex AI / Google Gemini structured output requires an explicit `type` on every
 * schema node. Valibot's `toJsonSchema` omits `type` on enum-only fields.
 */
export function ensureJsonSchemaTypes(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  const result: JsonSchema = {...schema};

  if ("enum" in result && !("type" in result)) {
    result.type = "string";
  }

  if ("const" in result && !("type" in result)) {
    result.type = typeof result.const === "number" ? "number" : "string";
  }

  if (
    ("minLength" in result || "maxLength" in result || "pattern" in result) &&
    !("type" in result)
  ) {
    result.type = "string";
  }

  if (
    ("minimum" in result || "maximum" in result || "multipleOf" in result) &&
    !("type" in result)
  ) {
    result.type = "number";
  }

  if ("properties" in result && typeof result.properties === "object") {
    result.properties = Object.fromEntries(
      Object.entries(result.properties as Record<string, JsonSchema>).map(
        ([key, value]) => [key, ensureJsonSchemaTypes(value)]
      )
    );
    if (
      !("type" in result) &&
      !("anyOf" in result) &&
      !("oneOf" in result) &&
      !("allOf" in result)
    ) {
      result.type = "object";
    }
  }

  if ("items" in result && result.items && typeof result.items === "object") {
    result.items = ensureJsonSchemaTypes(result.items as JsonSchema);
    if (!("type" in result)) {
      result.type = "array";
    }
  }

  for (const combiner of ["anyOf", "oneOf", "allOf"] as const) {
    const branch = result[combiner];
    if (Array.isArray(branch)) {
      result[combiner] = branch.map(item =>
        ensureJsonSchemaTypes(item as JsonSchema)
      );
    }
  }

  if (
    "additionalProperties" in result &&
    result.additionalProperties &&
    typeof result.additionalProperties === "object" &&
    !Array.isArray(result.additionalProperties)
  ) {
    result.additionalProperties = ensureJsonSchemaTypes(
      result.additionalProperties as JsonSchema
    );
  }

  return result;
}
