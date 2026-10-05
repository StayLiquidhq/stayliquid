export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogPrimitive = string | number | boolean | null | undefined;

export type LogValue = LogPrimitive | LogPrimitive[] | Record<string, LogPrimitive>;

export interface ErrorDetailsObject {
  name?: string;
  message?: string;
  stack?: string;
  code?: string | number;
}

export type LoggableError =
  | Error
  | ErrorDetailsObject
  | string
  | null;

export interface LogContext {
  module?: string;
  action?: string;
  walletAddress?: string;
  planId?: string;
  signature?: string;
  durationMs?: number;
  [key: string]: LogValue;
}

interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

function isString(val: LoggableError | undefined): val is string {
  return typeof val === "string";
}

function isErrorDetailsObject(val: LoggableError): val is ErrorDetailsObject {
  return typeof val === "object" && val !== null && !(val instanceof Error);
}

function formatError(err?: LoggableError): { name: string; message: string; stack?: string } | undefined {
  if (!err) return undefined;

  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    };
  }

  if (isString(err)) {
    return { name: "Error", message: err };
  }

  if (isErrorDetailsObject(err)) {
    const rawName = err.name;
    const errorName = isString(rawName) ? rawName : "Error";

    const rawMessage = err.message;
    const errorMessage = isString(rawMessage) ? rawMessage : JSON.stringify(err);

    const rawStack = err.stack;
    const errorStack = isString(rawStack) && process.env.NODE_ENV === "development" ? rawStack : undefined;

    return {
      name: errorName,
      message: errorMessage,
      stack: errorStack,
    };
  }

  return undefined;
}

function emitLog(level: LogLevel, message: string, context?: LogContext, err?: LoggableError): void {
  const isDev = process.env.NODE_ENV === "development";

  const logObj: StructuredLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    error: formatError(err),
  };

  if (isDev) {
    const prefix = `[${logObj.timestamp}] [${level.toUpperCase()}]${
      context?.module ? ` [${context.module}]` : ""
    }`;

    const extra = context ? ` | context: ${JSON.stringify(context)}` : "";

    if (level === "error") {
      console.error(`${prefix} ${message}${extra}`, err ?? "");
    } else if (level === "warn") {
      console.warn(`${prefix} ${message}${extra}`);
    } else if (level === "debug") {
      console.debug(`${prefix} ${message}${extra}`);
    } else {
      console.log(`${prefix} ${message}${extra}`);
    }
  } else {
    const jsonStr = JSON.stringify(logObj);

    if (level === "error") {
      console.error(jsonStr);
    } else if (level === "warn") {
      console.warn(jsonStr);
    } else {
      console.log(jsonStr);
    }
  }
}

export const logger = {
  debug: (message: string, context?: LogContext): void => emitLog("debug", message, context),
  info: (message: string, context?: LogContext): void => emitLog("info", message, context),
  warn: (message: string, context?: LogContext, err?: LoggableError): void => emitLog("warn", message, context, err),
  error: (message: string, context?: LogContext, err?: LoggableError): void => emitLog("error", message, context, err),
};
