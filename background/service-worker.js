/**
 * Background Service Worker for Job Application Autofill
 * Handles keyboard shortcuts and message routing
 */

/**
 * Inject content scripts into a tab if not already injected
 */
const CONTENT_SCRIPT_FILES = [
    'shared/validation.js',
    'shared/storage.js',
    'content/fieldDetector.js',
    'content/content.js'
];

const CONTENT_SCRIPT_CSS = ['content/content.css'];
const MESSAGE_TIMEOUT_MS = 1500;
const INJECTION_RETRY_COUNT = 8;
const INJECTION_RETRY_DELAY_MS = 150;
const USER_DATA_STORAGE_KEY = 'jobAutofill_userData';
const SETTINGS_STORAGE_KEY = 'jobAutofill_settings';
const RESUME_STORAGE_KEY = 'jobAutofill_resume';
const RESUME_PARSED_STORAGE_KEY = 'jobAutofill_resumeParsed';
const UPDATE_STATUS_STORAGE_KEY = 'jobAutofill_updateStatus';
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_OCR_API_URL = 'https://api.mistral.ai/v1/ocr';
const MISTRAL_OCR_MODEL = 'mistral-ocr-latest';
const GITHUB_REPO_OWNER = 'mihailgriniuc';
const GITHUB_REPO_NAME = 'JobApplier';
const GITHUB_REPO_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6;
const PARSED_RESUME_SECTION_KEYS = [
    'resumeSummary',
    'skills',
    'experienceHighlights',
    'educationHighlights',
    'certifications',
    'projects'
];
const MAX_RESUME_OCR_TEXT_LENGTH = 120000;
const MAX_STRUCTURED_RESUME_DEPTH = 6;
const MAX_STRUCTURED_RESUME_ARRAY_ITEMS = 100;
const MAX_STRUCTURED_RESUME_OBJECT_KEYS = 100;
const MAX_RESUME_CONTEXT_JSON_LENGTH = 30000;
const MAX_RESUME_OCR_PROMPT_LENGTH = 60000;
let localAiConfigCache = null;

function canUseExtensionRuntimeUrl() {
    return Boolean(
        typeof chrome !== 'undefined' &&
        chrome?.runtime?.id &&
        typeof chrome.runtime.getURL === 'function'
    );
}

function normalizeVersion(version) {
    return typeof version === 'string' ? version.trim().replace(/^v/i, '') : '';
}

function compareVersions(leftVersion, rightVersion) {
    const left = normalizeVersion(leftVersion).split('.').map(segment => Number.parseInt(segment, 10) || 0);
    const right = normalizeVersion(rightVersion).split('.').map(segment => Number.parseInt(segment, 10) || 0);
    const length = Math.max(left.length, right.length, 3);

    for (let index = 0; index < length; index += 1) {
        const leftPart = left[index] || 0;
        const rightPart = right[index] || 0;

        if (leftPart > rightPart) {
            return 1;
        }

        if (leftPart < rightPart) {
            return -1;
        }
    }

    return 0;
}

function createUpdateStatus(overrides = {}) {
    return {
        currentVersion: chrome.runtime.getManifest().version,
        latestVersion: '',
        hasUpdate: false,
        checkedAt: '',
        downloadUrl: `${GITHUB_REPO_URL}/archive/refs/heads/main.zip`,
        repoUrl: GITHUB_REPO_URL,
        defaultBranch: 'main',
        error: '',
        ...overrides
    };
}

function isCachedUpdateStatusFresh(updateStatus) {
    if (!updateStatus?.checkedAt || updateStatus.currentVersion !== chrome.runtime.getManifest().version) {
        return false;
    }

    const checkedAtMs = Date.parse(updateStatus.checkedAt);
    if (Number.isNaN(checkedAtMs)) {
        return false;
    }

    return (Date.now() - checkedAtMs) < UPDATE_CHECK_INTERVAL_MS;
}

async function getCachedUpdateStatus() {
    const result = await chrome.storage.local.get([UPDATE_STATUS_STORAGE_KEY]);
    const updateStatus = result[UPDATE_STATUS_STORAGE_KEY];
    return updateStatus ? createUpdateStatus(updateStatus) : null;
}

async function saveUpdateStatus(updateStatus) {
    await chrome.storage.local.set({
        [UPDATE_STATUS_STORAGE_KEY]: createUpdateStatus(updateStatus)
    });
}

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json'
        },
        cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data?.message || `GitHub request failed with ${response.status}`);
    }

    return data;
}

async function fetchRemoteManifestStatus() {
    const repository = await fetchJson(GITHUB_REPO_API_URL);
    const defaultBranch = repository.default_branch || 'main';
    const manifestResponse = await fetchJson(`${GITHUB_REPO_API_URL}/contents/manifest.json?ref=${encodeURIComponent(defaultBranch)}`);
    const encodedContent = typeof manifestResponse.content === 'string'
        ? manifestResponse.content.replace(/\n/g, '')
        : '';

    if (!encodedContent) {
        throw new Error('GitHub did not return a manifest.json payload.');
    }

    const remoteManifest = JSON.parse(atob(encodedContent));
    const latestVersion = normalizeVersion(remoteManifest.version);

    if (!latestVersion) {
        throw new Error('GitHub manifest.json is missing a version.');
    }

    return createUpdateStatus({
        latestVersion,
        hasUpdate: compareVersions(latestVersion, chrome.runtime.getManifest().version) > 0,
        checkedAt: new Date().toISOString(),
        downloadUrl: `${repository.html_url || GITHUB_REPO_URL}/archive/refs/heads/${defaultBranch}.zip`,
        repoUrl: repository.html_url || GITHUB_REPO_URL,
        defaultBranch,
        error: ''
    });
}

