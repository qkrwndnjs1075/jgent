import Ajv, { type JSONSchemaType } from "ajv"

export type ToolValidationResult<TInput extends object> =
  | {
      readonly valid: true
      readonly input: Readonly<TInput>
    }
  | {
      readonly valid: false
      readonly error: string
    }

export interface ToolValidator {
  readonly validate: <TInput extends object>(
    schema: JSONSchemaType<TInput>,
    input: unknown,
  ) => ToolValidationResult<TInput>
}

export class AjvToolValidator implements ToolValidator {
  readonly #ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    strict: true,
    useDefaults: false,
  })

  validate<TInput extends object>(
    schema: JSONSchemaType<TInput>,
    input: unknown,
  ): ToolValidationResult<TInput> {
    const validate = this.#ajv.compile<TInput>(schema)

    if (!validate(input)) {
      return {
        valid: false,
        error: this.#ajv.errorsText(validate.errors, { separator: "; " }),
      }
    }

    return { valid: true, input }
  }
}
