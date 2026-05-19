import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020, { type ErrorObject, type AnySchemaObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export interface ValidationResult {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
}

/**
 * Centralized ajv (Draft 2020-12) wrapper that knows how to resolve
 * shared/_common.schema.json $refs.
 */
export class Validator {
  private ajv: Ajv2020;
  private compiled = new Map<string, ReturnType<Ajv2020['compile']>>();

  constructor(private schemasDir: string) {
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      loadSchema: undefined,
    });
    addFormats(this.ajv as unknown as Parameters<typeof addFormats>[0]);

    const commonPath = resolve(schemasDir, '_common.schema.json');
    const common = JSON.parse(readFileSync(commonPath, 'utf-8')) as AnySchemaObject;
    this.ajv.addSchema(common, '_common.schema.json');
  }

  validate(schemaPath: string, data: unknown): ValidationResult {
    let v = this.compiled.get(schemaPath);
    if (!v) {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as AnySchemaObject;
      v = this.ajv.compile(schema);
      this.compiled.set(schemaPath, v);
    }
    const ok = v(data) as boolean;
    if (ok) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: (v.errors ?? []).map((e: ErrorObject) => ({
        path: e.instancePath || '/',
        message: `${e.keyword}: ${e.message ?? ''}${
          e.params ? ' ' + JSON.stringify(e.params) : ''
        }`,
      })),
    };
  }
}
