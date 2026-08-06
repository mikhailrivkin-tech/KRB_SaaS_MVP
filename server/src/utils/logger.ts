import fs from 'fs';
import path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'ERROR';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  ERROR: 2
};

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE_PATH = path.join(LOG_DIR, 'system.log');

let currentLogLevel: LogLevel = 'DEBUG'; // Default to DEBUG so all events are captured

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function setSystemLogLevel(level: LogLevel) {
  currentLogLevel = level;
  writeLog('INFO', `Системный уровень логирования изменен на [${level}]`);
}

export function getSystemLogLevel(): LogLevel {
  return currentLogLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[currentLogLevel];
}

export function writeLog(level: LogLevel, message: string, meta?: any) {
  if (!shouldLog(level)) return;

  ensureLogDir();

  const timestamp = new Date().toISOString();
  let metaStr = '';
  if (meta !== undefined) {
    try {
      metaStr = typeof meta === 'string' ? meta : JSON.stringify(meta);
    } catch {
      metaStr = '[Unserializable Meta]';
    }
  }

  const logLine = `${timestamp} | ${level.padEnd(5)} | ${message}${metaStr ? ' | ' + metaStr : ''}\n`;

  try {
    fs.appendFileSync(LOG_FILE_PATH, logLine, 'utf8');
  } catch (err) {
    console.error('Failed to write log to file:', err);
  }
}

export function logInfo(message: string, meta?: any) {
  writeLog('INFO', message, meta);
}

export function logError(message: string, meta?: any) {
  writeLog('ERROR', message, meta);
}

export function logDebug(message: string, meta?: any) {
  writeLog('DEBUG', message, meta);
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: string;
  raw: string;
}

export function readLogs(filterLevel: string = 'ALL', limit: number = 500): LogEntry[] {
  ensureLogDir();

  if (!fs.existsSync(LOG_FILE_PATH)) {
    return [];
  }

  try {
    const fileContent = fs.readFileSync(LOG_FILE_PATH, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim().length > 0);

    const entries: LogEntry[] = [];
    let counter = 0;

    for (const line of lines) {
      const parts = line.split(' | ');
      if (parts.length >= 3) {
        const timestamp = parts[0];
        const level = parts[1].trim() as LogLevel;
        const message = parts[2];
        const meta = parts.slice(3).join(' | ');

        if (filterLevel === 'ALL' || level === filterLevel) {
          entries.push({
            id: `log_${counter++}`,
            timestamp,
            level,
            message,
            meta: meta || undefined,
            raw: line
          });
        }
      } else {
        if (filterLevel === 'ALL') {
          entries.push({
            id: `log_${counter++}`,
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message: line,
            raw: line
          });
        }
      }
    }

    // Return the latest entries first or last (last entries are newest)
    return entries.slice(-limit);
  } catch (err) {
    console.error('Failed to read log file:', err);
    return [];
  }
}

export function clearLogFile(): boolean {
  ensureLogDir();
  try {
    fs.writeFileSync(LOG_FILE_PATH, '', 'utf8');
    writeLog('INFO', 'Файл логов очищен администратором');
    return true;
  } catch (err) {
    console.error('Failed to clear log file:', err);
    return false;
  }
}
