import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import { decryptApiKey } from './crypto.service';

const prisma = new PrismaClient();

export async function getActiveGeminiApiKey(): Promise<string> {
  const activeKeyRecord = await prisma.apiKey.findFirst({
    where: { service: 'GEMINI', isActive: true },
    orderBy: { createdAt: 'desc' }
  });

  if (activeKeyRecord) {
    try {
      const decrypted = decryptApiKey(activeKeyRecord.encryptedKey, activeKeyRecord.iv);
      if (decrypted && !decrypted.includes('placeholder') && decrypted.length > 15) {
        return decrypted;
      }
    } catch (e) {
      console.error('Error decrypting API key from database, falling back to ENV', e);
    }
  }

  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && !envKey.includes('placeholder') && envKey.length > 15) {
    return envKey;
  }

  // If DB record was placeholder, return DB key anyway for descriptive API error
  if (activeKeyRecord) {
    try {
      return decryptApiKey(activeKeyRecord.encryptedKey, activeKeyRecord.iv);
    } catch (e) {}
  }

  throw new Error('No valid Gemini API key found in Database or process.env.GEMINI_API_KEY');
}

export async function getGeminiClient(): Promise<GoogleGenAI> {
  const apiKey = await getActiveGeminiApiKey();
  return new GoogleGenAI({ apiKey });
}

// 1. Synchronous File Search Store creation / retrieval for Client or Bot
export async function ensureFileSearchStore(storeDisplayName: string): Promise<string> {
  const ai = await getGeminiClient();
  
  // Try listing stores to see if it already exists
  try {
    const storesResponse = await (ai as any).fileSearchStores.list();
    const stores = storesResponse.fileSearchStores || [];
    const existing = stores.find((s: any) => s.displayName === storeDisplayName);
    if (existing) {
      return existing.name;
    }
  } catch (e) {
    console.warn('Could not list stores, attempting to create direct store:', e);
  }

  // Create store
  const newStore = await (ai as any).fileSearchStores.create({
    displayName: storeDisplayName
  });

  return newStore.name;
}

export async function deleteFileSearchStore(storeName: string): Promise<void> {
  const ai = await getGeminiClient();
  try {
    await (ai as any).fileSearchStores.delete({ name: storeName });
  } catch (e) {
    console.warn(`Could not delete store ${storeName}:`, e);
  }
}

function normalizeMimeType(fileName: string, rawMimeType: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';

  if (ext === 'pdf' || rawMimeType === 'application/pdf') {
    return 'application/pdf';
  }
  if (ext === 'html' || ext === 'htm' || rawMimeType === 'text/html') {
    return 'text/html';
  }
  if (ext === 'md' || ext === 'markdown' || rawMimeType === 'text/markdown') {
    return 'text/markdown';
  }

  // All other file formats (csv, json, docx, txt, rtf, log, etc.) must be sent as text/plain
  // to avoid Google API 400 INVALID_ARGUMENT errors.
  return 'text/plain';
}

// 2. Upload file directly to Google File Search Store using correct SDK method
export async function uploadFileToStore(
  storeName: string,
  filePath: string,
  fileName: string,
  mimeType: string,
  folderTag?: string
) {
  const ai = await getGeminiClient();

  const finalMimeType = normalizeMimeType(fileName, mimeType);

  const customMetadata: Array<{ key: string; stringValue: string }> = [];
  if (folderTag) {
    customMetadata.push({ key: 'folderTag', stringValue: folderTag });
  }

  // Use the correct single-step method: uploadToFileSearchStore
  const result = await ai.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName: storeName,
    file: filePath,
    config: {
      mimeType: finalMimeType,
      displayName: fileName,
      customMetadata: customMetadata.length > 0 ? customMetadata : undefined
    }
  });

  return result;
}

// ===== IN-MEMORY КЕШ РЕЗУЛЬТАТОВ listFilesFromStore (TTL 60 сек) =====
const storeDocsCache: Map<string, { docs: any[]; cachedAt: number }> = new Map();
const STORE_CACHE_TTL_MS = 60_000; // 60 секунд

/** Инвалидировать кеш конкретного хранилища (вызывается при загрузке/удалении файлов) */
export function invalidateStoreCache(storeName: string) {
  storeDocsCache.delete(storeName);
}

