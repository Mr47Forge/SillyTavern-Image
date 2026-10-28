export function toSceneCharacterPromptTag(value) {
    const type = String(value || '').trim();
    return type.toLowerCase() === 'no_humans' ? 'no humans' : type;
}

export const ScenePlannerErrorCategory = Object.freeze({
    INPUT: 'input',
    AGENT_CONFIG: 'agent-config',
    PROMPT: 'prompt',
    TOOL_PROTOCOL: 'tool-protocol',
    SCHEMA: 'schema',
    TIMEOUT: 'timeout',
    ABORTED: 'aborted',
    PROVIDER: 'provider',
    UNKNOWN: 'unknown',
});

const AGENT_CONFIG_ERROR_CODES = new Set([
    'AGENT_CORE_LOAD_FAILED',
    'AGENT_SETTINGS_LOAD_FAILED',
    'HOST_REQUEST_HEADERS_LOAD_FAILED',
    'AGENT_PRESET_INVALID',
    'MODEL_MISSING',
]);
const PROMPT_ERROR_CODES = new Set([
    'MODEL_OUTPUT_REFUSED',
    'PROMPT_EXPANSION_FAILED',
]);
const INPUT_ERROR_CODES = new Set([
    'EMPTY_MESSAGE',
    'NO_INSERT_POINTS',
    'IMAGE_LIMIT_EXCEEDED',
]);
const TOOL_PROTOCOL_ERROR_CODES = new Set([
    'DSML_TOOL_CALL_INVALID',
    'TAGGED_TOOL_CALL_INVALID',
    'TOOL_CONTRACT_INVALID',
    'TOOL_CALL_MISSING',
    'TOOL_CALL_MULTIPLE',
    'TOOL_CALL_NAME_INVALID',
]);
const SCHEMA_ERROR_CODES = new Set([
    'TOOL_ARGUMENTS_INVALID_JSON',
    'TOOL_ARGUMENTS_SCHEMA_INVALID',
    'NO_IMAGE_TASKS',
    'INSERT_POINT_INVALID',
]);

export class ScenePlannerError extends Error {
    constructor(message, code = 'SCENE_PLANNER_ERROR', details = null, options = {}) {
        super(message, options);
        this.name = 'ScenePlannerError';
        this.code = code;
        this.details = details;
    }
}

export function getScenePlannerErrorCategory(error) {
    if (!(error instanceof ScenePlannerError)) return null;
    const code = String(error.code || '').toUpperCase();
    if (INPUT_ERROR_CODES.has(code)) return ScenePlannerErrorCategory.INPUT;
    if (AGENT_CONFIG_ERROR_CODES.has(code)) return ScenePlannerErrorCategory.AGENT_CONFIG;
    if (PROMPT_ERROR_CODES.has(code)) return ScenePlannerErrorCategory.PROMPT;
    if (TOOL_PROTOCOL_ERROR_CODES.has(code)) return ScenePlannerErrorCategory.TOOL_PROTOCOL;
    if (SCHEMA_ERROR_CODES.has(code)) return ScenePlannerErrorCategory.SCHEMA;
    if (code === 'REQUEST_TIMEOUT') return ScenePlannerErrorCategory.TIMEOUT;
    if (code === 'REQUEST_ABORTED') return ScenePlannerErrorCategory.ABORTED;
    if (code === 'PROVIDER_REQUEST_FAILED' || code === 'MODEL_OUTPUT_TRUNCATED') return ScenePlannerErrorCategory.PROVIDER;
    return ScenePlannerErrorCategory.UNKNOWN;
}