async function getExtensionUpdateStatus({ force = false } = {}) {
    const cachedStatus = await getCachedUpdateStatus();
    if (!force && cachedStatus && isCachedUpdateStatusFresh(cachedStatus)) {
        return cachedStatus;
    }

    try {
        const nextStatus = await fetchRemoteManifestStatus();
        await saveUpdateStatus(nextStatus);
        return nextStatus;
    } catch (error) {
        const fallbackStatus = createUpdateStatus({
            ...(cachedStatus || {}),
            checkedAt: cachedStatus?.checkedAt || new Date().toISOString(),
            error: error.message || 'Unable to reach GitHub.'
        });

        await saveUpdateStatus(fallbackStatus);
        return fallbackStatus;
    }
}

function getDefaultAiAssistSettings() {
    return {
        enabled: true,
        model: 'mistral-small-latest',
        apiKey: '',
        extraContext: '',
        cacheAnswers: true,
        useParsedResumeData: true,
        maxCharacters: 320,
        maxQuestionsPerRun: 10
    };
}

function sanitizeStringList(value, maxItems = 25, maxLength = 240) {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set();

    return value
        .map(item => typeof item === 'string' ? item.trim().slice(0, maxLength) : '')
        .filter(Boolean)
        .filter(item => {
            const normalizedItem = item.toLowerCase();
            if (seen.has(normalizedItem)) {
                return false;
            }

            seen.add(normalizedItem);
            return true;
        })
        .slice(0, maxItems);
}

function getIsoTimestamp(value, fallback = null) {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return fallback;
    }

    return Number.isNaN(Date.parse(trimmed)) ? fallback : trimmed;
}

function sanitizeStructuredResumeValue(value, depth = 0) {
    if (depth > MAX_STRUCTURED_RESUME_DEPTH) {
        return null;
    }

    if (typeof value === 'string') {
        return value.trim().slice(0, 4000);
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map(item => sanitizeStructuredResumeValue(item, depth + 1))
            .filter(item => item !== null && item !== '')
            .slice(0, MAX_STRUCTURED_RESUME_ARRAY_ITEMS);
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const entries = Object.entries(value)
        .slice(0, MAX_STRUCTURED_RESUME_OBJECT_KEYS)
        .map(([key, entryValue]) => {
            const normalizedKey = typeof key === 'string' ? key.trim() : '';
            if (!normalizedKey) {
                return null;
            }

            const sanitizedValue = sanitizeStructuredResumeValue(entryValue, depth + 1);
            if (sanitizedValue === null || sanitizedValue === '') {
                return null;
            }

            return [normalizedKey, sanitizedValue];
        })
        .filter(Boolean);

    return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function hasStructuredResumeValue(value, depth = 0) {
    if (depth > MAX_STRUCTURED_RESUME_DEPTH || value === null || value === undefined) {
        return false;
    }

    if (typeof value === 'string') {
        return value.trim().length > 0;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value);
    }

    if (typeof value === 'boolean') {
        return true;
    }

    if (Array.isArray(value)) {
        return value.some(item => hasStructuredResumeValue(item, depth + 1));
    }

    if (typeof value === 'object') {
        return Object.values(value).some(item => hasStructuredResumeValue(item, depth + 1));
    }

    return false;
}

function hasParsedResumeSections(parsedResume) {
    if (!parsedResume || typeof parsedResume !== 'object') {
        return false;
    }

    return PARSED_RESUME_SECTION_KEYS.some(key => {
        const value = parsedResume[key];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
}

function hasParsedResumeContent(parsedResume) {
    if (!parsedResume || typeof parsedResume !== 'object') {
        return false;
    }

    return hasParsedResumeSections(parsedResume)
        || hasStructuredResumeValue(parsedResume.structuredData)
        || (typeof parsedResume.ocrText === 'string' && parsedResume.ocrText.trim().length > 0);
}

function createDefaultParsedResumeData(resumeData) {
    return normalizeParsedResumeData({
        isParsed: false,
        parser: '',
        sourceFileName: resumeData?.name || '',
        sourceUploadedAt: resumeData?.uploadedAt || null,
        parsedAt: null,
        updatedAt: new Date().toISOString(),
        ocrText: '',
        ocrPageCount: 0,
        structuredData: null,
        resumeSummary: '',
        skills: [],
        experienceHighlights: [],
        educationHighlights: [],
        certifications: [],
        projects: []
    });
}

function normalizeParsedResumeData(parsedResume) {
    const source = parsedResume && typeof parsedResume === 'object' ? parsedResume : {};
    const normalized = {
        isParsed: source.isParsed === true,
        parser: typeof source.parser === 'string' ? source.parser.trim() : '',
        sourceFileName: typeof source.sourceFileName === 'string' ? source.sourceFileName.trim() : '',
        sourceUploadedAt: getIsoTimestamp(source.sourceUploadedAt, null),
        parsedAt: getIsoTimestamp(source.parsedAt, null),
        updatedAt: getIsoTimestamp(source.updatedAt, new Date().toISOString()),
        ocrText: typeof source.ocrText === 'string'
            ? source.ocrText.trim().slice(0, MAX_RESUME_OCR_TEXT_LENGTH)
            : '',
        ocrPageCount: Number.isFinite(Number(source.ocrPageCount))
            ? Math.max(0, Math.min(Math.round(Number(source.ocrPageCount)), 500))
            : 0,
        structuredData: sanitizeStructuredResumeValue(source.structuredData),
        resumeSummary: typeof source.resumeSummary === 'string' ? source.resumeSummary.trim() : '',
        skills: sanitizeStringList(source.skills, 40),
        experienceHighlights: sanitizeStringList(source.experienceHighlights, 20),
        educationHighlights: sanitizeStringList(source.educationHighlights, 12),
        certifications: sanitizeStringList(source.certifications, 20),
        projects: sanitizeStringList(source.projects, 20)
    };

    normalized.isParsed = normalized.isParsed && hasParsedResumeContent(normalized);
    if (!normalized.isParsed) {
        normalized.parsedAt = null;
    }

    return normalized;
}

function readNestedValue(source, path) {
    if (!source || typeof source !== 'object' || typeof path !== 'string') {
        return undefined;
    }

    return path.split('.').reduce((current, segment) => {
        if (!current || typeof current !== 'object') {
            return undefined;
        }

        return current[segment];
    }, source);
}

function firstStringValue(source, paths, fallback = '') {
    for (const path of paths) {
        const value = readNestedValue(source, path);
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return fallback;
}

function firstArrayValue(source, paths) {
    for (const path of paths) {
        const value = readNestedValue(source, path);
        if (Array.isArray(value)) {
            return value;
        }
    }

    return [];
}

function formatResumeTimeline(startDate, endDate, current) {
    const parts = [];
    if (typeof startDate === 'string' && startDate.trim()) {
        parts.push(startDate.trim());
    }

    if (typeof endDate === 'string' && endDate.trim()) {
        parts.push(endDate.trim());
    } else if (current === true) {
        parts.push('Present');
    }

    return parts.length > 0 ? parts.join(' - ') : '';
}

function summarizeStructuredEntries(entries, formatter, maxItems) {
    if (!Array.isArray(entries)) {
        return [];
    }

    return sanitizeStringList(entries.map(entry => formatter(entry)).filter(Boolean), maxItems, 280);
}

function summarizeExperienceEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const title = firstStringValue(entry, ['title', 'role', 'position']);
    const company = firstStringValue(entry, ['company', 'organization', 'employer']);
    const timeline = formatResumeTimeline(entry.startDate, entry.endDate, entry.current);
    const summary = firstStringValue(entry, ['summary', 'description']);
    const lead = [
        title && company ? `${title} at ${company}` : (title || company),
        timeline ? `(${timeline})` : ''
    ].filter(Boolean).join(' ');

    return [lead, summary].filter(Boolean).join(' - ');
}

function summarizeEducationEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const degree = firstStringValue(entry, ['degree', 'credential']);
    const fieldOfStudy = firstStringValue(entry, ['fieldOfStudy', 'field', 'major']);
    const institution = firstStringValue(entry, ['institution', 'school', 'university']);
    const timeline = formatResumeTimeline(entry.startDate, entry.endDate, false);
    const lead = [
        [degree, fieldOfStudy].filter(Boolean).join(', '),
        institution
    ].filter(Boolean).join(' at ');

    return [lead || institution, timeline ? `(${timeline})` : ''].filter(Boolean).join(' ');
}

function summarizeCertificationEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const name = firstStringValue(entry, ['name', 'title']);
    const issuer = firstStringValue(entry, ['issuer', 'organization']);
    const issuedAt = firstStringValue(entry, ['date', 'issuedAt']);
    return [name, issuer ? `by ${issuer}` : '', issuedAt ? `(${issuedAt})` : ''].filter(Boolean).join(' ');
}

function summarizeProjectEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const name = firstStringValue(entry, ['name', 'title']);
    const role = firstStringValue(entry, ['role']);
    const summary = firstStringValue(entry, ['summary', 'description']);
    return [name, role ? `(${role})` : '', summary ? `- ${summary}` : ''].filter(Boolean).join(' ');
}

