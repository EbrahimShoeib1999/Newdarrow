import { SetMetadata } from "@nestjs/common";

export const RESPONSE_MESSAGE_KEY = "darrow:response:message";

/**
 * Sets the human-readable `message` field of the ApiResponse envelope for a route handler.
 * Mirrors the frontend contract `ApiResponse<T> = { data: T; message: string }`.
 */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);
