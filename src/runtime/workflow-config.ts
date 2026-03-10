import { AgentConfig, Settings, TeamConfig } from '../lib/types';

export interface ResolvedWorkflowStage {
    role: string;
    agentId: string;
    readOnly: boolean;
    requiresApprovalToAdvance: boolean;
    roleType?: string;
}

export interface ResolvedTeamWorkflow {
    workflowId: string;
    stages: ResolvedWorkflowStage[];
}

function normalizeRole(value: string): string {
    const role = value.trim().toLowerCase();
    if (role === 'pm') return 'scrum_master';
    return role;
}

function findAgentIdForRole(
    role: string,
    team: TeamConfig,
    agents: Record<string, AgentConfig>,
): string | null {
    const normRole = normalizeRole(role);
    // Prefer explicit role mapping.
    for (const agentId of team.agents) {
        const agent = agents[agentId];
        if (!agent) continue;
        if ((agent.role || '').trim().toLowerCase() === normRole) return agentId;
    }
    // Backward-compatible fallback by agent id.
    for (const agentId of team.agents) {
        if (agentId.toLowerCase() === normRole) return agentId;
    }
    return null;
}

function resolveReadOnlyDefault(role: string, configured?: boolean): boolean {
    if (typeof configured === 'boolean') return configured;
    return role === 'reviewer' || role === 'tester';
}

function resolveApprovalDefault(role: string, configured?: boolean): boolean {
    if (typeof configured === 'boolean') return configured;
    return role === 'scrum_master';
}

export function resolveTeamWorkflow(params: {
    teamId: string;
    team: TeamConfig;
    agents: Record<string, AgentConfig>;
    settings: Settings;
    log?: (level: string, msg: string) => void;
}): ResolvedTeamWorkflow | null {
    const {
        teamId, team, agents, settings, log,
    } = params;
    const wf = team.workflow;
    if (!wf || wf.type !== 'dev_pipeline') return null;

    // Legacy mode: explicit fixed stage agents.
    const legacyLead = wf.scrum_master || wf.pm;
    if (legacyLead && wf.coder && wf.reviewer && wf.tester) {
        const sequence = [legacyLead, wf.coder, wf.reviewer, wf.tester].map(s => s.toLowerCase());
        const roleNames = ['scrum_master', 'coder', 'reviewer', 'tester'];
        const unique = new Set(sequence);
        if (unique.size !== sequence.length) {
            log?.('WARN', `Team ${team.name} has duplicate legacy workflow agents; disabling dev_pipeline`);
            return null;
        }
        for (const stageAgent of sequence) {
            if (!team.agents.includes(stageAgent) || !agents[stageAgent]) {
                log?.('WARN', `Team ${team.name} legacy workflow agent '${stageAgent}' invalid; disabling dev_pipeline`);
                return null;
            }
        }
        const stages = sequence.map((agentId, idx) => {
            const role = roleNames[idx];
            const roleCfg = settings.roles?.[role] || {};
            return {
                role,
                agentId,
                readOnly: resolveReadOnlyDefault(role, roleCfg.readOnly),
                requiresApprovalToAdvance: resolveApprovalDefault(role, roleCfg.requiresApprovalToAdvance),
                roleType: roleCfg.type,
            };
        });
        return {
            workflowId: wf.workflowId || `${teamId}:legacy`,
            stages,
        };
    }

    const configuredStages = Array.isArray(wf.stages) && wf.stages.length > 0
        ? wf.stages
        : (wf.workflowId ? settings.workflows?.[wf.workflowId]?.stages : undefined);

    if (!configuredStages || configuredStages.length === 0) {
        log?.('WARN', `Team ${team.name} has dev_pipeline but no resolvable stages; disabling pipeline`);
        return null;
    }

    const roles = configuredStages.map(normalizeRole);
    const uniqueRoles = new Set(roles);
    if (uniqueRoles.size !== roles.length) {
        log?.('WARN', `Team ${team.name} workflow has duplicate roles; disabling pipeline`);
        return null;
    }

    const stages: ResolvedWorkflowStage[] = [];
    for (const role of roles) {
        const agentId = findAgentIdForRole(role, team, agents);
        if (!agentId) {
            log?.('WARN', `Team ${team.name} workflow role '${role}' has no mapped agent in team.agents; disabling pipeline`);
            return null;
        }
        const roleCfg = settings.roles?.[role] || {};
        stages.push({
            role,
            agentId,
            readOnly: resolveReadOnlyDefault(role, roleCfg.readOnly),
            requiresApprovalToAdvance: resolveApprovalDefault(role, roleCfg.requiresApprovalToAdvance),
            roleType: roleCfg.type,
        });
    }

    return {
        workflowId: wf.workflowId || `${teamId}:inline`,
        stages,
    };
}