function buildParsedResumeFromStructuredData(resumeData, ocrResult, structuredData) {
    const now = new Date().toISOString();
    const sanitizedStructuredData = sanitizeStructuredResumeValue(structuredData);
    const summary = firstStringValue(sanitizedStructuredData, [
        'resumeSummary',
        'summary',
        'professionalSummary',
        'basics.summary',
        'basics.headline'
    ]);
    const skills = sanitizeStringList([
        ...firstArrayValue(sanitizedStructuredData, ['skills', 'coreSkills']),
        ...firstArrayValue(sanitizedStructuredData, ['languages']),
        ...firstArrayValue(sanitizedStructuredData, ['tools'])
    ], 40);
    const workExperience = firstArrayValue(sanitizedStructuredData, ['workExperience', 'experience', 'employment']);
    const education = firstArrayValue(sanitizedStructuredData, ['education', 'educationHistory']);
    const certifications = firstArrayValue(sanitizedStructuredData, ['certifications', 'licenses']);
    const projects = firstArrayValue(sanitizedStructuredData, ['projects']);

    return normalizeParsedResumeData({
        isParsed: true,
        parser: MISTRAL_OCR_MODEL,
        sourceFileName: resumeData?.name || '',
        sourceUploadedAt: resumeData?.uploadedAt || null,
        parsedAt: now,
        updatedAt: now,
        ocrText: ocrResult?.text || '',
        ocrPageCount: ocrResult?.pageCount || 0,
        structuredData: sanitizedStructuredData,
        resumeSummary: summary,
        skills,
        experienceHighlights: summarizeStructuredEntries(workExperience, summarizeExperienceEntry, 20),
        educationHighlights: summarizeStructuredEntries(education, summarizeEducationEntry, 12),
        certifications: summarizeStructuredEntries(certifications, summarizeCertificationEntry, 20),
        projects: summarizeStructuredEntries(projects, summarizeProjectEntry, 20)
    });
}

function parseJsonObjectFromText(rawText) {
    const responseText = typeof rawText === 'string' ? rawText.trim() : '';
    if (!responseText) {
        throw new Error('Mistral returned an empty resume parsing response.');
    }

    const cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

    const candidates = [cleaned];
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            continue;
        }
    }

    throw new Error('Could not parse structured resume JSON from the model response.');
}

async function getStoredResumeData() {
    const result = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
    return result[RESUME_STORAGE_KEY] || null;
}

