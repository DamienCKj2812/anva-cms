interface ApiResponse<T = any> {
  status: "success" | "error";
  data?: T;
  message?: string;
  error?: string;
}

export const successResponse = <T>(data?: T, metadata?: Record<string, any>): ApiResponse<T> => {
  return {
    status: "success",
    data,
    ...(metadata ? { metadata } : {}),
  };
};

export const errorResponse = (message: string, error: any): ApiResponse<null> => {
  return {
    status: "error",
    message,
    error,
  };
};
