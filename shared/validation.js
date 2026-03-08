/**
 * Validation utilities for Job Application Autofill
 */

const Validation = {
    normalizeUserData(data) {
        const source = data || {};

        return {
            ...source,
            fullName: (source.fullName || '').trim(),
            email: (source.email || '').trim(),
            phone: (source.phone || '').trim(),
            linkedin: this.normalizeLinkedInUrl(source.linkedin || ''),
            city: (source.city || '').trim(),
            state: (source.state || '').trim(),
            workAuth: (source.workAuth || '').trim(),
            sponsorship: (source.sponsorship || '').trim(),
            startAvailability: (source.startAvailability || '').trim(),
            transgender: (source.transgender || '').trim(),
            sexualOrientation: (source.sexualOrientation || '').trim(),
            pronouns: (source.pronouns || '').trim(),
            gender: (source.gender || '').trim(),
            race: (source.race || '').trim(),
            veteran: (source.veteran || '').trim(),
            disability: (source.disability || '').trim(),
            hispanicLatino: (source.hispanicLatino || '').trim()
        };
    },

    /**
     * Validate email format
     * @param {string} email 
     * @returns {boolean}
     */
    isValidEmail(email) {
        if (!email) return false;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.trim());
    },

    /**
     * Validate LinkedIn profile URL
     * @param {string} url 
     * @returns {boolean}
     */
    isValidLinkedInUrl(url) {
        if (!url) return true; // Optional field
        const linkedinRegex = /^(https?:\/\/)?(www\.)?linkedin\.com\/(in|pub)\/[a-zA-Z0-9\-_]+\/?$/i;
        return linkedinRegex.test(url.trim());
    },

    /**
     * Validate phone number (basic US format)
     * @param {string} phone 
     * @returns {boolean}
     */
    isValidPhone(phone) {
        if (!phone) return true; // Optional field
        const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
        return phoneRegex.test(phone.replace(/\s/g, ''));
    },

    /**
     * Validate file type for resume
     * @param {File} file 
     * @returns {boolean}
     */
    isValidResumeType(file) {
        if (!file) return false;
        const validTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        const validExtensions = ['.pdf', '.doc', '.docx'];
        const fileName = file.name.toLowerCase();
        const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
        return validTypes.includes(file.type) || hasValidExtension;
    },

    /**
     * Validate file size (max 5MB)
     * @param {File} file 
     * @returns {boolean}
     */
    isValidFileSize(file) {
        if (!file) return false;
        const maxSize = 5 * 1024 * 1024; // 5MB
        return file.size <= maxSize;
    },

    /**
     * Validate required text field
     * @param {string} value 
     * @returns {boolean}
     */
    isNotEmpty(value) {
        return value && value.trim().length > 0;
    },

    /**
     * Validate all user data
     * @param {Object} data 
     * @returns {{valid: boolean, errors: string[]}}
     */
    validateUserData(data) {
        const normalizedData = this.normalizeUserData(data);
        const errors = [];

        // Required fields
        if (!this.isNotEmpty(normalizedData.fullName)) {
            errors.push('Full name is required');
        }

        if (!this.isNotEmpty(normalizedData.email)) {
            errors.push('Email is required');
        } else if (!this.isValidEmail(normalizedData.email)) {
            errors.push('Please enter a valid email address');
        }

        // Optional but validated fields
        if (normalizedData.linkedin && !this.isValidLinkedInUrl(normalizedData.linkedin)) {
            errors.push('Please enter a valid LinkedIn profile URL');
        }

        if (normalizedData.phone && !this.isValidPhone(normalizedData.phone)) {
            errors.push('Please enter a valid phone number');
        }

        return {
            valid: errors.length === 0,
            errors,
            normalizedData
        };
    },

    /**
     * Format phone number for display
     * @param {string} phone 
     * @returns {string}
     */
    formatPhone(phone) {
        if (!phone) return '';
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 10) {
            return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        }
        return phone;
    },

    /**
     * Normalize LinkedIn URL
     * @param {string} url 
     * @returns {string}
     */
    normalizeLinkedInUrl(url) {
        if (!url) return '';
        let normalized = url.trim();
        if (!normalized.startsWith('http')) {
            normalized = 'https://' + normalized;
        }
        if (!normalized.includes('www.')) {
            normalized = normalized.replace('linkedin.com', 'www.linkedin.com');
        }
        return normalized;
    }
};

// Export for use in content scripts (no module system in content scripts)
if (typeof window !== 'undefined') {
    window.Validation = Validation;
}
