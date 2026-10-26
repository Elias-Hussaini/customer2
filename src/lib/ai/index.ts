/** Public surface of the AI module (Cloudflare workers + extraction). */
export * from "./types";
export {
  aiChat,
  testWorker,
  getEnabledWorkers,
  extractReplyText,
  statusLabel,
  AiAllWorkersFailedError,
  type ChatMessage,
  type ContentPart,
  type ChatResult,
  type ChatOptions,
  type WorkerAttempt,
  type WorkerTestResult,
} from "./client";
export {
  ACCEPTED_MIME,
  MAX_FILE_BYTES,
  MAX_IMAGES_PER_REQUEST,
  MAX_PDF_PAGES,
  validateAiFile,
  imageFileToJpeg,
  pdfToJpegs,
  prepareFilesForAi,
} from "./imaging";
export {
  buildSystemPrompt,
  buildExtractionMessages,
  parseExtractionReply,
  extractJsonBlock,
  isIsoDate,
} from "./extract";
export {
  useAiWorkers,
  useAiSettings,
  addAiWorker,
  updateAiWorker,
  deleteAiWorker,
  moveAiWorker,
  updateAiSettings,
  type WorkerInput,
} from "./store";