async function getStoredParsedResumeData() {
    const result = await chrome.storage.local.get([RESUME_STORAGE_KEY, RESUME_PARSED_STORAGE_KEY]);
    const resume = result[RESUME_STORAGE_KEY] || null;
    const parsedResume = result[RESUME_PARSED_STORAGE_KEY] || null;

    if (parsedResume) {
        return normalizeParsedResumeData(parsedResume);
    }

    return resume ? createDefaultParsedResumeData(resume) : null;
}

async function saveParsedResumeData(parsedResumeData) {
    const resume = await getStoredResumeData();
    const normalized = normalizeParsedResumeData({
        ...(resume ? createDefaultParsedResumeData(resume) : {}),
        ...(parsedResumeData || {})
    });

    await chrome.storage.local.set({
        [RESUME_PARSED_STORAGE_KEY]: normalized
    });

    return normalized;
}

function isResumeParsingCurrent(resume, parsedResume) {
    if (!resume || !parsedResume || parsedResume.isParsed !== true) {
        return false;
    }

    return parsedResume.sourceFileName === (resume.name || '')
        && parsedResume.sourceUploadedAt === (resume.uploadedAt || null)
        && hasParsedResumeContent(parsedResume);
}

async function requestResumeOcr(resumeData, apiKey) {
    const documentUrl = typeof resumeData?.data === 'string' ? resumeData.data.trim() : '';
    if (!documentUrl || !documentUrl.startsWith('data:')) {
        throw new Error('Stored resume data is missing a readable document payload.');
    }

    const response = await fetch(MISTRAL_OCR_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: MISTRAL_OCR_MODEL,
            document: {
                type: 'document_url',
                document_url: documentUrl
            },
            include_image_base64: false
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const apiMessage = data?.message || data?.error?.message || `Mistral OCR request failed with ${response.status}`;
        throw new Error(apiMessage);
    }

    const pages = Array.isArray(data?.pages) ? data.pages : [];
    const markdownPages = pages
        .map(page => typeof page?.markdown === 'string' ? page.markdown.trim() : '')
        .filter(Boolean);

    if (markdownPages.length === 0) {
        throw new Error('Mistral OCR did not return any readable resume pages.');
    }

    const text = markdownPages.join('\n\n--- Page Break ---\n\n').trim().slice(0, MAX_RESUME_OCR_TEXT_LENGTH);
    return {
        pageCount: pages.length || markdownPages.length,
        text,
        pages: markdownPages
    };
}

function buildResumeStructuringMessages(resumeData, ocrResult) {
    const truncatedText = (ocrResult?.text || '').slice(0, MAX_RESUME_OCR_PROMPT_LENGTH);

    return [
        {
            role: 'system',
            content: [
                'You extract resume data into strict JSON for downstream autofill and job application assistance.',
                'Use only the OCR text provided from the resume document.',
                'Do not invent employers, dates, degrees, skills, certifications, links, or achievements.',
                'If a field is missing, use an empty string, false, or an empty array.',
                'Return JSON only with this exact top-level shape:',
                '{"basics":{"name":"","email":"","phone":"","location":"","headline":"","summary":"","linkedin":"","website":"","github":"","portfolio":""},"skills":[],"workExperience":[{"company":"","title":"","location":"","startDate":"","endDate":"","current":false,"summary":"","highlights":[],"technologies":[]}],"education":[{"institution":"","degree":"","fieldOfStudy":"","location":"","startDate":"","endDate":"","gpa":"","highlights":[]}],"certifications":[{"name":"","issuer":"","date":"","credentialId":"","url":""}],"projects":[{"name":"","role":"","summary":"","url":"","technologies":[],"highlights":[]}],"languages":[],"awards":[],"publications":[],"volunteerExperience":[{"organization":"","role":"","startDate":"","endDate":"","summary":"","highlights":[]}],"additionalSections":[{"title":"","items":[]}]}',
                'Preserve wording from the resume when possible, but keep list items concise.'
            ].join(' ')
        },
        {
            role: 'user',
            content: [
                `Resume file: ${resumeData?.name || ''}`,
                `OCR page count: ${ocrResult?.pageCount || 0}`,
                'OCR markdown:',
                truncatedText
            ].join('\n\n')
        }
    ];
}

