import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { log } from './logging';

// ── Bracket-depth tag parser ────────────────────────────────────────────────

export interface BracketTag {
    id: string;       // agent id(s) or team id (raw, before splitting on commas)
    message: string;  // content between colon and closing bracket
    start: number;    // index of opening [
    end: number;      // index after closing ]
}

/**
 * Extract bracket tags with balanced bracket matching.
 * Handles nested brackets in message bodies (e.g., `[@coder: fix arr[0]]`).
 *
 * @param text   The full response text to parse
 * @param prefix '@' for teammate tags, '#' for chat room tags
 */
export function extractBracketTags(text: string, prefix: '@' | '#'): BracketTag[] {
    const results: BracketTag[] = [];
    let i = 0;

    while (i < text.length) {
        // Look for [@ or [#
        if (text[i] === '[' && i + 1 < text.length && text[i + 1] === prefix) {
            const tagStart = i;

            // Find the colon that separates id from message
            const colonIdx = text.indexOf(':', i + 2);
            if (colonIdx === -1) { i++; continue; }

            // Ensure no unbalanced brackets before the colon (id portion should be simple)
            const idPortion = text.substring(i + 2, colonIdx);
            if (idPortion.includes('[') || idPortion.includes(']')) { i++; continue; }

            const id = idPortion.trim();
            if (!id) { i++; continue; }

            // Find the matching ] by counting bracket depth
            let depth = 1;
            let j = colonIdx + 1;
            while (j < text.length && depth > 0) {
                if (text[j] === '[') depth++;
                else if (text[j] === ']') depth--;
                j++;
            }

            if (depth === 0) {
                const message = text.substring(colonIdx + 1, j - 1).trim();
                results.push({ id, message, start: tagStart, end: j });
            }

            i = j;
        } else {
            i++;
        }
    }

    return results;
}

/**
 * Strip all bracket tags of a given prefix from text, returning the remaining text.
 * Used to compute shared context (text outside tags).
 */
export function stripBracketTags(text: string, prefix: '@' | '#'): string {
    const tags = extractBracketTags(text, prefix);
    if (tags.length === 0) return text;

    let result = '';
    let lastEnd = 0;
    for (const tag of tags) {
        result += text.substring(lastEnd, tag.start);
        lastEnd = tag.end;
    }
    result += text.substring(lastEnd);
    return result.trim();
}

/**
 * Convert [@agent: message] tags to readable format (→ @agent: message).
 * Uses bracket-depth parsing to handle nested brackets correctly.
 */
export function convertTagsToReadable(text: string): string {
    const tags = extractBracketTags(text, '@');
    if (tags.length === 0) return text;

    let result = '';
    let lastEnd = 0;
    for (const tag of tags) {
        result += text.substring(lastEnd, tag.start);
        result += `→ @${tag.id}: ${tag.message}`;
        lastEnd = tag.end;
    }
    result += text.substring(lastEnd);
    return result.trim();
}

/**
 * Find the first team that contains the given agent.
 */
export function findTeamForAgent(agentId: string, teams: Record<string, TeamConfig>): { teamId: string; team: TeamConfig } | null {
    for (const [teamId, team] of Object.entries(teams)) {
        if (team.agents.includes(agentId)) {
            return { teamId, team };
        }
    }
    return null;
}

/**
 * Check if a mentioned ID is a valid teammate of the current agent in the given team.
 */
export function isTeammate(
    mentionedId: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): boolean {
    const team = teams[teamId];
    if (!team) {
        log('WARN', `isTeammate check failed: Team '${teamId}' not found`);
        return false;
    }

    if (mentionedId === currentAgentId) {
        log('DEBUG', `isTeammate check failed: Self-mention (agent: ${mentionedId})`);
        return false;
    }

    if (!team.agents.includes(mentionedId)) {
        log('WARN', `isTeammate check failed: Agent '${mentionedId}' not in team '${teamId}' (members: ${team.agents.join(', ')})`);
        return false;
    }

    if (!agents[mentionedId]) {
        log('WARN', `isTeammate check failed: Agent '${mentionedId}' not found in agents config`);
        return false;
    }

    return true;
}

/** Handoff target: agent (enqueue) or user (wait for input) */
export type HandoffTarget =
    | { type: 'agent'; agentId: string; message: string }
    | { type: 'user'; message: string };

/**
 * Extract handoff targets from a response: [@agent: msg] or [@user: msg].
 * Returns agent targets (valid teammates only) and user target (at most one).
 * Used for conditional handoff: agent→agent, agent→user, or no-handoff.
 */
export function extractHandoffTargets(
    response: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>,
): HandoffTarget[] {
    const results: HandoffTarget[] = [];
    const seenAgents = new Set<string>();
    let hasUser = false;

    const tags = extractBracketTags(response, '@');
    const sharedContext = stripBracketTags(response, '@');

    for (const tag of tags) {
        const directMessage = tag.message;
        const fullMessage = sharedContext
            ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
            : directMessage;

        const candidateIds = tag.id.toLowerCase().split(',').map(id => id.trim()).filter(Boolean);
        for (const candidateId of candidateIds) {
            if (candidateId === 'user') {
                if (!hasUser) {
                    results.push({ type: 'user', message: fullMessage });
                    hasUser = true;
                }
                continue;
            }
            if (!seenAgents.has(candidateId) && isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
                results.push({ type: 'agent', agentId: candidateId, message: fullMessage });
                seenAgents.add(candidateId);
            }
        }
    }
    return results;
}

