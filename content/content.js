/**
 * Content Script for Job Application Autofill
 * Handles form detection and autofill on job application pages
 */

(function () {
    'use strict';

    // Prevent multiple initializations
    if (window.jobAutofillInitialized) return;
    window.jobAutofillInitialized = true;

    const ContentScript = {
        userData: null,
        resumeData: null,
        filledFields: [],
        mutationObserver: null,
        unloadHandler: null,
        messageHandler: null,
        storageChangeHandler: null,
        initialized: false,
        settings: {
            autoDetect: true,
            showIndicators: true,
            confirmBeforeFill: false
        },
        allowedFormKeys: null,
        formKeyMap: new WeakMap(),
        formKeyCounter: 0,

        /**
         * Initialize the content script
         */
        async init() {
            if (this.initialized) {
                return;
            }

            this.initialized = true;

            this.messageHandler = (message, sender, sendResponse) => {
                if (message.action === 'ping') {
                    sendResponse({ pong: true, ready: true });
                    return true;
                }

                if (message.action === 'refreshRuntimeData') {
                    this.refreshRuntimeState().then(() => {
                        sendResponse({ success: true });
                    }).catch(error => {
                        sendResponse({
                            success: false,
                            error: error.message || 'Failed to refresh runtime state'
                        });
                    });
                    return true;
                }

                if (message.action === 'triggerAutofill') {
                    this.performAutofill().then(result => {
                        sendResponse(result);
                    }).catch(error => {
                        sendResponse({
                            success: false,
                            error: error.message || 'Autofill failed'
                        });
                    });
                    return true;
                }

                return false;
            };

            chrome.runtime.onMessage.addListener(this.messageHandler);

            this.storageChangeHandler = (changes, areaName) => {
                if (areaName !== 'local') {
                    return;
                }

                if (changes[StorageKeys.USER_DATA] || changes[StorageKeys.RESUME] || changes[StorageKeys.SETTINGS]) {
                    this.refreshRuntimeState().catch(error => {
                        console.error('[JobAutofill] Failed to refresh runtime state after storage update:', error);
                    });
                }
            };

            if (chrome?.storage?.onChanged) {
                chrome.storage.onChanged.addListener(this.storageChangeHandler);
            }

            this.unloadHandler = () => {
                this.cleanup();
            };

            window.addEventListener('pagehide', this.unloadHandler);

            await this.refreshRuntimeState();

            // Add floating button if on a job page
            if (this.settings.autoDetect !== false && this.isLikelyJobPage()) {
                this.addFloatingButton();
            }

            // Set up MutationObserver for dynamic content
            this.observeDynamicContent();
        },

        async refreshRuntimeState() {
            await this.loadUserData();
            await this.loadSettings();
        },

        cleanup() {
            if (this.mutationObserver) {
                this.mutationObserver.disconnect();
                this.mutationObserver = null;
            }

            if (this.unloadHandler) {
                window.removeEventListener('pagehide', this.unloadHandler);
                this.unloadHandler = null;
            }

            if (this.messageHandler && chrome?.runtime?.onMessage) {
                chrome.runtime.onMessage.removeListener(this.messageHandler);
                this.messageHandler = null;
            }

            if (this.storageChangeHandler && chrome?.storage?.onChanged) {
                chrome.storage.onChanged.removeListener(this.storageChangeHandler);
                this.storageChangeHandler = null;
            }

            this.initialized = false;
            window.jobAutofillInitialized = false;
        },

        /**
         * Load user data from storage
         */
        async loadUserData() {
            try {
                // Check if chrome.storage is available (extension context valid)
                if (!chrome?.storage?.local) {
                    console.warn('[JobAutofill] Chrome storage not available');
                    return;
                }
                const result = await chrome.storage.local.get([StorageKeys.USER_DATA, StorageKeys.RESUME]);
                this.userData = result[StorageKeys.USER_DATA] || null;
                this.resumeData = result[StorageKeys.RESUME] || null;
            } catch (error) {
                // Extension context may have been invalidated - this is normal after reload
                if (error.message?.includes('Extension context invalidated')) {
                    console.warn('[JobAutofill] Extension was reloaded, please refresh the page');
                } else {
                    console.error('[JobAutofill] Failed to load user data:', error);
                }
            }
        },

        async loadSettings() {
            try {
                if (typeof Storage?.getSettings === 'function') {
                    this.settings = await Storage.getSettings();
                    return;
                }
                if (!chrome?.storage?.local) {
                    return;
                }
                const result = await chrome.storage.local.get([StorageKeys.SETTINGS]);
                this.settings = result[StorageKeys.SETTINGS] || this.settings;
            } catch (error) {
                this.settings = this.settings || {
                    autoDetect: true,
                    showIndicators: true,
                    confirmBeforeFill: false
                };
            }
        },

        getFormKey(form) {
            if (!form) return 'document';
            if (!this.formKeyMap.has(form)) {
                this.formKeyCounter += 1;
                this.formKeyMap.set(form, `form-${this.formKeyCounter}`);
            }
            return this.formKeyMap.get(form);
        },

        getFormLabel(form, index) {
            const label =
                form.getAttribute('aria-label') ||
                form.getAttribute('name') ||
                form.getAttribute('id');
            return label ? `form "${label}"` : `form ${index}`;
        },

        async getAllowedFormKeys(detectedFields) {
            if (!this.settings.confirmBeforeFill) {
                return null;
            }

            const fields = Object.values(detectedFields || {}).flat();
            const formSet = new Set();
            let hasDocumentFields = false;

            for (const field of fields) {
                const form = field?.closest?.('form');
                if (form) {
                    formSet.add(form);
                } else {
                    hasDocumentFields = true;
                }
            }

            let formsInOrder = Array.from(document.querySelectorAll('form')).filter(form => formSet.has(form));
            const allowed = new Set();

            if (fields.length === 0) {
                formsInOrder = Array.from(document.querySelectorAll('form'));
                hasDocumentFields = formsInOrder.length === 0;
            }

            if (formsInOrder.length === 0 && hasDocumentFields) {
                const approved = window.confirm('Fill fields on this page?');
                if (approved) {
                    allowed.add('document');
                }
                return allowed;
            }

            let index = 1;
            for (const form of formsInOrder) {
                const approved = window.confirm(`Fill ${this.getFormLabel(form, index)}?`);
                if (approved) {
                    allowed.add(this.getFormKey(form));
                }
                index += 1;
            }

            if (hasDocumentFields) {
                const approved = window.confirm('Fill fields outside forms?');
                if (approved) {
                    allowed.add('document');
                }
            }

            return allowed;
        },

        isElementAllowed(element) {
            if (!this.settings?.confirmBeforeFill) return true;
            if (!this.allowedFormKeys) return true;
            const form = element?.closest?.('form');
            if (!form) {
                return this.allowedFormKeys.has('document');
            }
            return this.allowedFormKeys.has(this.getFormKey(form));
        },

        /**
         * Check if current page is likely a job application
         */
        isLikelyJobPage() {
            const url = window.location.href.toLowerCase();
            const pageText = document.body?.textContent?.toLowerCase() || '';

            const urlIndicators = ['apply', 'career', 'job', 'application', 'hire', 'talent', 'recruit'];
            const textIndicators = ['apply now', 'submit application', 'upload resume', 'work authorization',
                'equal opportunity', 'job application'];

            const hasUrlIndicator = urlIndicators.some(ind => url.includes(ind));
            const hasTextIndicator = textIndicators.some(ind => pageText.includes(ind));

            return hasUrlIndicator || hasTextIndicator;
        },

        /**
         * Add floating autofill button to the page
         */
        addFloatingButton() {
            // Don't add if already exists
            if (document.getElementById('job-autofill-btn')) return;

            const button = document.createElement('button');
            button.id = 'job-autofill-btn';
            button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M20 6H16V4C16 2.89 15.11 2 14 2H10C8.89 2 8 2.89 8 4V6H4C2.89 6 2 6.89 2 8V19C2 20.11 2.89 21 4 21H20C21.11 21 22 20.11 22 19V8C22 6.89 21.11 6 20 6ZM10 4H14V6H10V4ZM20 19H4V8H20V19Z" fill="currentColor"/>
          <path d="M13 10H11V13H8V15H11V18H13V15H16V13H13V10Z" fill="currentColor"/>
        </svg>
        <span>Autofill</span>
      `;
            button.title = 'Fill job application form';

            button.addEventListener('click', async () => {
                button.disabled = true;
                button.classList.remove('job-autofill-btn--success', 'job-autofill-btn--error');
                button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" class="spin">
            <path d="M12 4V1L8 5L12 9V6C15.31 6 18 8.69 18 12C18 13.01 17.75 13.97 17.3 14.8L18.76 16.26C19.54 15.03 20 13.57 20 12C20 7.58 16.42 4 12 4Z" fill="currentColor"/>
            <path d="M12 18C8.69 18 6 15.31 6 12C6 10.99 6.25 10.03 6.7 9.2L5.24 7.74C4.46 8.97 4 10.43 4 12C4 16.42 7.58 20 12 20V23L16 19L12 15V18Z" fill="currentColor"/>
          </svg>
          <span>Filling...</span>
        `;

                const result = await this.performAutofill();

                if (result.success) {
                    button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z" fill="currentColor"/>
            </svg>
            <span>Done!</span>
          `;
                    button.classList.add('job-autofill-btn--success');
                } else {
                    button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
            </svg>
            <span>Error</span>
          `;
                    button.classList.add('job-autofill-btn--error');
                }

                setTimeout(() => {
                    button.disabled = false;
                    button.classList.remove('job-autofill-btn--success', 'job-autofill-btn--error');
                    button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M20 6H16V4C16 2.89 15.11 2 14 2H10C8.89 2 8 2.89 8 4V6H4C2.89 6 2 6.89 2 8V19C2 20.11 2.89 21 4 21H20C21.11 21 22 20.11 22 19V8C22 6.89 21.11 6 20 6ZM10 4H14V6H10V4ZM20 19H4V8H20V19Z" fill="currentColor"/>
              <path d="M13 10H11V13H8V15H11V18H13V15H16V13H13V10Z" fill="currentColor"/>
            </svg>
            <span>Autofill</span>
          `;
                }, 3000);
            });

            document.body.appendChild(button);
        },

        /**
         * Main autofill function
         */
        async performAutofill() {
            this.filledFields = [];
            this.allowedFormKeys = null;

            // Reload user data in case it was updated
            await this.loadUserData();

            await this.loadSettings();

            if (!this.userData) {
                return {
                    success: false,
                    error: 'No saved data found. Please set up your profile first.'
                };
            }

            if (typeof Validation !== 'undefined') {
                const validation = Validation.validateUserData(this.userData);
                if (!validation.valid) {
                    return {
                        success: false,
                        error: validation.errors.join(', ')
                    };
                }

                this.userData = validation.normalizedData;
            }

            try {
                // Check if there's a site autofill feature (like "Autofill from Resume")
                // and wait for it to complete if it's being used
                await this.waitForSiteAutofill();

                // Detect fields (after site autofill has potentially filled some)
                const detectedFields = FieldDetector.detectFields();

                this.allowedFormKeys = await this.getAllowedFormKeys(detectedFields);
                if (this.settings.confirmBeforeFill && this.allowedFormKeys && this.allowedFormKeys.size === 0) {
                    return {
                        success: false,
                        error: 'Autofill canceled by user.'
                    };
                }

                // Fill text fields (only empty ones)
                this.fillTextFields(detectedFields);

                // Fill yes/no radio buttons (traditional)
                this.fillYesNoFields();

                // Fill button-style Yes/No selectors (like Ashby)
                this.fillButtonStyleYesNo();

                // Fill demographic radio buttons (gender, race, veteran, etc.)
                this.fillDemographicRadios();

                // Fill select dropdowns
                this.fillSelectFields(detectedFields);

                // Fill Hispanic/Latino dropdowns specifically  
                this.fillHispanicLatinoSelects();

                this.fillRaceSelects();

                // Fill country/location dropdowns (United States, etc.)
                this.fillCountryLocationSelects();

                // Handle location autocomplete fields
                await this.handleLocationAutocomplete();

                // Some sites re-render fields after location or select interactions.
                const refreshedFields = FieldDetector.detectFields();
                this.fillTextFields(refreshedFields);
                this.fillSelectFields(refreshedFields);

                // Handle file upload (only if not already uploaded)
                await this.handleFileUpload();

                return {
                    success: true,
                    filledCount: this.filledFields.length,
                    message: `Successfully filled ${this.filledFields.length} fields`
                };
            } catch (error) {
                console.error('Autofill error:', error);
                return {
                    success: false,
                    error: error.message || 'An error occurred during autofill'
                };
            }
        },

        /**
         * Find and trigger site's "Autofill from Resume" feature, then wait for it to complete
         */
        async waitForSiteAutofill() {
            if (!this.resumeData) {
                console.log('[JobAutofill] No resume data, skipping autofill from resume');
                return;
            }

            // Find "Autofill from Resume" upload input
            const autofillInput = this.findAutofillResumeInput();

            if (!autofillInput) {
                console.log('[JobAutofill] No autofill from resume feature found');
                return;
            }

            console.log('[JobAutofill] Found autofill from resume input, uploading...');

            try {
                // Convert base64 to file
                const file = this.base64ToFile(
                    this.resumeData.data,
                    this.resumeData.name,
                    this.resumeData.type
                );

                // Upload to the autofill input
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                autofillInput.files = dataTransfer.files;

                // Dispatch events to trigger the upload
                autofillInput.dispatchEvent(new Event('input', { bubbles: true }));
                autofillInput.dispatchEvent(new Event('change', { bubbles: true }));

                console.log('[JobAutofill] Resume uploaded to autofill, waiting for parsing...');

                // Wait for parsing to complete
                await this.waitForParsingComplete();

                console.log('[JobAutofill] Site autofill complete, filling remaining fields...');

            } catch (error) {
                console.error('[JobAutofill] Error with autofill from resume:', error);
            }
        },

        /**
         * Find the "Autofill from Resume" file input (not the regular resume attachment)
         */
        findAutofillResumeInput() {
            const fileInputs = document.querySelectorAll('input[type="file"]');

            const autofillKeywords = [
                'autofill', 'parse', 'fill from', 'import', 'scan',
                'extract', 'auto-fill', 'prefill', 'pre-fill'
            ];

            for (const input of fileInputs) {
                // Check the input's container for autofill-related text
                const container = input.closest('div, section, fieldset, label, [class*="upload"]');
                if (!container) continue;

                const containerText = container.textContent?.toLowerCase() || '';
                const inputId = (input.id || '').toLowerCase();
                const inputName = (input.name || '').toLowerCase();
                const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();

                // Check if this is an "autofill from resume" input
                const isAutofillInput = autofillKeywords.some(keyword =>
                    containerText.includes(keyword) ||
                    inputId.includes(keyword) ||
                    inputName.includes(keyword) ||
                    ariaLabel.includes(keyword)
                );

                // Also check for specific patterns
                const hasAutofillPattern =
                    containerText.includes('autofill with resume') ||
                    containerText.includes('autofill from resume') ||
                    containerText.includes('fill from resume') ||
                    containerText.includes('parse resume') ||
                    containerText.includes('upload resume to autofill') ||
                    containerText.includes('import resume');

                if (isAutofillInput || hasAutofillPattern) {
                    // Make sure it doesn't already have a file
                    if (!input.files || input.files.length === 0) {
                        return input;
                    }
                }
            }

            // Also check for buttons that might trigger file selection
            const autofillButtons = document.querySelectorAll(
                'button, [role="button"], [class*="upload"], [class*="autofill"]'
            );

            for (const button of autofillButtons) {
                const buttonText = button.textContent?.toLowerCase() || '';
                const isAutofillButton =
                    buttonText.includes('autofill') ||
                    buttonText.includes('parse resume') ||
                    buttonText.includes('fill from resume') ||
                    buttonText.includes('import resume');

                if (isAutofillButton) {
                    // Look for associated file input
                    const nearbyInput = button.closest('div, section, form')?.querySelector('input[type="file"]');
                    if (nearbyInput && (!nearbyInput.files || nearbyInput.files.length === 0)) {
                        // Click the button first to potentially reveal the input
                        button.click();
                        return nearbyInput;
                    }
                }
            }

            return null;
        },

        /**
         * Wait for resume parsing/autofill to complete
         */
        async waitForParsingComplete() {
            const maxWait = 15000; // 15 seconds max
            const checkInterval = 300;
            let waited = 0;
            let previousFilledCount = 0;
            let stableCount = 0;

            // Helper to count filled fields
            const countFilledFields = () => {
                let count = 0;
                const inputs = document.querySelectorAll('input, textarea, select');
                for (const input of inputs) {
                    if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') continue;
                    if (input.type === 'checkbox' || input.type === 'radio') {
                        if (input.checked) count++;
                    } else if (input.value && input.value.trim()) {
                        count++;
                    }
                }
                return count;
            };

            // Helper to check for loading indicators
            const isLoading = () => {
                const loadingIndicators = document.querySelectorAll(
                    '[class*="loading"], [class*="spinner"], [class*="progress"], ' +
                    '[class*="parsing"], [class*="processing"], [aria-busy="true"], ' +
                    '[class*="uploading"], .loader, .spinner, [class*="extracting"]'
                );

                for (const indicator of loadingIndicators) {
                    const style = window.getComputedStyle(indicator);
                    if (style.display !== 'none' && style.visibility !== 'hidden' &&
                        style.opacity !== '0' && indicator.offsetParent !== null) {
                        return true;
                    }
                }
                return false;
            };

            // Wait for initial processing to start
            await new Promise(resolve => setTimeout(resolve, 500));

            // Wait for loading to complete and fields to stabilize
            while (waited < maxWait) {
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                waited += checkInterval;

                const currentFilledCount = countFilledFields();
                const stillLoading = isLoading();

                console.log(`[JobAutofill] Parsing... loading=${stillLoading}, filled=${currentFilledCount}, waited=${waited}ms`);

                // If not loading and field count is stable, we're done
                if (!stillLoading) {
                    if (currentFilledCount === previousFilledCount) {
                        stableCount++;
                        if (stableCount >= 3) {
                            // Fields have been stable for ~900ms with no loading
                            console.log('[JobAutofill] Parsing complete (fields stable)');
                            return;
                        }
                    } else {
                        stableCount = 0;
                    }
                }

                previousFilledCount = currentFilledCount;
            }

            console.log('[JobAutofill] Parsing timeout reached, proceeding anyway');
        },


        /**
         * Fill text input fields
         */
        fillTextFields(detectedFields) {
            const fieldMappings = {
                fullName: this.userData.fullName,
                firstName: this.parseFirstName(this.userData.fullName),
                lastName: this.parseLastName(this.userData.fullName),
                email: this.userData.email,
                phone: this.userData.phone,
                linkedin: this.userData.linkedin,
                city: this.userData.city,
                state: this.userData.state,
                location: this.formatLocation(),
                pronouns: this.userData.pronouns,
                sexualOrientation: this.userData.sexualOrientation
            };

            for (const [fieldType, value] of Object.entries(fieldMappings)) {
                if (!value || !detectedFields[fieldType]) continue;

                for (const input of detectedFields[fieldType]) {
                    // Special handling for city fields - check if they actually want city + state
                    let valueToFill = value;
                    if (fieldType === 'city') {
                        valueToFill = this.getCityFieldValue(input);
                    }

                    if (this.fillInput(input, valueToFill)) {
                        this.filledFields.push({ type: fieldType, element: input });
                        this.highlightField(input, true);
                    }
                }
            }

            // Also scan for any text inputs that might be asking for city+state combined
            this.fillCombinedLocationFields();
        },

        /**
         * Determine if a city field should include state based on context
         */
        getCityFieldValue(input) {
            const labelText = FieldDetector.getLabelText(input).toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const parentText = (input.closest('div, fieldset')?.textContent || '').toLowerCase().slice(0, 300);

            // Check if the field wants both city and state
            const wantsCombined =
                labelText.includes('city and state') ||
                labelText.includes('city, state') ||
                labelText.includes('city/state') ||
                labelText.includes('state/province') ||
                placeholder.includes('city, state') ||
                placeholder.includes('city and state') ||
                parentText.includes('city and state') ||
                parentText.includes('list city and state') ||
                parentText.includes('city, state') ||
                parentText.includes('(san francisco, california') ||
                parentText.includes('toronto, ontario');

            if (wantsCombined) {
                return this.formatLocation();
            }
            return this.userData.city;
        },

        /**
         * Find and fill text inputs that ask for combined city+state
         */
        fillCombinedLocationFields() {
            const allInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');

            for (const input of allInputs) {
                // Skip if already filled
                if (input.value && input.value.trim()) continue;

                const labelText = FieldDetector.getLabelText(input).toLowerCase();
                const placeholder = (input.placeholder || '').toLowerCase();
                const parentContainer = input.closest('div, fieldset, section');
                const parentText = parentContainer ? parentContainer.textContent.toLowerCase().slice(0, 400) : '';

                // Check for patterns that indicate city+state combined field
                const combinedPatterns = [
                    'please list city and state',
                    'city and state/province',
                    'city, state/province',
                    '(san francisco, california',
                    '(toronto, ontario'
                ];

                const isCombinedField = combinedPatterns.some(p =>
                    labelText.includes(p) || placeholder.includes(p) || parentText.includes(p)
                );

                if (isCombinedField) {
                    const fullLocation = this.formatLocation();
                    if (this.fillInput(input, fullLocation)) {
                        this.filledFields.push({ type: 'location', element: input });
                        this.highlightField(input, true);
                    }
                }
            }
        },


        /**
         * Fill an input with a value, dispatching proper events
         */
        fillInput(input, value) {
            if (!input || !value) return false;

            if (!this.isElementAllowed(input)) return false;

            if (input.disabled || input.readOnly) return false;

            // Skip if already has value (don't overwrite user input)
            if (input.value && input.value.trim()) return false;

            try {
                // Focus the input
                input.focus();

                for (let attempt = 0; attempt < 2; attempt += 1) {
                    this.setElementValue(input, value);
                    this.dispatchValueEvents(input);

                    if (this.normalizeText(input.value) === this.normalizeText(value)) {
                        return true;
                    }
                }

                return false;
            } catch (error) {
                console.error('Failed to fill input:', error);
                return false;
            }
        },

        setElementValue(element, value) {
            const prototype =
                element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype :
                    element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype :
                        window.HTMLInputElement.prototype;

            const nativeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

            if (nativeValueSetter) {
                nativeValueSetter.call(element, value);
                return;
            }

            element.value = value;
        },

        dispatchValueEvents(element) {
            element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            element.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                data: typeof element.value === 'string' ? element.value : null,
                inputType: 'insertText'
            }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));
        },

        /**
         * Fill yes/no radio button fields
         */
        fillYesNoFields() {
            const binaryFields = [
                'workAuth',
                'sponsorship',
                'onsiteComfort',
                'relocationWillingness',
                'internshipStatus',
                'over18',
                'formerEmployee'
            ];

            for (const fieldType of binaryFields) {
                const desiredValue = this.userData[fieldType];
                if (!desiredValue) {
                    continue;
                }

                const radios = FieldDetector.findYesNoRadios(fieldType);
                if (!radios) {
                    continue;
                }

                const targetRadio = desiredValue === 'yes' ? radios.yesRadio : radios.noRadio;
                if (targetRadio && !targetRadio.checked) {
                    if (this.selectRadio(targetRadio)) {
                        this.filledFields.push({ type: fieldType, element: targetRadio });
                    }
                }
            }
        },

        /**
         * Select a radio button
         */
        selectRadio(radio) {
            if (!this.isElementAllowed(radio)) return false;
            if (radio.disabled) return false;

            radio.checked = true;
            radio.dispatchEvent(new Event('click', { bubbles: true }));
            radio.dispatchEvent(new Event('change', { bubbles: true }));

            if (!radio.checked) {
                this.clickElement(radio);
            }

            if (!radio.checked) {
                return false;
            }

            this.highlightField(radio, true);
            return true;
        },

        /**
         * Fill button-style Yes/No selectors (like Ashby uses)
         */
        fillButtonStyleYesNo() {
            console.log('[JobAutofill] Looking for button-style Yes/No selectors...');

            // Find ALL clickable elements that contain exactly "Yes" or "No"
            const clickableSelector =
                'button, [role="button"], div[tabindex], span[tabindex], ' +
                '[class*="option"], [class*="choice"], [class*="toggle"], ' +
                '[class*="btn"], [class*="button"], [class*="select"], ' +
                'label, [onclick], [class*="clickable"], [class*="answer"], ' +
                '[data-value], [data-option]';
            const allClickables = document.querySelectorAll(clickableSelector);

            const processedQuestions = new Set();

            for (const element of allClickables) {
                const elementText = element.textContent?.trim() || '';

                // Must be exactly "Yes" or "No" (case insensitive)
                if (elementText.toLowerCase() !== 'yes' && elementText.toLowerCase() !== 'no') {
                    continue;
                }

                // Find the question container (go up several levels)
                let container = element.parentElement;
                for (let i = 0; i < 5 && container; i++) {
                    const containerText = container.textContent?.toLowerCase() || '';

                    // Check if this container has both Yes and No and a question
                    const hasYes = containerText.includes('yes');
                    const hasNo = containerText.includes('no');
                    const hasQuestion = containerText.includes('?') ||
                        containerText.includes('authorized') ||
                        containerText.includes('sponsorship') ||
                        containerText.includes('require');

                    if (hasYes && hasNo && hasQuestion) {
                        break;
                    }
                    container = container.parentElement;
                }

                if (!container) continue;

                // Skip if already processed this question
                const questionKey = container.textContent?.substring(0, 100) || '';
                if (processedQuestions.has(questionKey)) continue;

                const containerText = container.textContent?.toLowerCase() || '';
                const normalizedContainerText = this.normalizeText(containerText);

                const fieldType = FieldDetector.classifyBinaryQuestionType(normalizedContainerText);
                const desiredValue = fieldType ? this.userData[fieldType] : null;

                if (!fieldType || !desiredValue) continue;

                processedQuestions.add(questionKey);
                console.log(`[JobAutofill] Found ${fieldType} question, looking for ${desiredValue} button`);

                const yesNoButtons = Array.from(container.querySelectorAll(clickableSelector))
                    .filter(btn => {
                        const text = btn.textContent?.trim().toLowerCase();
                        return text === 'yes' || text === 'no';
                    });

                const targetButton = yesNoButtons.find(btn =>
                    (desiredValue === 'yes' && btn.textContent?.trim().toLowerCase() === 'yes') ||
                    (desiredValue === 'no' && btn.textContent?.trim().toLowerCase() === 'no')
                );

                if (!targetButton) continue;

                const computedStyle = window.getComputedStyle(targetButton);
                const isSelected = targetButton.classList.contains('selected') ||
                    targetButton.classList.contains('active') ||
                    targetButton.classList.contains('checked') ||
                    targetButton.getAttribute('aria-pressed') === 'true' ||
                    targetButton.getAttribute('aria-checked') === 'true' ||
                    targetButton.getAttribute('data-selected') === 'true' ||
                    targetButton.getAttribute('data-state') === 'checked' ||
                    computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                    computedStyle.backgroundColor !== 'transparent' &&
                    computedStyle.backgroundColor !== 'rgb(255, 255, 255)';

                if (isSelected) {
                    console.log(`[JobAutofill] ${fieldType} ${desiredValue} already selected`);
                    continue;
                }

                if (!this.isElementAllowed(targetButton)) {
                    continue;
                }

                this.clickElement(targetButton);
                this.filledFields.push({ type: fieldType, element: targetButton });
                this.highlightField(targetButton, true);
                console.log(`[JobAutofill] Clicked ${fieldType} button: ${targetButton.textContent?.trim() || ''}`);
            }
        },

        /**
         * Click an element using multiple approaches for maximum compatibility
         */
        clickElement(element) {
            // Focus first
            element.focus();

            // Native click
            element.click();

            // Mouse events
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

            // Pointer events (for modern frameworks)
            element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));

            // Touch events (for mobile-style components)
            try {
                element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
                element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
            } catch (e) {
                // TouchEvent not supported in some browsers
            }

            // Keyboard enter (some components respond to this)
            element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
            element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
        },

        normalizeText(text) {
            return (text || '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .replace(/\bu\s+s\b/g, 'us')
                .replace(/\bu\s+s\s+a\b/g, 'usa')
                .trim();
        },


        /**
         * Fill demographic radio buttons (gender, race, veteran status)
         */
        fillDemographicRadios() {
            const radioMappings = {
                gender: {
                    value: this.userData.gender,
                    patterns: {
                        male: ['male', 'm'],
                        female: ['female', 'f', 'woman'],
                        decline: ['decline', 'prefer not', 'not to identify', 'not to self']
                    }
                },
                transgender: {
                    value: this.userData.transgender,
                    patterns: {
                        yes: ['yes', 'transgender', 'trans'],
                        no: ['no', 'not transgender']
                    }
                },
                sexualOrientation: {
                    value: this.userData.sexualOrientation,
                    patterns: FieldDetector.patterns.sexualOrientation?.options || {}
                },
                pronouns: {
                    value: this.userData.pronouns,
                    patterns: FieldDetector.patterns.pronouns?.options || {}
                },
                hispanicLatino: {
                    value: this.userData.hispanicLatino || 'no',
                    patterns: {
                        yes: ['yes', 'hispanic', 'latino', 'latina'],
                        no: ['no', 'not hispanic', 'not latino'],
                        decline: ['decline', 'prefer not', 'not to identify']
                    }
                },
                race: {
                    value: this.userData.race,
                    patterns: FieldDetector.patterns.race?.options || {}
                },
                veteran: {
                    value: this.userData.veteran,
                    patterns: FieldDetector.patterns.veteran?.options || {}
                },
                disability: {
                    value: this.userData.disability,
                    patterns: FieldDetector.patterns.disability?.options || {}
                },
                startAvailability: {
                    value: this.userData.startAvailability,
                    patterns: FieldDetector.patterns.startAvailability?.options || {}
                },
                onsiteComfort: {
                    value: this.userData.onsiteComfort,
                    patterns: FieldDetector.patterns.onsiteComfort?.options || {}
                },
                relocationWillingness: {
                    value: this.userData.relocationWillingness,
                    patterns: FieldDetector.patterns.relocationWillingness?.options || {}
                },
                internshipStatus: {
                    value: this.userData.internshipStatus,
                    patterns: FieldDetector.patterns.internshipStatus?.options || {}
                },
                over18: {
                    value: this.userData.over18,
                    patterns: FieldDetector.patterns.over18?.options || {}
                },
                formerEmployee: {
                    value: this.userData.formerEmployee,
                    patterns: FieldDetector.patterns.formerEmployee?.options || {}
                }
            };

            for (const [fieldType, config] of Object.entries(radioMappings)) {
                if (!config.value) continue;

                // Find all radio buttons
                const allRadios = document.querySelectorAll('input[type="radio"]');

                for (const radio of allRadios) {
                    // Get the question/label text
                    const questionText = FieldDetector.getQuestionText(radio).toLowerCase();
                    const labelText = FieldDetector.getLabelText(radio).toLowerCase();
                    const radioValue = (radio.value || '').toLowerCase();

                    // Check if this radio is for the current field type
                    const isMatchingField =
                        (fieldType === 'gender' && (questionText.includes('gender') || questionText.includes('sex'))) ||
                        (fieldType === 'transgender' && questionText.includes('transgender')) ||
                        (fieldType === 'sexualOrientation' && (questionText.includes('sexual orientation') || questionText.includes('sexuality') || questionText.includes('orientation'))) ||
                        (fieldType === 'pronouns' && questionText.includes('pronoun')) ||
                        (fieldType === 'hispanicLatino' && (questionText.includes('hispanic') || questionText.includes('latino'))) ||
                        (fieldType === 'race' && (questionText.includes('race') || (questionText.includes('ethnic') && !questionText.includes('hispanic')))) ||
                        (fieldType === 'veteran' && (questionText.includes('veteran') || questionText.includes('military'))) ||
                        (fieldType === 'disability' && questionText.includes('disab')) ||
                        (fieldType === 'onsiteComfort' && FieldDetector.classifyBinaryQuestionType(questionText) === 'onsiteComfort') ||
                        (fieldType === 'relocationWillingness' && FieldDetector.classifyBinaryQuestionType(questionText) === 'relocationWillingness') ||
                        (fieldType === 'internshipStatus' && FieldDetector.classifyBinaryQuestionType(questionText) === 'internshipStatus') ||
                        (fieldType === 'over18' && FieldDetector.classifyBinaryQuestionType(questionText) === 'over18') ||
                        (fieldType === 'formerEmployee' && FieldDetector.classifyBinaryQuestionType(questionText) === 'formerEmployee') ||
                        (fieldType === 'startAvailability' && (
                            questionText.includes('when can you start') ||
                            questionText.includes('when would you be able to start') ||
                            questionText.includes('available to start') ||
                            questionText.includes('start date') ||
                            questionText.includes('notice period') ||
                            questionText.includes('earliest start') ||
                            questionText.includes('availability')
                        ));

                    if (!isMatchingField) continue;

                    // Check if this radio matches the user's selection
                    const patterns = config.patterns[config.value] || [];
                    const matchesValue = patterns.some(p =>
                        labelText.includes(p) || radioValue.includes(p)
                    ) || labelText.includes(config.value) || radioValue === config.value;

                    if (matchesValue && !radio.checked) {
                        if (this.selectRadio(radio)) {
                            this.filledFields.push({ type: fieldType, element: radio });
                            console.log(`[JobAutofill] Selected ${fieldType} radio: ${labelText}`);
                        }
                        break;
                    }
                }
            }
        },

        /**
         * Handle location autocomplete fields
         */
        async handleLocationAutocomplete() {
            const location = this.formatLocation();
            if (!location) return;

            // Find location input fields (often have autocomplete behaviors)
            const locationInputs = document.querySelectorAll(
                'input[name*="location"], input[id*="location"], ' +
                'input[placeholder*="location"], input[placeholder*="city"], ' +
                'input[aria-label*="location"], input[aria-label*="city"], ' +
                'input[placeholder*="Start typing"]'
            );

            for (const input of locationInputs) {
                // Skip if already filled
                if (input.value && input.value.trim()) continue;

                if (!this.isElementAllowed(input)) continue;

                console.log('[JobAutofill] Found location autocomplete input');

                // Focus and type the location
                input.focus();
                input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

                // Clear any existing value
                input.value = '';

                // Use React-compatible value setting
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                )?.set;

                // Type the location
                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(input, location);
                } else {
                    input.value = location;
                }

                // Dispatch events
                this.dispatchValueEvents(input);
                input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
                input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

                // Look for autocomplete suggestions - very broad selector
                const findSuggestions = () => {
                    const candidates = document.querySelectorAll(
                        '[role="listbox"] *, [role="option"], ' +
                        '[class*="autocomplete"] *, [class*="suggestion"], ' +
                        '[class*="dropdown"]:not(select) *, [class*="menu"] li, ' +
                        '[class*="list"] [class*="item"], [class*="result"], ' +
                        '[class*="option"]:not(option), [class*="combobox"] *, ' +
                        '[data-option], [data-value], [class*="typeahead"] *, ' +
                        'ul:not([role="menubar"]) li, [class*="popover"] li, ' +
                        '[class*="popup"] li, [class*="overlay"] li'
                    );

                    return Array.from(candidates).filter(el => {
                        const style = window.getComputedStyle(el);
                        const isVisible = style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0' &&
                            el.offsetParent !== null;
                        const hasText = el.textContent?.trim().length > 0;
                        const looksLikeLocation = el.textContent?.includes(',') ||
                            el.textContent?.toLowerCase().includes('city') ||
                            el.textContent?.toLowerCase().includes('state') ||
                            el.textContent?.toLowerCase().includes('united');
                        return isVisible && hasText && looksLikeLocation;
                    });
                };

                const suggestions = await this.waitForVisibleElements(findSuggestions, {
                    timeoutMs: 3000,
                    intervalMs: 250
                });

                console.log(`[JobAutofill] Found ${suggestions.length} location suggestions`);

                if (suggestions.length > 0) {
                    const bestMatch = this.findBestLocationMatch(suggestions);

                    if (bestMatch) {
                        this.clickElement(bestMatch);
                        this.filledFields.push({ type: 'location', element: input });
                        this.highlightField(input, true);
                        console.log(`[JobAutofill] Selected location: ${bestMatch.textContent?.trim()}`);
                    }
                } else {
                    // No suggestions, just dispatch final events
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('blur', { bubbles: true }));
                    this.filledFields.push({ type: 'location', element: input });
                    this.highlightField(input, true);
                }

                // Only process first matching location input
                break;
            }
        },

        /**
         * Find the best matching location suggestion
         */
        findBestLocationMatch(suggestions) {
            const userCity = (this.userData.city || '').toLowerCase().trim();
            const userState = (this.userData.state || '').toLowerCase().trim();

            let bestMatch = null;
            let bestScore = -1;

            for (const suggestion of suggestions) {
                const text = (suggestion.textContent || '').toLowerCase().trim();
                let score = 0;

                // Check for city match
                if (text.includes(userCity)) {
                    score += 10;

                    // Bonus if city is at the start
                    if (text.startsWith(userCity)) {
                        score += 5;
                    }
                }

                // Check for state match
                if (userState && text.includes(userState)) {
                    score += 8;
                }

                // Check for common state abbreviations
                const stateAbbreviations = {
                    'new york': 'ny', 'california': 'ca', 'texas': 'tx', 'florida': 'fl',
                    'illinois': 'il', 'pennsylvania': 'pa', 'ohio': 'oh', 'georgia': 'ga',
                    'north carolina': 'nc', 'michigan': 'mi', 'new jersey': 'nj', 'virginia': 'va',
                    'washington': 'wa', 'arizona': 'az', 'massachusetts': 'ma', 'tennessee': 'tn',
                    'indiana': 'in', 'missouri': 'mo', 'maryland': 'md', 'wisconsin': 'wi',
                    'colorado': 'co', 'minnesota': 'mn', 'south carolina': 'sc', 'alabama': 'al',
                    'louisiana': 'la', 'kentucky': 'ky', 'oregon': 'or', 'oklahoma': 'ok',
                    'connecticut': 'ct', 'utah': 'ut', 'iowa': 'ia', 'nevada': 'nv',
                    'arkansas': 'ar', 'mississippi': 'ms', 'kansas': 'ks', 'new mexico': 'nm',
                    'nebraska': 'ne', 'west virginia': 'wv', 'idaho': 'id', 'hawaii': 'hi',
                    'new hampshire': 'nh', 'maine': 'me', 'montana': 'mt', 'rhode island': 'ri',
                    'delaware': 'de', 'south dakota': 'sd', 'north dakota': 'nd', 'alaska': 'ak',
                    'vermont': 'vt', 'wyoming': 'wy', 'district of columbia': 'dc'
                };

                const stateAbbr = stateAbbreviations[userState];
                if (stateAbbr && text.includes(stateAbbr)) {
                    score += 5;
                }

                // Check if text contains "United States" or "USA"
                if (text.includes('united states') || text.includes('usa') || text.includes(', us')) {
                    score += 2;
                }

                // Penalize very long suggestions
                if (score > 0 && text.length > 100) {
                    score -= 2;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = suggestion;
                }
            }

            // If no good match found, return first suggestion as fallback
            if (!bestMatch && suggestions.length > 0) {
                console.log('[JobAutofill] No exact match, using first suggestion');
                bestMatch = suggestions[0];
            }

            return bestMatch;
        },

        async waitForVisibleElements(getElements, options = {}) {
            const timeoutMs = options.timeoutMs || 2000;
            const intervalMs = options.intervalMs || 200;
            const startedAt = Date.now();

            while (Date.now() - startedAt < timeoutMs) {
                const elements = getElements();
                if (elements.length > 0) {
                    return elements;
                }

                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }

            return getElements();
        },


        /**
         * Fill select dropdown fields
         */
        fillSelectFields(detectedFields) {
            const selectMappings = {
                gender: { value: this.userData.gender, patterns: FieldDetector.patterns.gender?.options },
                transgender: { value: this.userData.transgender, patterns: FieldDetector.patterns.transgender?.options },
                sexualOrientation: { value: this.userData.sexualOrientation, patterns: FieldDetector.patterns.sexualOrientation?.options },
                pronouns: { value: this.userData.pronouns, patterns: FieldDetector.patterns.pronouns?.options },
                hispanicLatino: { value: this.userData.hispanicLatino || 'no', patterns: FieldDetector.patterns.hispanicLatino?.options },
                race: { value: this.userData.race, patterns: FieldDetector.patterns.race?.options },
                veteran: { value: this.userData.veteran, patterns: FieldDetector.patterns.veteran?.options },
                disability: { value: this.userData.disability, patterns: FieldDetector.patterns.disability?.options },
                workAuth: { value: this.userData.workAuth, patterns: FieldDetector.patterns.workAuth?.options },
                sponsorship: { value: this.userData.sponsorship, patterns: FieldDetector.patterns.sponsorship?.options },
                onsiteComfort: { value: this.userData.onsiteComfort, patterns: FieldDetector.patterns.onsiteComfort?.options },
                relocationWillingness: { value: this.userData.relocationWillingness, patterns: FieldDetector.patterns.relocationWillingness?.options },
                internshipStatus: { value: this.userData.internshipStatus, patterns: FieldDetector.patterns.internshipStatus?.options },
                over18: { value: this.userData.over18, patterns: FieldDetector.patterns.over18?.options },
                formerEmployee: { value: this.userData.formerEmployee, patterns: FieldDetector.patterns.formerEmployee?.options },
                startAvailability: { value: this.userData.startAvailability, patterns: FieldDetector.patterns.startAvailability?.options }
            };

            for (const [fieldType, config] of Object.entries(selectMappings)) {
                if (!config.value || !detectedFields[fieldType]) continue;

                for (const select of detectedFields[fieldType]) {
                    if (select.tagName !== 'SELECT') continue;

                    if (!this.isElementAllowed(select)) continue;

                    const option = FieldDetector.findMatchingOption(select, config.value, config.patterns || {});
                    if (option && !select.value) {
                        select.value = option.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        this.filledFields.push({ type: fieldType, element: select });
                        this.highlightField(select, true);
                    }
                }
            }

            this.fillBinarySelects();
        },

        fillBinarySelects() {
            const allSelects = document.querySelectorAll('select');

            for (const select of allSelects) {
                if (select.value && select.selectedIndex > 0) continue;

                if (!this.isElementAllowed(select)) continue;

                const labelText = FieldDetector.getLabelText(select).toLowerCase();
                const parentText = (select.closest('div, fieldset, section')?.textContent || '').toLowerCase();
                const selectName = (select.name || '').toLowerCase();
                const selectId = (select.id || '').toLowerCase();

                const allText = `${labelText} ${parentText} ${selectName} ${selectId}`;
                const fieldType = FieldDetector.classifyBinaryQuestionType(allText);
                const targetValue = fieldType ? this.userData[fieldType] : null;
                if (!fieldType || !targetValue) continue;

                const option = FieldDetector.findMatchingOption(
                    select,
                    targetValue,
                    FieldDetector.patterns[fieldType]?.options || {}
                );

                if (option) {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    this.filledFields.push({ type: fieldType, element: select });
                    this.highlightField(select, true);
                }
            }
        },

        /**
         * Find and fill Hispanic/Latino select dropdowns specifically
         */
        fillHispanicLatinoSelects() {
            const hispanicValue = this.userData.hispanicLatino || 'no';

            const allSelects = document.querySelectorAll('select');
            const hispanicPatterns = ['hispanic', 'latino', 'latina', 'latinx', 'ethnicity'];

            for (const select of allSelects) {
                // Skip if already has a value selected
                if (select.value && select.selectedIndex > 0) continue;

                if (!this.isElementAllowed(select)) continue;

                // Get surrounding text to check context
                const labelText = FieldDetector.getLabelText(select).toLowerCase();
                const parentText = (select.closest('div, fieldset, section')?.textContent || '').toLowerCase().substring(0, 200);
                const selectName = (select.name || '').toLowerCase();
                const selectId = (select.id || '').toLowerCase();

                const allText = `${labelText} ${parentText} ${selectName} ${selectId}`;
                const isHispanicQuestion = hispanicPatterns.some(p => allText.includes(p)) &&
                    !allText.includes('race'); // Exclude race dropdowns

                if (isHispanicQuestion) {
                    console.log('[JobAutofill] Found Hispanic/Latino dropdown');

                    const options = Array.from(select.options);
                    const targetValue = hispanicValue;

                    for (const option of options) {
                        const optText = option.textContent.toLowerCase().trim();
                        const optVal = option.value.toLowerCase().trim();

                        if (targetValue === 'yes' && (optText === 'yes' || optVal === 'yes' ||
                            optText.includes('hispanic') || optText.includes('latino'))) {
                            select.value = option.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            this.filledFields.push({ type: 'hispanicLatino', element: select });
                            this.highlightField(select, true);
                            console.log(`[JobAutofill] Selected Hispanic/Latino: ${optText}`);
                            break;
                        } else if (targetValue === 'no' && (optText === 'no' || optVal === 'no' ||
                            optText.includes('not hispanic') || optText.includes('not latino'))) {
                            select.value = option.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            this.filledFields.push({ type: 'hispanicLatino', element: select });
                            this.highlightField(select, true);
                            console.log(`[JobAutofill] Selected Hispanic/Latino: ${optText}`);
                            break;
                        }
                    }
                }
            }
        },

        fillRaceSelects() {
            if (!this.userData.race) return;

            const allSelects = document.querySelectorAll('select');
            const racePatterns = ['race', 'ethnic', 'race ethnicity', 'race/ethnicity', 'ethnicity category', 'racial'];
            const specificPhrase = 'please select the race ethnicity category that best represents you';
            const raceOptionSignals = [
                'white', 'black', 'african american', 'asian', 'american indian', 'alaska native',
                'native hawaiian', 'pacific islander', 'two or more', 'multiracial', 'decline',
                'prefer not', 'do not wish'
            ];

            for (const select of allSelects) {
                if (select.value && select.selectedIndex > 0) continue;

                if (!this.isElementAllowed(select)) continue;

                const labelText = FieldDetector.getLabelText(select).toLowerCase();
                const questionText = FieldDetector.getQuestionText(select).toLowerCase();
                const parentText = (select.closest('div, fieldset, section')?.textContent || '').toLowerCase().substring(0, 300);
                const selectName = (select.name || '').toLowerCase();
                const selectId = (select.id || '').toLowerCase();

                const allText = `${labelText} ${questionText} ${parentText} ${selectName} ${selectId}`;
                const normalizedAllText = this.normalizeText(allText);

                const isHispanicOnly = normalizedAllText.includes('hispanic') &&
                    !normalizedAllText.includes('race') && !normalizedAllText.includes('ethnic');
                if (isHispanicOnly) continue;

                const isRaceQuestion = racePatterns.some(p => normalizedAllText.includes(this.normalizeText(p))) ||
                    normalizedAllText.includes(this.normalizeText(specificPhrase));

                const options = Array.from(select.options);
                let signalCount = 0;
                for (const option of options) {
                    const optionText = (option.textContent || '').toLowerCase().trim();
                    if (raceOptionSignals.some(signal => optionText.includes(signal))) {
                        signalCount += 1;
                        if (signalCount >= 2) break;
                    }
                }

                const hasRaceOptions = signalCount >= 2;
                if (!isRaceQuestion && !hasRaceOptions) continue;

                const option = FieldDetector.findMatchingOption(
                    select,
                    this.userData.race,
                    FieldDetector.patterns.race?.options || {}
                );

                if (option) {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    this.filledFields.push({ type: 'race', element: select });
                    this.highlightField(select, true);
                    console.log(`[JobAutofill] Selected race option: ${option.textContent.trim()}`);
                }
            }
        },

        /**
         * Find and fill country/location select dropdowns
         */
        fillCountryLocationSelects() {
            const allSelects = document.querySelectorAll('select');
            const locationPatterns = ['where are you located', 'location', 'country', 'region', 'where do you live', 'current location', 'based in'];

            for (const select of allSelects) {
                // Skip if already has a value selected
                if (select.value && select.selectedIndex > 0) continue;

                if (!this.isElementAllowed(select)) continue;

                // Get surrounding text to check context
                const labelText = FieldDetector.getLabelText(select).toLowerCase();
                const parentText = (select.closest('div, fieldset, section')?.textContent || '').toLowerCase().substring(0, 300);
                const selectName = (select.name || '').toLowerCase();
                const selectId = (select.id || '').toLowerCase();

                const allText = `${labelText} ${parentText} ${selectName} ${selectId}`;

                // Check if this is a location/country question
                const isLocationQuestion = locationPatterns.some(p => allText.includes(p)) ||
                    selectName.includes('country') || selectId.includes('country') ||
                    selectName.includes('location') || selectId.includes('location');

                // Skip if it's a city/state specific question (those are handled differently)
                const isCityStateQuestion = allText.includes('city') && !allText.includes('country');

                if (isLocationQuestion && !isCityStateQuestion) {
                    console.log('[JobAutofill] Found country/location dropdown');

                    const options = Array.from(select.options);

                    // Priority order for matching
                    const preferredOptions = [
                        'united states/canada',
                        'united states / canada',
                        'united states',
                        'usa',
                        'us',
                        'america',
                        'north america'
                    ];

                    let matchedOption = null;

                    // First, try exact matches in priority order
                    for (const preferred of preferredOptions) {
                        for (const option of options) {
                            const optText = option.textContent.toLowerCase().trim();
                            const optVal = option.value.toLowerCase().trim();

                            if (optText === preferred || optVal === preferred ||
                                optText.includes(preferred)) {
                                matchedOption = option;
                                break;
                            }
                        }
                        if (matchedOption) break;
                    }

                    // If no match found, try partial matches
                    if (!matchedOption) {
                        for (const option of options) {
                            const optText = option.textContent.toLowerCase().trim();
                            if (optText.includes('united states') || optText.includes('usa') ||
                                (optText.includes('us') && optText.length < 20)) {
                                matchedOption = option;
                                break;
                            }
                        }
                    }

                    if (matchedOption) {
                        select.value = matchedOption.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        this.filledFields.push({ type: 'country', element: select });
                        this.highlightField(select, true);
                        console.log(`[JobAutofill] Selected country/location: ${matchedOption.textContent.trim()}`);
                    }
                }
            }
        },


        /**
         * Handle file upload for resume
         */
        async handleFileUpload() {
            if (!this.resumeData) {
                console.log('[JobAutofill] No resume data stored');
                return;
            }

            // Find ALL file inputs on the page
            const fileInputs = document.querySelectorAll('input[type="file"]');
            console.log(`[JobAutofill] Found ${fileInputs.length} file inputs`);

            for (const input of fileInputs) {
                // Skip if already has files
                if (input.files && input.files.length > 0) {
                    console.log('[JobAutofill] Input already has files, skipping');
                    continue;
                }

                if (!this.isElementAllowed(input)) continue;

                if (input.disabled) {
                    continue;
                }

                // Check if it's likely a resume upload using multiple methods
                const labelText = FieldDetector.getLabelText(input).toLowerCase();
                const inputName = (input.name || '').toLowerCase();
                const inputId = (input.id || '').toLowerCase();
                const acceptAttr = (input.accept || '').toLowerCase();
                const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();

                // Check parent container text for context
                const parentContainer = input.closest('div, section, fieldset, form');
                const parentText = parentContainer ? parentContainer.textContent.toLowerCase().slice(0, 500) : '';

                // Resume-related keywords
                const resumeKeywords = ['resume', 'cv', 'curriculum', 'upload your', 'attach', 'document'];
                const allText = `${labelText} ${inputName} ${inputId} ${ariaLabel} ${parentText}`;

                const isResumeUpload =
                    resumeKeywords.some(kw => allText.includes(kw)) ||
                    acceptAttr.includes('pdf') ||
                    acceptAttr.includes('doc') ||
                    acceptAttr.includes('.pdf') ||
                    acceptAttr.includes('.doc') ||
                    acceptAttr === '' || // Some sites don't specify accept
                    acceptAttr.includes('application');

                console.log(`[JobAutofill] Checking file input: name=${inputName}, isResume=${isResumeUpload}`);

                if (!isResumeUpload && fileInputs.length > 1) {
                    // Only skip if there are multiple file inputs and this one doesn't look like resume
                    continue;
                }

                try {
                    // Convert base64 to file
                    const file = this.base64ToFile(
                        this.resumeData.data,
                        this.resumeData.name,
                        this.resumeData.type
                    );

                    if (!this.canAcceptResumeFile(input, file)) {
                        continue;
                    }

                    console.log(`[JobAutofill] Created file: ${file.name}, size: ${file.size}`);

                    // Create DataTransfer to set files
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);

                    // Set the files property
                    input.files = dataTransfer.files;

                    // Dispatch multiple events for compatibility with different frameworks
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));

                    // For React file inputs
                    const nativeInputFileSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'files'
                    )?.set;
                    if (nativeInputFileSetter) {
                        nativeInputFileSetter.call(input, dataTransfer.files);
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    if (!input.files || input.files.length === 0) {
                        console.warn('[JobAutofill] File input rejected the attached resume');
                        continue;
                    }

                    // Try triggering click events that might be needed
                    const uploadButton = parentContainer?.querySelector('button, [role="button"], .upload-btn, [class*="upload"]');
                    if (uploadButton) {
                        console.log('[JobAutofill] Found upload button, dispatching event');
                    }

                    this.filledFields.push({ type: 'resume', element: input });
                    this.highlightField(input, true);

                    console.log('[JobAutofill] Resume file attached successfully');

                    // Only fill the first matching resume input
                    return;

                } catch (error) {
                    console.error('[JobAutofill] Failed to upload resume:', error);
                }
            }
        },

        /**
         * Convert base64 data URL to File object
         */
        base64ToFile(dataUrl, filename, mimeType) {
            if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(',')) {
                throw new Error('Stored resume data is invalid');
            }

            const arr = dataUrl.split(',');
            const mime = mimeType || arr[0].match(/:(.*?);/)?.[1] || 'application/pdf';

            if (!arr[1]) {
                throw new Error('Stored resume payload is empty');
            }

            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);

            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }

            return new File([u8arr], filename, { type: mime });
        },

        canAcceptResumeFile(input, file) {
            const accept = (input.accept || '').toLowerCase().trim();
            if (!accept) {
                return true;
            }

            const acceptedTypes = accept.split(',').map(part => part.trim()).filter(Boolean);
            const fileName = file.name.toLowerCase();
            const fileType = (file.type || '').toLowerCase();

            return acceptedTypes.some(entry => {
                if (entry.startsWith('.')) {
                    return fileName.endsWith(entry);
                }

                if (entry.endsWith('/*')) {
                    const prefix = entry.slice(0, -1);
                    return fileType.startsWith(prefix);
                }

                return fileType === entry;
            });
        },

        /**
         * Parse first name from full name
         */
        parseFirstName(fullName) {
            if (!fullName) return '';
            const parts = fullName.trim().split(/\s+/);
            return parts[0] || '';
        },

        /**
         * Parse last name from full name
         */
        parseLastName(fullName) {
            if (!fullName) return '';
            const parts = fullName.trim().split(/\s+/);
            return parts.length > 1 ? parts.slice(1).join(' ') : '';
        },

        /**
         * Format location as "City, State"
         */
        formatLocation() {
            if (this.userData.city && this.userData.state) {
                return `${this.userData.city}, ${this.userData.state}`;
            }
            return this.userData.city || this.userData.state || '';
        },

        /**
         * Highlight a field after filling
         */
        highlightField(element, success) {
            if (!this.settings?.showIndicators) return;
            const successClass = 'job-autofill-highlight-success';
            const errorClass = 'job-autofill-highlight-error';

            element.classList.remove(successClass, errorClass);
            element.classList.add(success ? successClass : errorClass);

            setTimeout(() => {
                element.classList.remove(successClass, errorClass);
            }, 2000);
        },

        /**
         * Observe DOM for dynamically loaded content
         */
        observeDynamicContent() {
            if (this.mutationObserver || !document.body) {
                return;
            }

            this.mutationObserver = new MutationObserver((mutations) => {
                let hasNewForms = false;

                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.tagName === 'FORM' || node.querySelector?.('form, input, select')) {
                                hasNewForms = true;
                                break;
                            }
                        }
                    }
                    if (hasNewForms) break;
                }

                // If new form elements were added, refresh floating button visibility
                if (hasNewForms && this.settings.autoDetect !== false && this.isLikelyJobPage()) {
                    this.addFloatingButton();
                }
            });

            this.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    };

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ContentScript.init());
    } else {
        ContentScript.init();
    }
})();