async function structureResumeFromOcr(resumeData, ocrResult, aiSettings) {
    const response = await fetch(MISTRAL_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${aiSettings.apiKey}`
        },
        body: JSON.stringify({
            model: aiSettings.model || 'mistral-small-latest',
            temperature: 0.1,
            top_p: 0.8,
            messages: buildResumeStructuringMessages(resumeData, ocrResult)
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const apiMessage = data?.message || data?.error?.message || `Mistral request failed with ${response.status}`;
        throw new Error(apiMessage);
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
        throw new Error('Mistral returned an empty structured resume response.');
    }

    return parseJsonObjectFromText(answer);
}

async function parseAndStoreResumeData({ force = false } = {}) {
    const resume = await getStoredResumeData();
    if (!resume) {
        throw new Error('No resume is currently stored.');
    }

    const existingParsedResume = await getStoredParsedResumeData();
    if (!force && isResumeParsingCurrent(resume, existingParsedResume)) {
        return existingParsedResume;
    }

    const settings = await getStoredSettings();
    const aiSettings = settings.aiAssist || getDefaultAiAssistSettings();

    if (!aiSettings.enabled) {
        throw new Error('AI assistance is disabled in settings.');
    }

    if (!aiSettings.apiKey) {
        throw new Error('Missing Mistral API key. Add it in Settings > AI Assistance.');
    }

    const ocrResult = await requestResumeOcr(resume, aiSettings.apiKey);
    const structuredData = await structureResumeFromOcr(resume, ocrResult, aiSettings);
    return await saveParsedResumeData(buildParsedResumeFromStructuredData(resume, ocrResult, structuredData));
}

async function ensureParsedResumeData() {
    const resume = await getStoredResumeData();
    if (!resume) {
        return null;
    }

    const parsedResume = await getStoredParsedResumeData();
    if (isResumeParsingCurrent(resume, parsedResume)) {
        return parsedResume;
    }

    try {
        return await parseAndStoreResumeData();
    } catch (error) {
        console.warn('[JobAutofill] Failed to refresh structured resume data:', error);
        return parsedResume;
    }
}

function buildStoredResumeContextText(parsedResume) {
    if (!parsedResume || parsedResume.isParsed !== true) {
        return '';
    }

    const sections = [
        parsedResume.resumeSummary ? `Resume summary:\n${parsedResume.resumeSummary}` : '',
        parsedResume.skills?.length ? `Skills:\n- ${parsedResume.skills.join('\n- ')}` : '',
        parsedResume.experienceHighlights?.length ? `Experience highlights:\n- ${parsedResume.experienceHighlights.join('\n- ')}` : '',
        parsedResume.educationHighlights?.length ? `Education highlights:\n- ${parsedResume.educationHighlights.join('\n- ')}` : '',
        parsedResume.certifications?.length ? `Certifications:\n- ${parsedResume.certifications.join('\n- ')}` : '',
        parsedResume.projects?.length ? `Projects:\n- ${parsedResume.projects.join('\n- ')}` : ''
    ].filter(Boolean);

    const structuredJson = parsedResume.structuredData
        ? JSON.stringify(parsedResume.structuredData, null, 2).slice(0, MAX_RESUME_CONTEXT_JSON_LENGTH)
        : '';

    if (structuredJson) {
        sections.push(`Structured resume JSON:\n${structuredJson}`);
    }

    return sections.join('\n\n');
}

async function resolveResumeContext(payload, aiSettings) {
    const providedContext = typeof payload?.resumeContext === 'string' ? payload.resumeContext.trim() : '';
    if (providedContext || aiSettings?.useParsedResumeData === false) {
        return providedContext;
    }

    const parsedResume = await ensureParsedResumeData();
    return buildStoredResumeContextText(parsedResume);
}

async function resolveParsedResumeData(payload, aiSettings) {
    if (aiSettings?.useParsedResumeData === false) {
        return null;
    }

    const providedParsedResume = sanitizeStructuredResumeValue(payload?.parsedResumeData);
    if (providedParsedResume) {
        return providedParsedResume;
    }

    const parsedResume = await ensureParsedResumeData();
    return sanitizeStructuredResumeValue(parsedResume?.structuredData);
}

async function loadLocalAiConfig() {
    if (localAiConfigCache) {
        return localAiConfigCache;
    }

    if (!canUseExtensionRuntimeUrl()) {
        localAiConfigCache = {};
        return localAiConfigCache;
    }

    try {
        const configUrl = chrome.runtime.getURL('local/ai-config.local.json');
        if (!configUrl || configUrl.startsWith('chrome-extension://invalid/')) {
            localAiConfigCache = {};
            return localAiConfigCache;
        }

        const response = await fetch(configUrl, {
            cache: 'no-store'
        });

        if (!response.ok) {
            localAiConfigCache = {};
            return localAiConfigCache;
        }

        localAiConfigCache = await response.json();
        return localAiConfigCache;
    } catch (error) {
        localAiConfigCache = {};
        return localAiConfigCache;
    }
}

async function getStoredSettings() {
    const result = await chrome.storage.local.get([SETTINGS_STORAGE_KEY]);
    const settings = result[SETTINGS_STORAGE_KEY] || {};
    const localAiConfig = await loadLocalAiConfig();
    const localAiSettings = localAiConfig.aiAssist || {};
    const storedAiSettings = settings.aiAssist || {};

    return {
        autoDetect: settings.autoDetect !== false,
        showIndicators: settings.showIndicators !== false,
        confirmBeforeFill: settings.confirmBeforeFill === true,
        aiAssist: {
            ...getDefaultAiAssistSettings(),
            ...localAiSettings,
            ...storedAiSettings,
            apiKey: storedAiSettings.apiKey || localAiSettings.apiKey || ''
        }
    };
}

function buildAiMessages(payload, aiSettings) {
    const maxCharacters = Math.max(80, Math.min(Number(aiSettings.maxCharacters) || 320, 1200));
    const userProfile = JSON.stringify(payload.userProfile || {}, null, 2);
    const relevantProfileContext = JSON.stringify(payload.relevantProfileContext || {}, null, 2);
    const choiceOptions = Array.isArray(payload.choiceOptions) ? payload.choiceOptions.filter(Boolean) : [];
    const isChoicePrompt = choiceOptions.length > 0;
    const resumeContext = (payload.resumeContext || '').trim();
    const parsedResumeJson = payload.parsedResumeData
        ? JSON.stringify(payload.parsedResumeData, null, 2).slice(0, MAX_RESUME_CONTEXT_JSON_LENGTH)
        : '';

    return [
        {
            role: 'system',
            content: [
                'You write concise, job-application answers for screening questions.',
                'Use only the provided profile, job posting, and extra context.',
                'Do not invent employers, years, certifications, tools, or achievements not present in the context.',
                'If structured resume context or parsed resume JSON is provided, treat it as the strongest resume evidence and prioritize those facts and phrasing over generic filler.',
                'If relevant profile context includes a resumeExperienceAssessment, treat its qualified flag, years, and matched evidence as authoritative for binary experience questions.',
                'Answer only the specific question for the specific field shown in the prompt.',
                'If helper text narrows the answer, follow it.',
                isChoicePrompt ? 'When options are provided, act like an autofill copilot for this single field. Prefer parsed resume JSON and the relevant profile facts for this field over the full profile, ignore unrelated details, and choose the single option label that best matches the user. Return exactly one option label from the list and do not explain your choice.' : 'When generating typed answers, ground the answer in parsed resume JSON and structured resume context whenever they are available.',
                isChoicePrompt && payload.preferredProfileAnswer ? `The saved profile answer for this field is: ${payload.preferredProfileAnswer}. You must choose the option that matches this saved answer and never choose the opposite meaning.` : '',
                'Answer in first person, keep it professional but natural, and tailor it to the job posting when relevant.',
                `Return plain text only and keep the answer under ${maxCharacters} characters unless the question explicitly asks for more detail.`
            ].join(' ')
        },
        {
            role: 'user',
            content: [
                `Question: ${payload.question || ''}`,
                `Field label/context: ${payload.fieldLabel || ''}`,
                payload.helperText ? `Helper text: ${payload.helperText}` : '',
                payload.sectionContext ? `Nearby section text: ${payload.sectionContext}` : '',
                payload.detectedFieldType ? `Detected field type: ${payload.detectedFieldType}` : '',
                payload.preferredProfileAnswer ? `Saved profile answer: ${payload.preferredProfileAnswer}` : '',
                payload.fieldHtmlType ? `Field type: ${payload.fieldHtmlType}` : '',
                isChoicePrompt ? `Available options:\n${choiceOptions.map((option, index) => `${index + 1}. ${option}`).join('\n')}` : '',
                isChoicePrompt ? `Relevant profile facts for this field:\n${relevantProfileContext}` : '',
                `Page title: ${payload.pageTitle || ''}`,
                'User profile:',
                userProfile,
                parsedResumeJson ? `Parsed resume JSON:\n${parsedResumeJson}` : '',
                resumeContext ? `Structured resume context:\n${resumeContext}` : '',
                aiSettings.extraContext ? `Additional resume context: ${aiSettings.extraContext}` : '',
                payload.jobPostingText ? `Job posting excerpt:\n${payload.jobPostingText}` : ''
            ].filter(Boolean).join('\n\n')
        }
    ];
}

function buildAiBatchMessages(payloads, aiSettings) {
    const maxCharacters = Math.max(80, Math.min(Number(aiSettings.maxCharacters) || 320, 1200));
    const firstPayload = payloads[0] || {};
    const userProfile = JSON.stringify(firstPayload.userProfile || {}, null, 2);
    const resumeContext = (firstPayload.resumeContext || '').trim();
    const parsedResumeJson = firstPayload.parsedResumeData
        ? JSON.stringify(firstPayload.parsedResumeData, null, 2).slice(0, MAX_RESUME_CONTEXT_JSON_LENGTH)
        : '';
    const sharedContext = [
        `Page title: ${firstPayload.pageTitle || ''}`,
        'User profile:',
        userProfile,
        parsedResumeJson ? `Parsed resume JSON:\n${parsedResumeJson}` : '',
        resumeContext ? `Structured resume context:\n${resumeContext}` : '',
        aiSettings.extraContext ? `Additional resume context: ${aiSettings.extraContext}` : '',
        firstPayload.jobPostingText ? `Job posting excerpt:\n${firstPayload.jobPostingText}` : ''
    ].filter(Boolean).join('\n\n');

    const tasks = payloads.map((payload, index) => {
        const choiceOptions = Array.isArray(payload.choiceOptions) ? payload.choiceOptions.filter(Boolean) : [];
        const isChoicePrompt = choiceOptions.length > 0;

        return [
            `Task ${index}:`,
            `Question: ${payload.question || ''}`,
            `Field label/context: ${payload.fieldLabel || ''}`,
            payload.helperText ? `Helper text: ${payload.helperText}` : '',
            payload.sectionContext ? `Nearby section text: ${payload.sectionContext}` : '',
            payload.detectedFieldType ? `Detected field type: ${payload.detectedFieldType}` : '',
            payload.preferredProfileAnswer ? `Saved profile answer: ${payload.preferredProfileAnswer}` : '',
            payload.fieldHtmlType ? `Field type: ${payload.fieldHtmlType}` : '',
            isChoicePrompt ? `Relevant profile facts for this field:\n${JSON.stringify(payload.relevantProfileContext || {}, null, 2)}` : '',
            isChoicePrompt ? `Available options:\n${choiceOptions.map((option, optionIndex) => `${optionIndex + 1}. ${option}`).join('\n')}` : ''
        ].filter(Boolean).join('\n');
    }).join('\n\n');

    return [
        {
            role: 'system',
            content: [
                'You write concise, job-application answers for screening questions.',
                'Use only the provided profile, job posting, and extra context.',
                'Do not invent employers, years, certifications, tools, or achievements not present in the context.',
                'If parsed resume JSON or structured resume context is provided, treat it as the strongest resume evidence.',
                'If a task includes resumeExperienceAssessment in relevant profile facts, treat its qualified flag, years, and matched evidence as authoritative for binary experience questions.',
                'If a task includes options, act like an autofill copilot for that single field. Prefer parsed resume JSON and the relevant profile facts for that field over the full profile, choose the single option label that best matches the user, and never return an opposite meaning to the saved profile answer.',
                'Return strict JSON only with this shape: {"answers":[{"index":0,"answer":"..."}]}.',
                'Include one answer for every task index in order.',
                `Each answer must be plain text and under ${maxCharacters} characters unless the task explicitly asks for more detail.`
            ].join(' ')
        },
        {
            role: 'user',
            content: [
                'Shared context:',
                sharedContext,
                'Tasks:',
                tasks
            ].filter(Boolean).join('\n\n')
        }
    ];
}

function parseBatchAnswerJson(rawText) {
    const responseText = typeof rawText === 'string' ? rawText.trim() : '';
    if (!responseText) {
        throw new Error('Mistral returned an empty batch response.');
    }

    const cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

    const candidateTexts = [cleaned];
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidateTexts.push(cleaned.slice(firstBrace, lastBrace + 1));
    }

    for (const candidateText of candidateTexts) {
        try {
            const parsed = JSON.parse(candidateText);
            const answers = Array.isArray(parsed) ? parsed : parsed?.answers;
            if (!Array.isArray(answers)) {
                continue;
            }

            return answers.map((item, index) => ({
                index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index,
                answer: typeof item?.answer === 'string' ? item.answer.trim() : ''
            }));
        } catch (error) {
            continue;
        }
    }

    throw new Error('Could not parse batched AI response as JSON.');
}

async function generateMistralAnswer(payload) {
    const settings = await getStoredSettings();
    const aiSettings = settings.aiAssist || getDefaultAiAssistSettings();

    if (!aiSettings.enabled) {
        throw new Error('AI assistance is disabled in settings.');
    }

    if (!aiSettings.apiKey) {
        throw new Error('Missing Mistral API key. Add it in Settings > AI Assistance.');
    }

    const resumeContext = await resolveResumeContext(payload, aiSettings);
    const parsedResumeData = await resolveParsedResumeData(payload, aiSettings);
    const requestPayload = {
        ...(payload || {}),
        resumeContext,
        parsedResumeData
    };

    const response = await fetch(MISTRAL_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${aiSettings.apiKey}`
        },
        body: JSON.stringify({
            model: aiSettings.model || 'mistral-small-latest',
            temperature: 0.4,
            top_p: 0.9,
            messages: buildAiMessages(requestPayload, aiSettings)
        })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const apiMessage = data?.message || data?.error?.message || `Mistral request failed with ${response.status}`;
        throw new Error(apiMessage);
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
        throw new Error('Mistral returned an empty answer.');
    }

    return {
        answer,
        model: aiSettings.model || 'mistral-small-latest'
    };
}

