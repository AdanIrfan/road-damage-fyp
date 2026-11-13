/** Shape of every successful API response. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

/** Details of an API error. `stack` is only ever included in development. */
export interface ApiErrorDetails {
  code: string;
  message: string;
  stack?: string;
}

/** Shape of every error API response. */
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetails;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
