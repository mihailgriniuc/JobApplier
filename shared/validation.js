/**
 * Validation utilities for Job Application Autofill
 */

const Validation = {
    normalizeDelimitedValues(value) {
        if (Array.isArray(value)) {
            return value
                .flatMap(item => this.normalizeDelimitedValues(item))
                .filter(Boolean);
        }

        if (typeof value !== 'string') {
            return [];
        }

        return value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    },

    getSexualOrientationValues(value) {
        const values = [];
        const seen = new Set();

        this.normalizeDelimitedValues(value).forEach(item => {
            const normalizedItem = item
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();

            let mappedValues = [item.trim()];

            if ((normalizedItem.includes('bisexual') && normalizedItem.includes('pansexual')) || normalizedItem === 'bisexual and/or pansexual') {
                mappedValues = ['bisexual', 'pansexual'];
            } else if (normalizedItem.includes('heterosexual') || normalizedItem === 'straight' || normalizedItem === 'straight (heterosexual)') {
                mappedValues = ['straight'];
            } else if (
                normalizedItem === 'i don\'t wish to answer' ||
                normalizedItem === 'i don t wish to answer' ||
                normalizedItem === 'i do not wish to answer' ||
                normalizedItem.includes('prefer not')
            ) {
                mappedValues = ['no_answer'];
            } else if (normalizedItem === 'asexual' || normalizedItem === 'bisexual' || normalizedItem === 'pansexual' || normalizedItem === 'gay' || normalizedItem === 'lesbian' || normalizedItem === 'queer' || normalizedItem === 'no_answer') {
                mappedValues = [normalizedItem];
            }

            mappedValues.forEach(mappedValue => {
                if (!mappedValue || seen.has(mappedValue)) {
                    return;
                }

                seen.add(mappedValue);
                values.push(mappedValue);
            });
        });

        return values;
    },

    normalizeSexualOrientationValue(value) {
        return this.getSexualOrientationValues(value).join(', ');
    },

    normalizeUserData(data) {
        const source = data || {};

        return {
            ...source,
            fullName: (source.fullName || '').trim(),
            email: (source.email || '').trim(),
            phone: (source.phone || '').trim(),
            linkedin: this.normalizeLinkedInUrl(source.linkedin || ''),
            github: this.normalizeUrl(source.github || ''),
            website: this.normalizeUrl(source.website || source.portfolio || ''),
            city: (source.city || '').trim(),
            state: (source.state || '').trim(),
            workAuth: (source.workAuth || '').trim(),
            sponsorship: (source.sponsorship || '').trim(),
            startAvailability: (source.startAvailability || '').trim(),
            onsiteComfort: (source.onsiteComfort || '').trim(),
            relocationWillingness: (source.relocationWillingness || '').trim(),
            internshipStatus: (source.internshipStatus || '').trim(),
            over18: (source.over18 || '').trim(),
            formerEmployee: (source.formerEmployee || '').trim(),
            transgender: (source.transgender || '').trim(),
            sexualOrientation: this.normalizeSexualOrientationValue(source.sexualOrientation),
            pronouns: (source.pronouns || '').trim(),
            gender: (source.gender || '').trim(),
            race: (source.race || '').trim(),
            veteran: (source.veteran || '').trim(),
            disability: (source.disability || '').trim(),
            hispanicLatino: (source.hispanicLatino || '').trim()
        };
    },

    normalizeBinaryChoice(value) {
        const normalized = (value || '').trim().toLowerCase();

        if (!normalized) {
            return '';
        }

        if (['yes', 'true', 'y'].includes(normalized)) {
            return 'yes';
        }

        if (['no', 'false', 'n'].includes(normalized)) {
            return 'no';
        }

        return normalized;
    },

    validateAnswerCoherence(data) {
        const normalizedData = this.normalizeUserData(data);
        const errors = [];
        const warnings = [];
        const workAuth = this.normalizeBinaryChoice(normalizedData.workAuth);
        const sponsorship = this.normalizeBinaryChoice(normalizedData.sponsorship);

        if (workAuth === 'no' && sponsorship === 'no') {
            errors.push('Work authorization and sponsorship answers conflict: if you are not authorized to work, sponsorship cannot also be set to No');
        }

        if (workAuth === 'yes' && sponsorship === 'yes') {
            warnings.push('Work authorization is set to Yes while sponsorship is also Yes. This can be valid for temporary authorization, but verify it matches your situation');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            normalizedData
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

    isValidGitHubUrl(url) {
        if (!url) return true; // Optional field

        try {
            const parsed = new URL(this.normalizeUrl(url));
            const hostname = parsed.hostname.toLowerCase();
            return (hostname === 'github.com' || hostname === 'www.github.com') && parsed.pathname.trim() !== '/';
        } catch (error) {
            return false;
        }
    },

    isValidWebUrl(url) {
        if (!url) return true; // Optional field

        try {
            const parsed = new URL(this.normalizeUrl(url));
            return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname);
        } catch (error) {
            return false;
        }
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
        const warnings = [];

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

        if (normalizedData.github && !this.isValidGitHubUrl(normalizedData.github)) {
            errors.push('Please enter a valid GitHub URL');
        }

        if (normalizedData.website && !this.isValidWebUrl(normalizedData.website)) {
            errors.push('Please enter a valid personal website or portfolio URL');
        }

        if (normalizedData.phone && !this.isValidPhone(normalizedData.phone)) {
            errors.push('Please enter a valid phone number');
        }

        const coherence = this.validateAnswerCoherence(normalizedData);
        errors.push(...coherence.errors);
        warnings.push(...coherence.warnings);

        return {
            valid: errors.length === 0,
            errors,
            warnings,
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
        let normalized = this.normalizeUrl(url);
        if (!normalized.includes('www.')) {
            normalized = normalized.replace('linkedin.com', 'www.linkedin.com');
        }
        return normalized;
    },

    normalizeUrl(url) {
        if (!url) return '';

        const trimmed = url.trim();
        if (!trimmed) {
            return '';
        }

        return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    }
};

// Export for use in content scripts (no module system in content scripts)
if (typeof window !== 'undefined') {
    window.Validation = Validation;
}
