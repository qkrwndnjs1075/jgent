import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses"

export type OpenAIRequest = ResponseCreateParamsNonStreaming
export type OpenAIModel = NonNullable<OpenAIRequest["model"]>
