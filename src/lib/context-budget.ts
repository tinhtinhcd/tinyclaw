export interface ContextBlock {
    name: string;
    content: string;
    priority: number;
}

const TRUNCATION_MARKER = '... (truncated)';

function truncateWithMarker(content: string, maxChars: number): string {
    if (maxChars <= 0) return '';
    if (content.length <= maxChars) return content;
    if (maxChars <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.slice(0, maxChars);
    return `${content.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

export function applyContextBudget(
    blocks: ContextBlock[],
    maxChars: number,
): ContextBlock[] {
    const normalizedBudget = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
    const indexed = blocks
        .map((block, idx) => ({ ...block, idx }))
        .filter(block => typeof block.content === 'string' && block.content.trim().length > 0)
        .sort((a, b) => (b.priority - a.priority) || (a.idx - b.idx));

    const kept: ContextBlock[] = [];
    let used = 0;

    for (const block of indexed) {
        const remaining = normalizedBudget - used;
        if (remaining <= 0) {
            if (block.name === 'TASK_LINKAGE_CONTEXT' && !kept.some(b => b.name === 'TASK_LINKAGE_CONTEXT')) {
                const forced = truncateWithMarker(block.content, normalizedBudget);
                if (forced.length > 0) kept.push({ name: block.name, priority: block.priority, content: forced });
            }
            continue;
        }
        if (block.content.length <= remaining) {
            kept.push({ name: block.name, priority: block.priority, content: block.content });
            used += block.content.length;
            continue;
        }
        const truncated = truncateWithMarker(block.content, remaining);
        if (truncated.length > 0) {
            kept.push({ name: block.name, priority: block.priority, content: truncated });
            used += truncated.length;
        }
    }

    if (!kept.some(b => b.name === 'TASK_LINKAGE_CONTEXT')) {
        const taskBlock = indexed.find(b => b.name === 'TASK_LINKAGE_CONTEXT');
        if (taskBlock) {
            const forced = truncateWithMarker(taskBlock.content, normalizedBudget);
            if (forced.length > 0) {
                kept.push({ name: taskBlock.name, priority: taskBlock.priority, content: forced });
            }
        }
    }

    return kept;
}

