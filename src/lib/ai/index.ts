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
export { isLatinName, latinToPersianName } from "./translit";
export {
  buildDocSortSystemPrompt,
  buildDocSortMessages,
  parseDocSortReply,
  extractJsonArray,
  sanitizeNewSlotLabel,
  resolveActions,
  buildChunks,
  chunkLocalGroups,
  DOC_SORT_CHUNK,
  type DocSlotOption,
  type DocSortResult,
  type DocSortTarget,
  type SortPiece,
  type SortOriginal,
  type SortAction,
} from "./docsort";
export {
  splitCombinedImage,
  isBlankImage,
  findGutterBands,
  findGutterRuns,
  bandSlicesContent,
  stripInkStats,
  type LineProfile,
  type GutterOptions,
  type GutterRun,
  type GrayImage,
  type SplitReport,
  type StripStats,
} from "./split";
export {
  useAiWorkers,
  useAiSettings,
  addAiWorker,
  updateAiWorker,
  deleteAiWorker,
  moveAiWorker,
  updateAiSettings,
  setAiFieldEnabled,
  setAllAiFields,
  type WorkerInput,
} from "./store";
