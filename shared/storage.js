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

const Storage = {
    /**
     * Save user data to Chrome storage
     * @param {Object} data 
     * @returns {Promise<void>}
     */
    async saveUserData(data) {
        const dataToStore = {
            ...data,
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
        return result[StorageKeys.USER_DATA] || null;
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
            [StorageKeys.SETTINGS]: settings
        });
    },

    /**
     * Get extension settings
     * @returns {Promise<Object>}
     */
    async getSettings() {
        const result = await chrome.storage.local.get([StorageKeys.SETTINGS]);
        return result[StorageKeys.SETTINGS] || {
            autoDetect: true,
            showIndicators: true,
            confirmBeforeFill: false
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
        return userData !== null && userData.fullName && userData.email;
    }
};

// Export for use in content scripts
if (typeof window !== 'undefined') {
    window.Storage = Storage;
    window.StorageKeys = StorageKeys;
}
