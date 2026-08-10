/**
 * OMX Project Memory & Notepad MCP Server
 * Provides persistent project memory and session notepad tools
 * Storage: .omx/project-memory.json, .omx/notepad.md
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { parseNotepadPruneDaysOld } from './memory-validation.js';
import { autoStartStdioMcpServer } from './bootstrap.js';
import { resolveWorkingDirectoryForState } from './state-paths.js';

function getMemoryPath(wd: string): string {
  return join(wd, '.omx', 'project-memory.json');
}

function getNotepadPath(wd: string): string {
  return join(wd, '.omx', 'notepad.md');
}

interface ProjectMemory {
  techStack?: string;
  build?: string;
  conventions?: string;
  structure?: string;
  notes?: Array<{ category: string; content: string; timestamp: string }>;
  directives?: Array<{ directive: string; priority: string; context?: string; timestamp: string }>;
}

const server = new Server(
  { name: 'omx-memory', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

export function buildMemoryServerTools() {
  return [
    // Project Memory tools
    {
      name: 'project_memory_read',
      description: 'Read project memory from .omx/project-memory.json. Returns the full memory object or a specific section (techStack, build, conventions, structure, notes, directives). Use when retrieving accumulated project knowledge. Pass section to read a single field, or omit for the full object.',
      inputSchema: {
        type: 'object',
        properties: {
          section: { type: 'string', enum: ['all', 'techStack', 'build', 'conventions', 'structure', 'notes', 'directives'] },
          workingDirectory: { type: 'string' },
        },
      },
    },
    {
      name: 'project_memory_write',
      description: 'Write or update project memory in .omx/project-memory.json. Returns a success confirmation object. Use when persisting learned project knowledge (tech stack, build commands, conventions). Pass memory as the object to write and merge=true to combine with existing data.',
      inputSchema: {
        type: 'object',
        properties: {
          memory: { type: 'object', description: 'Memory object to write' },
          merge: { type: 'boolean', description: 'Merge with existing (true) or replace (false)' },
          workingDirectory: { type: 'string' },
        },
        required: ['memory'],
      },
    },
    {
      name: 'project_memory_add_note',
      description: 'Add a categorized note to project memory. Returns a success object with the updated note count. Use when recording a specific learning or observation (build, test, deploy, env, architecture). Pass category and content from the learning to record.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Note category (build, test, deploy, env, architecture)' },
          content: { type: 'string', description: 'Note content' },
          workingDirectory: { type: 'string' },
        },
        required: ['category', 'content'],
      },
    },
    {
      name: 'project_memory_add_directive',
      description: 'Add a persistent high-priority directive to project memory. Returns a success object with the updated directive count. Use when recording a standing instruction the agent must follow across sessions. Pass directive text from the instruction and priority (high or normal).',
      inputSchema: {
        type: 'object',
        properties: {
          directive: { type: 'string', description: 'The directive text' },
          priority: { type: 'string', enum: ['high', 'normal'] },
          context: { type: 'string' },
          workingDirectory: { type: 'string' },
        },
        required: ['directive'],
      },
    },
    // Notepad tools
    {
      name: 'notepad_read',
      description: 'Read notepad content from .omx/notepad.md. Returns the full notepad text or a specific section (priority, working, manual). Use when retrieving the agent current priority context, working memory, or manual notes. Pass section to read one part, or omit for the full content.',
      inputSchema: {
        type: 'object',
        properties: {
          section: { type: 'string', enum: ['all', 'priority', 'working', 'manual'] },
          workingDirectory: { type: 'string' },
        },
      },
    },
    {
      name: 'notepad_write_priority',
      description: 'Write to the Priority Context section of the notepad, replacing any existing content. Returns a success confirmation object. Use when setting the top-priority context the agent should focus on. Pass content (truncated to 500 chars) from the priority context to set.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Priority content (under 500 chars)' },
          workingDirectory: { type: 'string' },
        },
        required: ['content'],
      },
    },
    {
      name: 'notepad_write_working',
      description: 'Add a timestamped entry to the Working Memory section of the notepad. Returns a success confirmation object. Use when recording transient progress notes during a task. Pass content from the working note to append.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Working memory entry' },
          workingDirectory: { type: 'string' },
        },
        required: ['content'],
      },
    },
    {
      name: 'notepad_write_manual',
      description: 'Add a persistent entry to the Manual section of the notepad that is never auto-pruned. Returns a success confirmation object. Use when recording permanent reference notes. Pass content from the manual note to append.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Manual entry content' },
          workingDirectory: { type: 'string' },
        },
        required: ['content'],
      },
    },
    {
      name: 'notepad_prune',
      description: 'Prune Working Memory entries older than a configurable number of days. Returns a summary with the count of pruned and remaining entries. Use when cleaning up stale working notes. Pass daysOld to set the age threshold (default 7).',
      inputSchema: {
        type: 'object',
        properties: {
          daysOld: { type: 'integer', minimum: 0, description: 'Prune entries older than this many days (default: 7)' },
          workingDirectory: { type: 'string' },
        },
      },
    },
    {
      name: 'notepad_stats',
      description: 'Get statistics about the notepad file. Returns file size, per-section entry counts, and the oldest and newest working-memory timestamps. Use when auditing notepad health or checking size. Takes no parameters beyond optional workingDirectory.',
      inputSchema: {
        type: 'object',
        properties: {
          workingDirectory: { type: 'string' },
        },
      },
    },
  ];
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: buildMemoryServerTools(),
}));

export async function handleMemoryToolCall(request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) {
  const { name, arguments: args } = request.params;
  const a = (args || {}) as Record<string, unknown>;
  let wd: string;
  try {
    wd = resolveWorkingDirectoryForState(a.workingDirectory as string | undefined);
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: (error as Error).message }) }],
      isError: true,
    };
  }

  switch (name) {
    // === Project Memory ===
    case 'project_memory_read': {
      const memPath = getMemoryPath(wd);
      if (!existsSync(memPath)) {
        return text({ exists: false });
      }
      let data: ProjectMemory = {};
      try {
        data = JSON.parse(await readFile(memPath, 'utf-8')) as ProjectMemory;
      } catch {
        data = {};
      }
      const section = a.section as string | undefined;
      if (section && section !== 'all' && section in data) {
        return text((data as Record<string, unknown>)[section]);
      }
      return text(data);
    }

    case 'project_memory_write': {
      const memPath = getMemoryPath(wd);
      await mkdir(join(wd, '.omx'), { recursive: true });
      const merge = a.merge as boolean;
      const newMem = a.memory as Record<string, unknown>;
      if (merge && existsSync(memPath)) {
        let existing: Record<string, unknown> = {};
        try {
          existing = JSON.parse(await readFile(memPath, 'utf-8')) as Record<string, unknown>;
        } catch {
          existing = {};
        }
        const merged = { ...existing, ...newMem };
        await writeFile(memPath, JSON.stringify(merged, null, 2));
      } else {
        await writeFile(memPath, JSON.stringify(newMem, null, 2));
      }
      return text({ success: true });
    }

    case 'project_memory_add_note': {
      const memPath = getMemoryPath(wd);
      await mkdir(join(wd, '.omx'), { recursive: true });
      let data: ProjectMemory = {};
      if (existsSync(memPath)) {
        try {
          data = JSON.parse(await readFile(memPath, 'utf-8')) as ProjectMemory;
        } catch {
          data = {};
        }
      }
      if (!data.notes) data.notes = [];
      data.notes.push({
        category: a.category as string,
        content: a.content as string,
        timestamp: new Date().toISOString(),
      });
      await writeFile(memPath, JSON.stringify(data, null, 2));
      return text({ success: true, noteCount: data.notes.length });
    }

    case 'project_memory_add_directive': {
      const memPath = getMemoryPath(wd);
      await mkdir(join(wd, '.omx'), { recursive: true });
      let data: ProjectMemory = {};
      if (existsSync(memPath)) {
        try {
          data = JSON.parse(await readFile(memPath, 'utf-8')) as ProjectMemory;
        } catch {
          data = {};
        }
      }
      if (!data.directives) data.directives = [];
      data.directives.push({
        directive: a.directive as string,
        priority: (a.priority as string) || 'normal',
        context: a.context as string | undefined,
        timestamp: new Date().toISOString(),
      });
      await writeFile(memPath, JSON.stringify(data, null, 2));
      return text({ success: true, directiveCount: data.directives.length });
    }

    // === Notepad ===
    case 'notepad_read': {
      const notePath = getNotepadPath(wd);
      if (!existsSync(notePath)) {
        return text({ exists: false, content: '' });
      }
      const content = await readFile(notePath, 'utf-8');
      const section = a.section as string | undefined;
      if (section && section !== 'all') {
        const sectionContent = extractSection(content, section);
        return text({ section, content: sectionContent });
      }
      return text({ content });
    }

    case 'notepad_write_priority': {
      const notePath = getNotepadPath(wd);
      await mkdir(join(wd, '.omx'), { recursive: true });
      const content = a.content as string;
      let existing: string;
      try {
        existing = await readFile(notePath, 'utf-8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          existing = '';
        } else {
          throw err;
        }
      }
      existing = replaceSection(existing, 'PRIORITY', content.slice(0, 500));
      const tmpPath = notePath + '.tmp.' + process.pid;
      await writeFile(tmpPath, existing);
      await rename(tmpPath, notePath);
      return text({ success: true });
    }

    case 'notepad_write_working': {
      const notePath = getNotepadPath(wd);
      await mkdir(join(wd, '.omx'), { recursive: true });
      const entry = `\n[${new Date().toISOString()}] ${a.content as string}`;
      let existing: string;
      try {
        existing = await readFile(notePath, 'utf-8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          existing = '';
        } else {
          throw err;
        }
      }
      existing = appendToSection(existing, 'WORKING MEMORY', entry);
      const tmpPath = notePath + '.tmp.' + process.pid;
      await writeFile(tmpPath, existing);
      await rename(tmpPath, notePath);
      return text({ success: true });
    }

    case 'notepad_write_manual': {
      const notePath = getNotepadPath(wd);
      await mkdir(join(wd, '.omx'), { recursive: true });
      const entry = `\n${a.content as string}`;
      let existing: string;
      try {
        existing = await readFile(notePath, 'utf-8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          existing = '';
        } else {
          throw err;
        }
      }
      existing = appendToSection(existing, 'MANUAL', entry);
      const tmpPath = notePath + '.tmp.' + process.pid;
      await writeFile(tmpPath, existing);
      await rename(tmpPath, notePath);
      return text({ success: true });
    }

    case 'notepad_prune': {
      const notePath = getNotepadPath(wd);
      if (!existsSync(notePath)) {
        return text({ pruned: 0, message: 'No notepad file found' });
      }
      const parsedDays = parseNotepadPruneDaysOld(a.daysOld);
      if (!parsedDays.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: parsedDays.error }) }],
          isError: true,
        };
      }
      const days = parsedDays.days;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const content = await readFile(notePath, 'utf-8');
      const workingSection = extractSection(content, 'WORKING MEMORY');
      if (!workingSection) {
        return text({ pruned: 0, message: 'No working memory entries found' });
      }
      const lines = workingSection.split('\n');
      let pruned = 0;
      const kept: string[] = [];
      for (const line of lines) {
        const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]/);
        if (match) {
          const entryTime = new Date(match[1]).getTime();
          if (entryTime < cutoff) {
            pruned++;
            continue;
          }
        }
        kept.push(line);
      }
      if (pruned > 0) {
        const updated = replaceSection(content, 'WORKING MEMORY', kept.join('\n'));
        await writeFile(notePath, updated);
      }
      return text({ pruned, remaining: kept.filter(l => l.match(/^\[/)).length });
    }

    case 'notepad_stats': {
      const notePath = getNotepadPath(wd);
      if (!existsSync(notePath)) {
        return text({ exists: false, size: 0, entryCount: 0, oldestEntry: null });
      }
      const content = await readFile(notePath, 'utf-8');
      const stats = await import('fs/promises').then(fs => fs.stat(notePath));
      const workingSection = extractSection(content, 'WORKING MEMORY');
      const timestamps: string[] = [];
      if (workingSection) {
        for (const line of workingSection.split('\n')) {
          const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]/);
          if (match) timestamps.push(match[1]);
        }
      }
      const prioritySection = extractSection(content, 'PRIORITY');
      const manualSection = extractSection(content, 'MANUAL');
      return text({
        exists: true,
        size: stats.size,
        sections: {
          priority: prioritySection ? prioritySection.length : 0,
          working: timestamps.length,
          manual: manualSection ? manualSection.split('\n').filter(l => l.trim()).length : 0,
        },
        entryCount: timestamps.length,
        oldestEntry: timestamps.length > 0 ? timestamps[0] : null,
        newestEntry: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
      });
    }

    default:
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
  }
}

server.setRequestHandler(CallToolRequestSchema, handleMemoryToolCall);

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function extractSection(content: string, section: string): string {
  const header = `## ${section.toUpperCase()}`;
  const idx = content.indexOf(header);
  if (idx < 0) return '';
  const nextHeader = content.indexOf('\n## ', idx + header.length);
  return nextHeader < 0
    ? content.slice(idx + header.length).trim()
    : content.slice(idx + header.length, nextHeader).trim();
}

function replaceSection(content: string, section: string, newContent: string): string {
  const header = `## ${section}`;
  const idx = content.indexOf(header);
  if (idx < 0) {
    return content + `\n\n${header}\n${newContent}\n`;
  }
  const nextHeader = content.indexOf('\n## ', idx + header.length);
  if (nextHeader < 0) {
    return content.slice(0, idx) + `${header}\n${newContent}\n`;
  }
  return content.slice(0, idx) + `${header}\n${newContent}\n` + content.slice(nextHeader);
}

function appendToSection(content: string, section: string, entry: string): string {
  const header = `## ${section}`;
  const idx = content.indexOf(header);
  if (idx < 0) {
    return content + `\n\n${header}${entry}\n`;
  }
  const nextHeader = content.indexOf('\n## ', idx + header.length);
  if (nextHeader < 0) {
    return content + entry;
  }
  return content.slice(0, nextHeader) + entry + content.slice(nextHeader);
}

autoStartStdioMcpServer('memory', server);