async function generateMistralAnswerBatch(payloads) {
    const requests = Array.isArray(payloads) ? payloads.filter(payload => payload && typeof payload === 'object') : [];
    if (requests.length === 0) {
        throw new Error('No AI batch payloads were provided.');
    }

    if (requests.length === 1) {
        const singleResult = await generateMistralAnswer(requests[0]);
        return {
            answers: [{ success: true, ...singleResult }],
            model: singleResult.model
        };
    }

    const settings = await getStoredSettings();
    const aiSettings = settings.aiAssist || getDefaultAiAssistSettings();

    if (!aiSettings.enabled) {
        throw new Error('AI assistance is disabled in settings.');
    }

    if (!aiSettings.apiKey) {
        throw new Error('Missing Mistral API key. Add it in Settings > AI Assistance.');
    }

    const resumeContext = await resolveResumeContext(requests[0] || {}, aiSettings);
    const parsedResumeData = await resolveParsedResumeData(requests[0] || {}, aiSettings);
    const enrichedRequests = requests.map(payload => ({
        ...payload,
        resumeContext: typeof payload?.resumeContext === 'string' && payload.resumeContext.trim()
            ? payload.resumeContext.trim()
            : resumeContext,
        parsedResumeData: payload?.parsedResumeData || parsedResumeData
    }));

    const response = await fetch(MISTRAL_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${aiSettings.apiKey}`
        },
        body: JSON.stringify({
            model: aiSettings.model || 'mistral-small-latest',
            temperature: 0.2,
            top_p: 0.9,
            messages: buildAiBatchMessages(enrichedRequests, aiSettings)
        })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const apiMessage = data?.message || data?.error?.message || `Mistral request failed with ${response.status}`;
        throw new Error(apiMessage);
    }

    const rawContent = data?.choices?.[0]?.message?.content?.trim();
    const parsedAnswers = parseBatchAnswerJson(rawContent);
    const answerMap = new Map(parsedAnswers.map(item => [item.index, item.answer]));

    return {
        answers: requests.map((_, index) => {
            const answer = answerMap.get(index) || '';
            return answer
                ? { success: true, answer, model: aiSettings.model || 'mistral-small-latest' }
                : { success: false, error: `Missing answer for batch item ${index}` };
        }),
        model: aiSettings.model || 'mistral-small-latest'
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMessageWithTimeout(tabId, message, timeoutMs = MESSAGE_TIMEOUT_MS) {
    return await Promise.race([
        chrome.tabs.sendMessage(tabId, message),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Timed out waiting for ${message.action}`)), timeoutMs);
        })
    ]);
}

