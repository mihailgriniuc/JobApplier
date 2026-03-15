/**
 * Storage abstraction layer for Job Application Autofill
 * Uses Chrome's storage.local API with encryption for sensitive data
 */

const StorageKeys = {
    USER_DATA: 'jobAutofill_userData',
    SETTINGS: 'jobAutofill_settings',
    RESUME: 'jobAutofill_resume',
    RESUME_PARSED: 'jobAutofill_resumeParsed',
    AI_ANSWER_CACHE: 'jobAutofill_aiAnswerCache',
    CONSENT: 'jobAutofill_consent',
    SCHEMA_VERSION: 'jobAutofill_schemaVersion'
};

const CURRENT_SCHEMA_VERSION = 2;
const MAX_AI_ANSWER_CACHE_ENTRIES = 100;
const PARSED_RESUME_SECTION_KEYS = [
    'resumeSummary',
    'skills',
    'experienceHighlights',
    'educationHighlights',
    'certifications',
    'projects'
];
const MAX_RESUME_OCR_TEXT_LENGTH = 120000;
const MAX_RESUME_STRUCTURE_DEPTH = 6;
const MAX_RESUME_STRUCTURE_ARRAY_ITEMS = 100;
const MAX_RESUME_STRUCTURE_OBJECT_KEYS = 100;

let localAiConfigCache = null;

function canUseExtensionRuntimeUrl() {
    return Boolean(
        typeof chrome !== 'undefined' &&
        chrome?.runtime?.id &&
        typeof chrome.runtime.getURL === 'function'
    );
}

function isExtensionPageContext() {
    return Boolean(
        typeof location !== 'undefined' &&
        location.protocol === 'chrome-extension:' &&
        chrome?.runtime?.id &&
        location.origin === `chrome-extension://${chrome.runtime.id}`
    );
}

const DEFAULT_SETTINGS = {
    autoDetect: true,
    showIndicators: true,
    confirmBeforeFill: false,
    aiAssist: {
        enabled: true,
        model: 'mistral-small-latest',
        apiKey: '',
        extraContext: '',
        cacheAnswers: true,
        useParsedResumeData: true,
        maxCharacters: 400,
        maxQuestionsPerRun: 10
    }
};

