import {
  createAuthoredDocument,
  type AuthoredDocument,
  type DocumentLimits,
  type DocumentValue,
} from '../authoring/document';

/** Creator-defined part selections and numeric parameters; no asset or body taxonomy is imposed. */
export type AppearanceValue = {
  readonly version: number;
  readonly parts: Readonly<Record<string, string>>;
  readonly parameters: Readonly<Record<string, number>>;
};
export interface AppearanceLimits extends DocumentLimits {
  maxParts: number;
  maxParameters: number;
}
export interface AppearanceOptions {
  id: string;
  json: string;
  /** Expected creator schema version. Migration happens explicitly before intake. */
  version: number;
  limits: AppearanceLimits;
  /** Allowed selections, ranges and compatibility. Only literal true accepts. */
  validate(value: AppearanceValue): boolean;
}
const record = (value: DocumentValue): value is {readonly [key: string]: DocumentValue} =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A schema adapter over the existing document owner, with no rendering or persistence side effects. */
export function createAppearanceDocument(options: AppearanceOptions): AuthoredDocument<AppearanceValue> {
  const {id, json, version, validate} = options;
  const {maxParts, maxParameters, maxBytes, maxNodes, maxDepth} = options.limits;
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    typeof validate !== 'function' ||
    ![maxParts, maxParameters].every(n => Number.isSafeInteger(n) && n >= 0)
  ) {
    throw Error('appearance: invalid configuration');
  }
  return createAuthoredDocument<AppearanceValue>({
    id,
    json,
    limits: {maxBytes, maxNodes, maxDepth},
    validate(value: DocumentValue): value is AppearanceValue {
      if (
        !record(value) ||
        Object.keys(value).length !== 3 ||
        value.version !== version ||
        !Object.hasOwn(value, 'version') ||
        !Object.hasOwn(value, 'parts') ||
        !Object.hasOwn(value, 'parameters') ||
        !record(value.parts!) ||
        !record(value.parameters!)
      )
        return false; // own keys checked just before
      const parts = Object.entries(value.parts),
        parameters = Object.entries(value.parameters);
      if (parts.length > maxParts || parameters.length > maxParameters) return false;
      for (const [key, part] of parts) if (!key || typeof part !== 'string' || !part) return false;
      for (const [key, parameter] of parameters)
        if (!key || typeof parameter !== 'number' || !Number.isFinite(parameter)) return false;
      return validate(value as AppearanceValue) === true;
    },
  });
}