async function waitForContentScriptReady(tabId) {
    for (let attempt = 0; attempt < INJECTION_RETRY_COUNT; attempt += 1) {
        try {
            const response = await sendMessageWithTimeout(tabId, { action: 'ping' });
            if (response?.pong && response?.ready) {
                return true;
            }
        } catch (error) {
            if (attempt === INJECTION_RETRY_COUNT - 1) {
                throw error;
            }
        }

        await delay(INJECTION_RETRY_DELAY_MS);
    }

    return false;
}

async function ensureContentScriptInjected(tabId) {
    try {
        return await waitForContentScriptReady(tabId);
    } catch (error) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: CONTENT_SCRIPT_FILES
            });
            await chrome.scripting.insertCSS({
                target: { tabId },
                files: CONTENT_SCRIPT_CSS
            });

            return await waitForContentScriptReady(tabId);
        } catch (injectError) {
            console.error('Failed to inject content script:', injectError);
            return false;
        }
    }
}

async function triggerAutofillForTab(tabId) {
    const injected = await ensureContentScriptInjected(tabId);
    if (!injected) {
        return {
            success: false,
            error: 'Could not connect to the page. Try refreshing the page.'
        };
    }

    try {
        await sendMessageWithTimeout(tabId, { action: 'refreshRuntimeData' });
    } catch (error) {
        console.warn('Failed to refresh content-script runtime state before autofill:', error);
    }

    return await sendMessageWithTimeout(tabId, { action: 'triggerAutofill' }, 20000);
}

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'trigger-autofill') {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab?.id) {
            try {
                const response = await triggerAutofillForTab(tab.id);
                if (!response?.success) {
                    throw new Error(response?.error || 'Autofill failed');
                }

                // Update badge to show action
                chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
                chrome.action.setBadgeBackgroundColor({ color: '#00c389', tabId: tab.id });

                // Clear badge after 2 seconds
                setTimeout(() => {
                    chrome.action.setBadgeText({ text: '', tabId: tab.id });
                }, 2000);
            } catch (error) {
                console.error('Failed to trigger autofill:', error);
                // Show error badge
                chrome.action.setBadgeText({ text: '!', tabId: tab.id });
                chrome.action.setBadgeBackgroundColor({ color: '#ff3d3d', tabId: tab.id });

                setTimeout(() => {
                    chrome.action.setBadgeText({ text: '', tabId: tab.id });
                }, 2000);
            }
        }
    }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
        sendResponse({ pong: true });
        return true;
    }

    if (message.action === 'getTabId') {
        sendResponse({ tabId: sender.tab?.id });
        return true;
    }

    if (message.action === 'updateBadge') {
        const tabId = sender.tab?.id;
        if (tabId) {
            chrome.action.setBadgeText({
                text: message.text || '',
                tabId
            });
            if (message.color) {
                chrome.action.setBadgeBackgroundColor({
                    color: message.color,
                    tabId
                });
            }
        }
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'triggerAutofillFromPopup') {
        // Forward to the active tab's content script
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.id) {
                    sendResponse({ success: false, error: 'No active tab found' });
                    return;
                }

                const response = await triggerAutofillForTab(tab.id);
                sendResponse(response);
            } catch (error) {
                sendResponse({ success: false, error: error.message || 'Failed to trigger autofill' });
            }
        })();
        return true; // Keep channel open for async response
    }

    if (message.action === 'generateAiAnswer') {
        (async () => {
            try {
                const result = await generateMistralAnswer(message.payload || {});
                sendResponse({ success: true, ...result });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to generate AI answer'
                });
            }
        })();
        return true;
    }

    if (message.action === 'getLocalAiConfig') {
        (async () => {
            try {
                const aiConfig = await loadLocalAiConfig();
                sendResponse({ success: true, aiConfig });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to load local AI config',
                    aiConfig: {}
                });
            }
        })();
        return true;
    }

    if (message.action === 'parseStoredResume') {
        (async () => {
            try {
                const parsedResume = await parseAndStoreResumeData({ force: message.force === true });
                sendResponse({ success: true, parsedResume });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to parse the stored resume.'
                });
            }
        })();
        return true;
    }

    if (message.action === 'generateAiAnswerBatch') {
        (async () => {
            try {
                const result = await generateMistralAnswerBatch(message.payloads || []);
                sendResponse({ success: true, ...result });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to generate batched AI answers'
                });
            }
        })();
        return true;
    }

    if (message.action === 'getExtensionUpdateStatus') {
        (async () => {
            try {
                const updateStatus = await getExtensionUpdateStatus({ force: message.force === true });
                sendResponse({ success: true, ...updateStatus });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to check for updates.'
                });
            }
        })();
        return true;
    }

    return false;
});

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
    getExtensionUpdateStatus({ force: true }).catch(error => {
        console.warn('Failed to refresh GitHub update status during install/update:', error);
    });

    if (details.reason === 'install') {
        // Open options page on first install for setup
        chrome.tabs.create({ url: 'popup/popup.html?setup=true' });
    }
});