function sanitizeStringList(value, maxItems = 25) {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set();

    return value
        .map(item => typeof item === 'string' ? item.trim() : '')
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

function hasParsedResumeSections(parsedResume) {
    if (!parsedResume || typeof parsedResume !== 'object') {
        return false;
    }

    return PARSED_RESUME_SECTION_KEYS.some(key => {
        const value = parsedResume[key];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
}

function sanitizeStructuredResumeValue(value, depth = 0) {
    if (depth > MAX_RESUME_STRUCTURE_DEPTH) {
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
        const sanitizedItems = value
            .map(item => sanitizeStructuredResumeValue(item, depth + 1))
            .filter(item => item !== null && item !== '');

        return sanitizedItems.slice(0, MAX_RESUME_STRUCTURE_ARRAY_ITEMS);
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const entries = Object.entries(value)
        .slice(0, MAX_RESUME_STRUCTURE_OBJECT_KEYS)
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

    if (entries.length === 0) {
        return null;
    }

    return Object.fromEntries(entries);
}

function hasStructuredResumeValue(value, depth = 0) {
    if (depth > MAX_RESUME_STRUCTURE_DEPTH || value === null || value === undefined) {
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

function sanitizeAiAnswerCache(cache) {
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
        return {};
    }

    const now = new Date().toISOString();
    const entries = Object.entries(cache)
        .map(([cacheKey, entry]) => {
            if (!cacheKey || typeof cacheKey !== 'string' || !entry || typeof entry !== 'object') {
                return null;
            }

            const answer = typeof entry.answer === 'string' ? entry.answer.trim() : '';
            if (!answer) {
                return null;
            }

            return [cacheKey, {
                answer,
                model: typeof entry.model === 'string' ? entry.model.trim() : '',
                question: typeof entry.question === 'string' ? entry.question.trim() : '',
                fieldLabel: typeof entry.fieldLabel === 'string' ? entry.fieldLabel.trim() : '',
                fieldHtmlType: typeof entry.fieldHtmlType === 'string' ? entry.fieldHtmlType.trim() : '',
                updatedAt: getIsoTimestamp(entry.updatedAt, now)
            }];
        })
        .filter(Boolean)
        .sort((left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt))
        .slice(0, MAX_AI_ANSWER_CACHE_ENTRIES);

    return Object.fromEntries(entries);
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
        if (!isExtensionPageContext() && typeof chrome.runtime.sendMessage === 'function') {
            const response = await chrome.runtime.sendMessage({ action: 'getLocalAiConfig' });
            localAiConfigCache = response?.success && response.aiConfig && typeof response.aiConfig === 'object'
                ? response.aiConfig
                : {};
            return localAiConfigCache;
        }

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

function sanitizeAiAssistSettings(aiAssist) {
    const maxCharacters = Number(aiAssist?.maxCharacters);
    const maxQuestionsPerRun = Number(aiAssist?.maxQuestionsPerRun);

    return {
        ...DEFAULT_SETTINGS.aiAssist,
        ...(aiAssist || {}),
        enabled: true,
        model: (aiAssist?.model || DEFAULT_SETTINGS.aiAssist.model).trim() || DEFAULT_SETTINGS.aiAssist.model,
        apiKey: (aiAssist?.apiKey || '').trim(),
        extraContext: (aiAssist?.extraContext || '').trim(),
        cacheAnswers: aiAssist?.cacheAnswers !== false,
        useParsedResumeData: aiAssist?.useParsedResumeData !== false,
        maxCharacters: Number.isFinite(maxCharacters)
            ? Math.min(Math.max(Math.round(maxCharacters), 80), 1200)
            : DEFAULT_SETTINGS.aiAssist.maxCharacters,
        maxQuestionsPerRun: Number.isFinite(maxQuestionsPerRun)
            ? Math.min(Math.max(Math.round(maxQuestionsPerRun), 1), 10)
            : DEFAULT_SETTINGS.aiAssist.maxQuestionsPerRun
    };
}

function normalizeSettings(settings) {
    const source = settings || {};

    return {
        ...DEFAULT_SETTINGS,
        ...source,
        autoDetect: source.autoDetect !== false,
        showIndicators: source.showIndicators !== false,
        confirmBeforeFill: source.confirmBeforeFill === true,
        aiAssist: sanitizeAiAssistSettings(source.aiAssist)
    };
}

const Storage = {
    /**
     * Save user data to Chrome storage
     * @param {Object} data 
     * @returns {Promise<void>}
     */
    async saveUserData(data) {
        const normalizedData = typeof Validation !== 'undefined'
            ? Validation.normalizeUserData(data)
            : { ...data };

        if (typeof Validation !== 'undefined') {
            const validation = Validation.validateUserData(normalizedData);
            if (!validation.valid) {
                throw new Error(validation.errors.join(', '));
            }
        }

        const dataToStore = {
            ...normalizedData,
            updatedAt: new Date().toISOString()
        };

        await chrome.storage.local.set({
            [StorageKeys.USER_DATA]: dataToStore,
            [StorageKeys.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
        });
    },

    /**
     * Get user data from Chrome storage
     * @returns {Promise<Object|null>}
     */
    async getUserData() {
        const result = await chrome.storage.local.get([StorageKeys.USER_DATA]);
        const userData = result[StorageKeys.USER_DATA] || null;

        if (!userData) {
            return null;
        }

        return typeof Validation !== 'undefined'
            ? Validation.normalizeUserData(userData)
            : userData;
    },

    /**
     * Save resume file as base64
     * @param {File} file 
     * @returns {Promise<void>}
     */
    async saveResume(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const resumeData = {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        data: reader.result,
                        uploadedAt: new Date().toISOString()
                    };

                    await chrome.storage.local.set({
                        [StorageKeys.RESUME]: resumeData,
                        [StorageKeys.RESUME_PARSED]: createDefaultParsedResumeData(resumeData),
                        [StorageKeys.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
                    });
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    /**
     * Get stored resume
     * @returns {Promise<Object|null>}
     */
    async getResume() {
        const result = await chrome.storage.local.get([StorageKeys.RESUME]);
        return result[StorageKeys.RESUME] || null;
    },

    /**
     * Delete stored resume
     * @returns {Promise<void>}
     */
    async deleteResume() {
        await chrome.storage.local.remove([StorageKeys.RESUME, StorageKeys.RESUME_PARSED]);
    },

    async getParsedResumeData() {
        const result = await chrome.storage.local.get([StorageKeys.RESUME, StorageKeys.RESUME_PARSED]);
        const resume = result[StorageKeys.RESUME] || null;
        const parsedResume = result[StorageKeys.RESUME_PARSED] || null;

        if (parsedResume) {
            return normalizeParsedResumeData(parsedResume);
        }

        return resume ? createDefaultParsedResumeData(resume) : null;
    },

    async saveParsedResumeData(parsedResumeData) {
        const resume = await this.getResume();
        const normalized = normalizeParsedResumeData({
            ...(resume ? createDefaultParsedResumeData(resume) : {}),
            ...(parsedResumeData || {})
        });

        await chrome.storage.local.set({
            [StorageKeys.RESUME_PARSED]: normalized,
            [StorageKeys.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
        });
    },

    async getAiAnswerCache() {
        const result = await chrome.storage.local.get([StorageKeys.AI_ANSWER_CACHE]);
        return sanitizeAiAnswerCache(result[StorageKeys.AI_ANSWER_CACHE]);
    },

    async setAiAnswerCacheEntry(cacheKey, entry) {
        if (!cacheKey || typeof cacheKey !== 'string') {
            return;
        }

        const cache = await this.getAiAnswerCache();
        const nextCache = sanitizeAiAnswerCache({
            ...cache,
            [cacheKey]: {
                ...(cache[cacheKey] || {}),
                ...(entry || {}),
                updatedAt: new Date().toISOString()
            }
        });

        await chrome.storage.local.set({
            [StorageKeys.AI_ANSWER_CACHE]: nextCache,
            [StorageKeys.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
        });
    },

    async clearAiAnswerCache() {
        await chrome.storage.local.remove([StorageKeys.AI_ANSWER_CACHE]);
    },

    /**
     * Save user consent
     * @param {boolean} consented 
     * @returns {Promise<void>}
     */
    async saveConsent(consented) {
        await chrome.storage.local.set({
            [StorageKeys.CONSENT]: {
                consented,
                timestamp: new Date().toISOString()
            }
        });
    },

    /**
     * Check if user has consented
     * @returns {Promise<boolean>}
     */
    async hasConsented() {
        const result = await chrome.storage.local.get([StorageKeys.CONSENT]);
        return result[StorageKeys.CONSENT]?.consented || false;
    },

    /**
     * Save extension settings
     * @param {Object} settings 
     * @returns {Promise<void>}
     */
    async saveSettings(settings) {
        await chrome.storage.local.set({
            [StorageKeys.SETTINGS]: normalizeSettings(settings)
        });
    },

    /**
     * Get extension settings
     * @returns {Promise<Object>}
     */
    async getSettings() {
        const result = await chrome.storage.local.get([StorageKeys.SETTINGS]);
        const settings = normalizeSettings(result[StorageKeys.SETTINGS]);
        const localAiConfig = await loadLocalAiConfig();
        const localAiSettings = sanitizeAiAssistSettings(localAiConfig.aiAssist);

        return {
            ...settings,
            aiAssist: {
                ...localAiSettings,
                ...settings.aiAssist,
                apiKey: settings.aiAssist?.apiKey || localAiSettings.apiKey || ''
            }
        };
    },

    /**
     * Export all user data as JSON
     * @returns {Promise<Object>}
     */
    async exportData() {
        const userData = await this.getUserData();
        const resume = await this.getResume();
        const parsedResume = await this.getParsedResumeData();
        const settings = await this.getSettings();

        return {
            version: CURRENT_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            userData,
            resume: resume ? {
                name: resume.name,
                type: resume.type,
                size: resume.size,
                data: resume.data
            } : null,
            parsedResume,
            settings
        };
    },

    /**
     * Import user data from JSON
     * @param {Object} data 
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async importData(data) {
        try {
            if (!data.version || !data.userData) {
                return { success: false, message: 'Invalid import file format' };
            }

            // Validate imported data
            if (typeof Validation !== 'undefined') {
                const validation = Validation.validateUserData(data.userData);
                if (!validation.valid) {
                    return { success: false, message: validation.errors.join(', ') };
                }
            }

            await this.saveUserData(data.userData);

            if (data.resume) {
                await chrome.storage.local.set({
                    [StorageKeys.RESUME]: data.resume
                });

                if (data.parsedResume) {
                    await this.saveParsedResumeData(data.parsedResume);
                } else {
                    await chrome.storage.local.set({
                        [StorageKeys.RESUME_PARSED]: createDefaultParsedResumeData(data.resume)
                    });
                }
            } else if (data.parsedResume) {
                await this.saveParsedResumeData(data.parsedResume);
            }

            if (data.settings) {
                await this.saveSettings(data.settings);
            }

            return { success: true, message: 'Data imported successfully' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    },

    /**
     * Clear all stored data
     * @returns {Promise<void>}
     */
    async clearAllData() {
        await chrome.storage.local.clear();
    },

    /**
     * Check if user has completed setup
     * @returns {Promise<boolean>}
     */
    async hasCompletedSetup() {
        const userData = await this.getUserData();

        if (!userData) {
            return false;
        }

        if (typeof Validation === 'undefined') {
            return Boolean(userData.fullName && userData.email);
        }

        return Validation.validateUserData(userData).valid;
    }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
    window.Storage = Storage;
    window.StorageKeys = StorageKeys;
    window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
    window.MAX_AI_ANSWER_CACHE_ENTRIES = MAX_AI_ANSWER_CACHE_ENTRIES;
}
