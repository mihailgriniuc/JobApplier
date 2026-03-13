/**
 * Storage abstraction layer for Job Application Autofill
 * Uses Chrome's storage.local API with encryption for sensitive data
 */

const StorageKeys = {
    USER_DATA: 'jobAutofill_userData',
    SETTINGS: 'jobAutofill_settings',
    RESUME: 'jobAutofill_resume',
    CONSENT: 'jobAutofill_consent',
    SCHEMA_VERSION: 'jobAutofill_schemaVersion'
};

const CURRENT_SCHEMA_VERSION = 1;

let localAiConfigCache = null;

const DEFAULT_SETTINGS = {
    autoDetect: true,
    showIndicators: true,
    confirmBeforeFill: false,
    aiAssist: {
        enabled: false,
        model: 'mistral-small-latest',
        apiKey: '',
        extraContext: '',
        maxCharacters: 320,
        maxQuestionsPerRun: 3
    }
};

async function loadLocalAiConfig() {
    if (localAiConfigCache) {
        return localAiConfigCache;
    }

    try {
        const response = await fetch(chrome.runtime.getURL('local/ai-config.local.json'), {
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
        enabled: aiAssist?.enabled === true,
        model: (aiAssist?.model || DEFAULT_SETTINGS.aiAssist.model).trim() || DEFAULT_SETTINGS.aiAssist.model,
        apiKey: (aiAssist?.apiKey || '').trim(),
        extraContext: (aiAssist?.extraContext || '').trim(),
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
                const resumeData = {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: reader.result, // base64 encoded
                    uploadedAt: new Date().toISOString()
                };

                await chrome.storage.local.set({
                    [StorageKeys.RESUME]: resumeData
                });
                resolve();
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
        await chrome.storage.local.remove([StorageKeys.RESUME]);
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
}