chrome.runtime.onStartup.addListener(() => {
    getExtensionUpdateStatus().catch(error => {
        console.warn('Failed to refresh GitHub update status on startup:', error);
    });
});

// Update badge when tab changes to show if autofill is available
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (isJobSite(tab.url)) {
            // Check if user has completed setup
            const result = await chrome.storage.local.get([USER_DATA_STORAGE_KEY]);
            if (result[USER_DATA_STORAGE_KEY]) {
                chrome.action.setBadgeText({ text: '', tabId: activeInfo.tabId });
            }
        }
    } catch (error) {
        // Tab might not exist anymore
    }
});

/**
 * Check if URL is a likely job application site
 * @param {string} url 
 * @returns {boolean}
 */
function isJobSite(url) {
    if (!url) return false;

    const jobSitePatterns = [
        'linkedin.com',
        'indeed.com',
        'glassdoor.com',
        'lever.co',
        'greenhouse.io',
        'workday.com',
        'myworkdayjobs.com',
        'icims.com',
        'taleo.net',
        'smartrecruiters.com',
        'jobvite.com',
        'ziprecruiter.com',
        'monster.com',
        'careerbuilder.com',
        'dice.com',
        'hired.com',
        'angel.co',
        'wellfound.com',
        'ashbyhq.com',
        'bamboohr.com',
        'recruitee.com',
        'breezy.hr',
        'jazz.co',
        'jazzhr.com',
        'pinpointhq.com',
        'rippling.com',
        'applytojob.com',
        'workable.com',
        'fountain.com',
        'hirebridge.com',
        'paylocity.com',
        'paycom.com',
        'adp.com',
        'successfactors.com',
        'oraclecloud.com'
    ];

    const urlLower = url.toLowerCase();
    return jobSitePatterns.some(pattern => urlLower.includes(pattern)) ||
        urlLower.includes('career') ||
        urlLower.includes('jobs') ||
        urlLower.includes('apply');
}