// 3. List documents from Google File Search Store (с кешированием)
export async function listFilesFromStore(storeName: string) {
  // Проверяем кеш
  const cached = storeDocsCache.get(storeName);
  if (cached && (Date.now() - cached.cachedAt) < STORE_CACHE_TTL_MS) {
    return cached.docs;
  }

  const ai = await getGeminiClient();
  try {
    const pager = await (ai as any).fileSearchStores.documents.list({ parent: storeName });
    const docs: any[] = [];
    for await (const doc of pager) {
      docs.push(doc);
    }
    // Сохраняем в кеш
    storeDocsCache.set(storeName, { docs, cachedAt: Date.now() });
    return docs;
  } catch (error) {
    console.error(`Error fetching documents for store ${storeName}:`, error);
    return [];
  }
}

// 4. Delete document from Google File Search Store
export async function deleteFileFromStore(documentName: string) {
  const ai = await getGeminiClient();
  try {
    await (ai as any).fileSearchStores.documents.delete({ name: documentName });
  } catch (error: any) {
    if (!String(error?.message || error).includes('404') && !String(error?.message || error).includes('NOT_FOUND')) {
      throw error;
    }
  }
}

// Heuristic: detect short greeting/small-talk messages that don't need RAG
const GREETING_PATTERN = /^(привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро|как дела|спасибо|благодарю|пока|до свидания|всё в порядке|всё хорошо|ок|хорошо|понял|понятно|приветствую|расскажи о себе|кто ты|что ты умеешь|помоги мне)([\s!?.]*)?$/i;

function shouldBypassRAG(question: string): boolean {
  const trimmed = question.trim();
  // Short messages (< 25 chars) that match greeting pattern skip RAG entirely
  return trimmed.length < 25 && GREETING_PATTERN.test(trimmed);
}