/**
 * Extract valid @teammate mentions from a response text.
 * Uses bracket-depth parsing to handle nested brackets in message bodies.
 */
export function extractTeammateMentions(
    response: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { teammateId: string; message: string }[] {
    const results: { teammateId: string; message: string }[] = [];
    const seen = new Set<string>();

    const tags = extractBracketTags(response, '@');

    // Strip all [@teammate: ...] tags from the full response to get shared context
    const sharedContext = stripBracketTags(response, '@');

    for (const tag of tags) {
        const directMessage = tag.message;
        const fullMessage = sharedContext
            ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
            : directMessage;

        // Support comma-separated agent IDs: [@coder,reviewer: message]
        const candidateIds = tag.id.toLowerCase().split(',').map(id => id.trim()).filter(Boolean);
        for (const candidateId of candidateIds) {
            if (!seen.has(candidateId) && isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
                results.push({ teammateId: candidateId, message: fullMessage });
                seen.add(candidateId);
            }
        }
    }
    return results;
}

/**
 * Extract [#team_id: message] chat room broadcast tags from a response.
 * Uses bracket-depth parsing to handle nested brackets in message bodies.
 */
export function extractChatRoomMessages(
    response: string,
    currentAgentId: string,
    teams: Record<string, TeamConfig>
): { teamId: string; message: string }[] {
    const results: { teamId: string; message: string }[] = [];
    const tags = extractBracketTags(response, '#');

    for (const tag of tags) {
        const candidateId = tag.id.toLowerCase();
        if (!tag.message) continue;

        // Validate team exists and agent is a member
        const team = teams[candidateId];
        if (team && team.agents.includes(currentAgentId)) {
            results.push({ teamId: candidateId, message: tag.message });
        }
    }

    return results;
}

/**
 * Get the reset flag path for a specific agent.
 */
export function getAgentResetFlag(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, 'reset_flag');
}

/** Sentinel when no agent is mentioned — strict mention-driven: do not run any agent */
export const NO_AGENT_MENTIONED = 'none';

/**
 * Extract all @mentions from message (standalone @word, not inside brackets).
 * Returns unique mentions in order of first appearance.
 */
function extractMentions(text: string): string[] {
    const seen = new Set<string>();
    const results: string[] = [];
    const regex = /@(\w[\w-]*)/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
        const id = m[1].toLowerCase();
        if (id !== 'user' && id !== 'default' && !seen.has(id)) {
            seen.add(id);
            results.push(id);
        }
    }
    return results;
}

/**
 * Resolve a candidate mention to an agent id or team leader.
 * Returns { agentId, isTeam } or null if no match.
 */
function normalizeForMatch(s: string): string {
    return s.toLowerCase().replace(/[\s_-]/g, '');
}

function resolveMention(
    candidateId: string,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig>
): { agentId: string; isTeam: boolean } | null {
    if (agents[candidateId]) {
        return { agentId: candidateId, isTeam: false };
    }
    if (teams[candidateId]) {
        return { agentId: teams[candidateId].leader_agent, isTeam: true };
    }
    const norm = normalizeForMatch(candidateId);
    for (const [id, config] of Object.entries(agents)) {
        if (normalizeForMatch(id) === norm || normalizeForMatch(config.name || '') === norm) {
            return { agentId: id, isTeam: false };
        }
    }
    for (const [id, config] of Object.entries(teams)) {
        if (normalizeForMatch(id) === norm || normalizeForMatch(config.name || '') === norm) {
            return { agentId: config.leader_agent, isTeam: true };
        }
    }
    return null;
}

/**
 * Parse @agent_id or @team_id from a message.
 * Strict mention-driven: only runs agents that are explicitly mentioned.
 *
 * - @ at start: same as before (prefix routing)
 * - @ anywhere in message: first valid mention wins
 * - No valid mention: returns NO_AGENT_MENTIONED — no agent runs
 */
export function parseAgentRouting(
    rawMessage: string,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig> = {}
): { agentId: string; message: string; isTeam?: boolean } {
    // 1. Match @agent_id or @team_id at the start (legacy prefix)
    const prefixMatch = rawMessage.match(/^@(\S+)\s+([\s\S]*)$/);
    if (prefixMatch) {
        const candidateId = prefixMatch[1].toLowerCase();
        const message = prefixMatch[2];

        if (candidateId === 'default') {
            return { agentId: NO_AGENT_MENTIONED, message: rawMessage };
        }

        const resolved = resolveMention(candidateId, agents, teams);
        if (resolved) {
            return { agentId: resolved.agentId, message, isTeam: resolved.isTeam };
        }
    }

    // 2. Scan for @mentions anywhere in the message
    const mentions = extractMentions(rawMessage);
    for (const candidateId of mentions) {
        const resolved = resolveMention(candidateId, agents, teams);
        if (resolved) {
            return { agentId: resolved.agentId, message: rawMessage, isTeam: resolved.isTeam };
        }
    }

    // 3. No valid mention — strict: do not run any agent
    return { agentId: NO_AGENT_MENTIONED, message: rawMessage };
}