// 5. Generate content with explicit model selection, AUTO fileSearch, granular timing
export async function generateRAGAnswer(params: {
  systemInstruction: string;
  botStoreName?: string;
  clientStoreName?: string;
  historyMessages: Array<{ role: 'user' | 'model'; content: string }>;
  currentQuestion: string;
  modelName?: string; // Explicit model from Bot settings
}) {
  const ai = await getGeminiClient();
  const startTime = Date.now();
  const modelName = params.modelName || 'gemini-2.0-flash';

  // Determine if RAG stores should be used for this request
  const storeNames: string[] = [];
  const bypassRAG = shouldBypassRAG(params.currentQuestion);

  if (!bypassRAG) {
    if (params.botStoreName) {
      const docs = await listFilesFromStore(params.botStoreName);
      if (docs.length > 0) storeNames.push(params.botStoreName);
    }
    if (params.clientStoreName) {
      const docs = await listFilesFromStore(params.clientStoreName);
      if (docs.length > 0) storeNames.push(params.clientStoreName);
    }
  }

  const fileSearchUsed = storeNames.length > 0;

  const contents = params.historyMessages.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }]
  }));
  contents.push({
    role: 'user',
    parts: [{ text: params.currentQuestion }]
  });

  // Build tools array with AUTO mode — model itself decides when to invoke fileSearch
  const tools: any[] = [];
  if (fileSearchUsed) {
    tools.push({
      fileSearch: {
        fileSearchStoreNames: storeNames
      }
    });
  }

  // Build Dual-RAG Instruction Hierarchy based on active stores
  let effectiveSystemInstruction = params.systemInstruction;
  const isBotStoreActive = storeNames.includes(params.botStoreName || '');
  const isClientStoreActive = storeNames.includes(params.clientStoreName || '');

  // Определяем режим RAG для диагностики
  let ragMode: 'NONE' | 'BOT_ONLY' | 'CLIENT_ONLY' | 'DUAL_RAG' = 'NONE';
  if (isBotStoreActive && isClientStoreActive) {
    ragMode = 'DUAL_RAG';
  } else if (isBotStoreActive) {
    ragMode = 'BOT_ONLY';
  } else if (isClientStoreActive) {
    ragMode = 'CLIENT_ONLY';
  }

  // Подмешиваем контекстную иерархию в зависимости от режима
  if (ragMode === 'DUAL_RAG') {
    // Пункт 4: Читаем пользовательский промпт из SystemSettings, если задан
    let dualRagPromptTemplate: string | null = null;
    try {
      const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
      dualRagPromptTemplate = settings?.dualRagPrompt || null;
    } catch (e) {}

    if (dualRagPromptTemplate && dualRagPromptTemplate.trim().length > 0) {
      effectiveSystemInstruction += `\n\n${dualRagPromptTemplate}`;
    } else {
      // Стандартный шаблон по умолчанию
      effectiveSystemInstruction += `\n\n--- [DUAL-RAG CONTEXT HIERARCHY] ---
Тебе доступны два типа знаний:
1. 📘 [БАЗА ЗНАНИЙ АССИСТЕНТА]: Методология, стандарты и правила. Используй их как ЕДИНЫЙ ЭТАЛОН И ПРАВИЛА.
2. 📄 [ДОКУМЕНТЫ ПОЛЬЗОВАТЕЛЯ]: Исходные факты и данные бизнеса. Анализируй их строго по правилам из Базы Ассистента.

При формировании ответа:
- Если данные из документов пользователя противоречат правилам Ассистента, обязательно явно укажи на это несоответствие.
- Внимательно разделяй: что является правилом/методикой (из базы бота), а что — фактом (из документов пользователя).`;
    }
  } else if (ragMode === 'CLIENT_ONLY') {
    effectiveSystemInstruction += `\n\n--- [RAG CONTEXT: ДОКУМЕНТЫ ПОЛЬЗОВАТЕЛЯ] ---
Тебе доступны документы, загруженные пользователем. Это справочный источник данных.
Анализируй их критически, опираясь на свою профессиональную экспертизу из системной инструкции.
Не принимай данные из документов за абсолютную истину — проверяй их на логическую согласованность.`;
  }

  // Общее правило чистоты ответа без технического мусора
  effectiveSystemInstruction += `\n\n--- [ПРАВИЛА ОФОРМЛЕНИЯ И ИСТОЧНИКОВ] ---
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вставлять в текст ответа служебные скобки вида *(Источник: ...)* или встроенные технические названия файлов.
Пиши чистый, эстетичный бизнес-текст без текстовых сносок в скобках — все цитируемые источники автоматически выводятся в нижней панели веб-интерфейса.`;

  // Retry only on the SAME model — no cross-model fallback
  let lastError: any = null;
  const retrievalStart = Date.now();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await (ai as any).models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction: effectiveSystemInstruction,
          tools: tools.length > 0 ? tools : undefined,
          // AUTO mode: model decides on its own whether to invoke fileSearch tool
          toolConfig: tools.length > 0 ? {
            functionCallingConfig: { mode: 'AUTO' }
          } : undefined
        }
      });

      const retrievalTimeMs = Date.now() - retrievalStart;
      const generationStart = Date.now();

      const candidateText = response.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n');
      const finishReason = response.candidates?.[0]?.finishReason || 'STOP';

      // Content fallback: guarantee non-empty text at all times
      const text = response.text || candidateText || 'Я здесь и готов помочь с вопросами по вашей Библиотеке бизнеса.';
      let groundingMetadata = response.candidates?.[0]?.groundingMetadata || null;

      // Enhance groundingMetadata with dual-RAG origin labels
      if (groundingMetadata) {
        groundingMetadata = {
          ...groundingMetadata,
          dualRagSources: {
            hasBotMethodology: isBotStoreActive,
            hasClientData: isClientStoreActive
          }
        };
      }

      const generationTimeMs = Date.now() - generationStart;
      const responseTime = Date.now() - startTime;

      return {
        text,
        groundingMetadata,
        responseTime,
        retrievalTimeMs,
        generationTimeMs,
        modelName,
        finishReason,
        fileSearchUsed,
        ragMode,
        queryLength: params.currentQuestion.length,
        status: 'SUCCESS' as const
      };
    } catch (error: any) {
      lastError = error;
      const errMsg = error?.message || String(error);

      // Quota errors — do NOT retry, fail fast
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        console.warn(`[Gemini RAG] Quota exhausted on model ${modelName}. Not retrying.`);
        break;
      }

      // Network errors — retry same model with backoff
      if (attempt < 3 && (errMsg.includes('fetch failed') || errMsg.includes('ETIMEDOUT') || errMsg.includes('socket'))) {
        console.warn(`[Gemini RAG] Network error attempt ${attempt} on ${modelName}, retrying in 1s...`);
        await new Promise(res => setTimeout(res, 1000));
        continue;
      }

      break;
    }
  }

  const responseTime = Date.now() - startTime;
  throw {
    message: lastError?.message || 'Error generating content from Gemini API',
    modelName,
    responseTime,
    fileSearchUsed,
    ragMode,
    queryLength: params.currentQuestion.length,
    status: 'ERROR' as const
  };
}

