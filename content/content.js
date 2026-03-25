/**
 * Content Script for Job Application Autofill
 * Handles form detection and autofill on job application pages
 */

(function () {
    'use strict';

    const GREENHOUSE_SELECT_CLASSES = {
        input: 'select__input',
        control: 'select__control',
        menu: 'select__menu',
        option: 'select__option',
        indicator: 'select__indicator'
    };
    const EDUCATION_DEGREE_KEYWORDS = ['degree', 'education level', 'level of education', 'highest education', 'academic level'];
    const EDUCATION_SCHOOL_KEYWORDS = ['school', 'university', 'college', 'institution', 'academy'];

    // Prevent multiple initializations
    if (window.jobAutofillInitialized) return;
    window.jobAutofillInitialized = true;

    const ContentScript = {
        userData: null,
        resumeData: null,
        parsedResumeData: null,
        aiAnswerCache: {},
        sessionAnswerCache: new Map(),
        filledFields: [],
        mutationObserver: null,
        unloadHandler: null,
        messageHandler: null,
        storageChangeHandler: null,
        initialized: false,
        settings: {
            autoDetect: true,
            showIndicators: true,
            confirmBeforeFill: false,
            aiAssist: {
                enabled: false,
                model: 'mistral-small-latest',
                apiKey: '',
                extraContext: '',
                maxCharacters: 320,
                maxQuestionsPerRun: 10
            }
        },
        allowedFormKeys: null,
        formKeyMap: new WeakMap(),
        formKeyCounter: 0,
        debugSession: null,
        floatingWidget: null,
        floatingButton: null,
        floatingPanel: null,
        hoverOpenTimer: null,
        hoverCloseTimer: null,
        floatingButtonResetTimer: null,
        lastStatusSnapshot: null,
        autofillPromise: null,
        activeAutofillScopeRoot: null,

        resetDebugSession() {
            this.sessionAnswerCache = new Map();
            this.debugSession = {
                startedAt: new Date().toISOString(),
                detectionReports: [],
                events: []
            };
            this.lastStatusSnapshot = null;
            this.syncDebugState();
        },

        syncDebugState() {
            if (typeof window === 'undefined') {
                return;
            }

            window.JobAutofillDebug = {
                lastRun: this.debugSession,
                lastStatusSnapshot: this.lastStatusSnapshot
            };
        },

        getElementDebugInfo(element) {
            if (!element) {
                return {
                    descriptor: '',
                    tagName: '',
                    inputType: '',
                    name: '',
                    id: '',
                    labelText: '',
                    questionText: '',
                    placeholder: '',
                    currentValue: ''
                };
            }

            const context = typeof FieldDetector?.getFieldDebugContext === 'function'
                ? FieldDetector.getFieldDebugContext(element)
                : null;

            return {
                descriptor: context?.descriptor || `${(element.tagName || '').toLowerCase()}${element.id ? `#${element.id}` : ''}`,
                tagName: context?.tagName || (element.tagName || '').toLowerCase(),
                inputType: context?.inputType || (element.type || '').toLowerCase(),
                name: context?.name || element.name || '',
                id: context?.id || element.id || '',
                labelText: context?.labelText || '',
                questionText: context?.questionText || '',
                placeholder: context?.placeholder || element.placeholder || '',
                currentValue: context?.currentValue || element.value || element.textContent?.trim() || '',
                isRequired: Boolean(context?.isRequired),
                controlKind: context?.controlKind || context?.tagName || (element.tagName || '').toLowerCase()
            };
        },

        escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        getFieldTypeLabel(fieldType) {
            const labels = {
                aiChoiceField: 'AI choice',
                aiComboboxChoice: 'AI combobox choice',
                aiTextQuestion: 'AI text question',
                city: 'City',
                country: 'Country',
                disability: 'Disability status',
                email: 'Email',
                firstName: 'First name',
                formerEmployee: 'Former employee',
                fullName: 'Full name',
                gender: 'Gender',
                github: 'GitHub',
                hispanicLatino: 'Hispanic/Latino',
                internshipStatus: 'Internship status',
                lastName: 'Last name',
                linkedin: 'LinkedIn',
                location: 'Location',
                onsiteComfort: 'Onsite comfort',
                over18: '18+ confirmation',
                phone: 'Phone',
                phoneCountryCode: 'Phone country code',
                preferredFirstName: 'Preferred first name',
                pronouns: 'Pronouns',
                race: 'Race',
                relocationWillingness: 'Relocation willingness',
                resume: 'Resume upload',
                sexualOrientation: 'Sexual orientation',
                sponsorship: 'Sponsorship',
                startAvailability: 'Start availability',
                state: 'State',
                transgender: 'Transgender status',
                veteran: 'Veteran status',
                website: 'Website / portfolio',
                workAuth: 'Work authorization'
            };

            if (labels[fieldType]) {
                return labels[fieldType];
            }

            return String(fieldType || 'Detected field')
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .replace(/\b\w/g, char => char.toUpperCase());
        },

        humanizeReason(reason) {
            const labels = {
                'already-has-value': 'Already answered',
                'already-selected': 'Already selected',
                'blocked-by-form-filter': 'Skipped by form selection',
                'button-input': 'Button input ignored',
                'custom-combobox-input': 'React/custom combobox',
                disabled: 'Disabled control',
                'file-input': 'File input handled separately',
                'hidden-input': 'Hidden field ignored',
                'input-value-did-not-stick': 'Value did not stick',
                'missing-element': 'Field not available',
                'missing-fill-value': 'No saved answer available',
                'missing-input': 'Input not found',
                readonly: 'Read-only field',
                'select-value-did-not-stick': 'Selection did not stick',
                'selected-option': 'Selected option applied',
                'submit-input': 'Submit control ignored',
                'text-mapping': 'Text fill',
                'user-canceled-confirm-before-fill': 'Canceled before fill',
                'value-applied': 'Answer applied'
            };

            if (labels[reason]) {
                return labels[reason];
            }

            return String(reason || '')
                .replace(/[-_]+/g, ' ')
                .replace(/\b\w/g, char => char.toUpperCase());
        },

        getHoverStatusConfig(status) {
            switch (status) {
                case 'completed':
                    return { marker: '✓', label: 'Completed', className: 'is-completed', summaryKey: 'answered', order: 0 };
                case 'already-completed':
                    return { marker: '✓', label: 'Already answered', className: 'is-answered', summaryKey: 'answered', order: 1 };
                case 'error':
                    return { marker: '!', label: 'Error', className: 'is-error', summaryKey: 'needsReview', order: 2 };
                case 'skipped':
                    return { marker: '-', label: 'Skipped', className: 'is-skipped', summaryKey: 'skipped', order: 3 };
                default:
                    return { marker: '•', label: 'Needs review', className: 'is-pending', summaryKey: 'needsReview', order: 4 };
            }
        },

        getHoverItemKey(data = {}) {
            const stableQuestion = this.normalizeText(data.question || data.label || data.placeholder || '');
            const stableIdentity = this.normalizeText(data.name || data.id || '');
            const stableFieldType = String(data.fieldType || '').trim().toLowerCase();
            const stableElement = String(data.element || data.descriptor || '').trim().toLowerCase();

            if (stableQuestion) {
                return stableQuestion;
            }

            if (stableFieldType && stableIdentity) {
                return `${stableFieldType}|${stableIdentity}`;
            }

            return [stableFieldType, stableElement, stableIdentity].join('|');
        },

        buildHoverItemTitle(data = {}) {
            return [
                data.question,
                data.label,
                data.placeholder,
                data.name,
                data.id,
                data.element
            ].find(value => typeof value === 'string' && value.trim()) || this.getFieldTypeLabel(data.fieldType);
        },

        upsertHoverItem(itemMap, nextItem) {
            const key = this.getHoverItemKey(nextItem);
            const existing = itemMap.get(key);
            const nextOrder = this.getHoverStatusConfig(nextItem.status).order;

            if (!existing) {
                itemMap.set(key, {
                    ...nextItem,
                    key,
                    order: nextOrder
                });
                return;
            }

            const shouldReplaceStatus = nextOrder <= existing.order;
            const nextIsCustomControl = nextItem.controlKind === 'custom-combobox';
            const existingIsCustomControl = existing.controlKind === 'custom-combobox';
            const shouldPreferNextTitle = Boolean(nextItem.title) && (
                !existing.title ||
                existing.title === existing.displayName ||
                (nextIsCustomControl && !existingIsCustomControl)
            );
            const shouldPreferNextFieldType = Boolean(nextItem.fieldType) && (
                !existing.fieldType ||
                existing.fieldType === 'unknown' ||
                (existing.fieldType === 'city' && nextItem.fieldType !== 'city' && nextIsCustomControl)
            );
            const shouldPreferNextControl = nextIsCustomControl && !existingIsCustomControl;

            itemMap.set(key, {
                ...existing,
                fieldType: shouldPreferNextFieldType ? nextItem.fieldType : (existing.fieldType || nextItem.fieldType),
                displayName: shouldPreferNextFieldType ? nextItem.displayName : (existing.displayName || nextItem.displayName),
                title: shouldPreferNextTitle ? nextItem.title : (existing.title || nextItem.title),
                detail: shouldReplaceStatus ? (nextItem.detail || existing.detail) : (existing.detail || nextItem.detail),
                element: shouldPreferNextControl ? nextItem.element : (existing.element || nextItem.element),
                label: shouldPreferNextTitle ? (nextItem.label || existing.label) : (existing.label || nextItem.label),
                question: shouldPreferNextTitle ? (nextItem.question || existing.question) : (existing.question || nextItem.question),
                name: shouldPreferNextFieldType ? (nextItem.name || existing.name) : (existing.name || nextItem.name),
                id: shouldPreferNextFieldType ? (nextItem.id || existing.id) : (existing.id || nextItem.id),
                placeholder: shouldPreferNextTitle ? (nextItem.placeholder || existing.placeholder) : (existing.placeholder || nextItem.placeholder),
                currentValue: existing.currentValue || nextItem.currentValue,
                isRequired: existing.isRequired || nextItem.isRequired,
                controlKind: shouldPreferNextControl ? nextItem.controlKind : (existing.controlKind || nextItem.controlKind),
                confidence: Math.max(
                    Number.isFinite(existing.confidence) ? existing.confidence : 0,
                    Number.isFinite(nextItem.confidence) ? nextItem.confidence : 0
                ) || null,
                confidenceLabel: (Number.isFinite(nextItem.confidence) ? nextItem.confidence : 0) >= (Number.isFinite(existing.confidence) ? existing.confidence : 0)
                    ? (nextItem.confidenceLabel || existing.confidenceLabel)
                    : (existing.confidenceLabel || nextItem.confidenceLabel),
                status: shouldReplaceStatus ? nextItem.status : existing.status,
                order: shouldReplaceStatus ? nextOrder : existing.order
            });
        },

        createHoverItem(data = {}, status = 'pending', detail = '') {
            return {
                fieldType: data.fieldType || 'unknown',
                displayName: this.getFieldTypeLabel(data.fieldType),
                title: this.buildHoverItemTitle(data),
                detail,
                element: data.element || data.descriptor || '',
                label: data.label || '',
                question: data.question || '',
                name: data.name || '',
                id: data.id || '',
                placeholder: data.placeholder || '',
                currentValue: data.currentValue || '',
                isRequired: Boolean(data.isRequired),
                controlKind: data.controlKind || '',
                confidence: Number.isFinite(data.confidence) ? data.confidence : null,
                confidenceLabel: data.confidenceLabel || '',
                status
            };
        },

        buildHoverSnapshot(report = null) {
            const activeScopeRoot = this.getCurrentAutofillScopeRoot();
            const detectionReport = report || FieldDetector.detectFields({
                includeDiagnostics: true,
                root: activeScopeRoot || document
            });
            const itemMap = new Map();
            const detectedFieldTypes = new Set(
                (detectionReport.detected || []).map(item => item.fieldType).filter(Boolean)
            );
            const customDetectedFieldTypes = new Set(
                (detectionReport.detected || [])
                    .filter(item => item.context?.controlKind === 'custom-combobox')
                    .map(item => item.fieldType)
                    .filter(Boolean)
            );

            (detectionReport.detected || []).forEach(item => {
                const inferredFieldType = item.context?.controlKind === 'custom-combobox'
                    ? this.inferStructuredChoiceFieldType(item.context?.questionText, item.context?.labelText, item.context?.placeholder)
                    : null;
                const normalizedFieldType = inferredFieldType || item.fieldType;
                const detailParts = [];
                if (item.context?.controlKind === 'custom-combobox') {
                    detailParts.push('React/custom control');
                }
                if (item.matchedBy) {
                    detailParts.push(`Detected via ${this.humanizeReason(item.matchedBy).toLowerCase()}`);
                }
                if (Number.isFinite(item.confidence) && item.confidence > 0) {
                    detailParts.push(`${item.confidenceLabel || 'scored'} confidence (${item.confidence})`);
                }
                if (item.context?.isRequired) {
                    detailParts.push('required');
                }
                const status = item.context?.currentValue ? 'already-completed' : 'pending';
                this.upsertHoverItem(itemMap, this.createHoverItem({
                    fieldType: normalizedFieldType,
                    element: item.context?.descriptor,
                    label: item.context?.labelText,
                    question: item.context?.questionText,
                    name: item.context?.name,
                    id: item.context?.id,
                    placeholder: item.context?.placeholder,
                    currentValue: item.context?.currentValue,
                    isRequired: item.context?.isRequired,
                    controlKind: item.context?.controlKind,
                    confidence: item.confidence,
                    confidenceLabel: item.confidenceLabel
                }, status, detailParts.join(' • ')));
            });

            const events = this.debugSession?.events || [];
            events.forEach(event => {
                if (!(event.fieldType || event.element || event.label || event.question || event.name || event.id)) {
                    return;
                }

                if (!event.element && !event.label && !event.question && event.stage !== 'targeted-dropdown') {
                    return;
                }

                if (event.stage === 'select-mapping' || event.stage === 'text-mapping') {
                    return;
                }

                if (
                    event.reason === 'field-type-not-detected' ||
                    event.reason === 'already-attempted-this-run' ||
                    event.reason === 'already-answered' ||
                    event.reason === 'already-selected' ||
                    event.reason === 'already-has-value'
                ) {
                    return;
                }

                const isMappingOnlySkip = event.outcome === 'skipped' && (
                    event.stage === 'select-mapping' || event.stage === 'text-mapping'
                );
                if (isMappingOnlySkip && (detectedFieldTypes.has(event.fieldType) || customDetectedFieldTypes.has(event.fieldType))) {
                    return;
                }

                let status = null;
                if (event.outcome === 'filled') {
                    status = 'completed';
                } else if (event.outcome === 'error') {
                    status = 'error';
                } else if (event.outcome === 'skipped') {
                    status = event.reason === 'already-has-value' || event.reason === 'already-selected'
                        ? 'already-completed'
                        : 'skipped';
                }

                if (!status) {
                    return;
                }

                const inferredFieldType = event.controlKind === 'custom-combobox'
                    ? this.inferStructuredChoiceFieldType(event.question, event.label)
                    : null;

                const detail = [
                    event.stage ? this.humanizeReason(event.stage) : '',
                    event.reason ? this.humanizeReason(event.reason) : ''
                ].filter(Boolean).join(' • ');

                this.upsertHoverItem(itemMap, this.createHoverItem({
                    fieldType: inferredFieldType || event.fieldType,
                    element: event.element,
                    label: event.label,
                    question: event.question,
                    name: event.name,
                    id: event.id,
                    currentValue: event.currentValue,
                    controlKind: event.controlKind
                }, status, detail));
            });

            const items = Array.from(itemMap.values()).sort((left, right) => {
                if (left.order !== right.order) {
                    return left.order - right.order;
                }
                return left.displayName.localeCompare(right.displayName) || left.title.localeCompare(right.title);
            });

            const summary = items.reduce((counts, item) => {
                counts.detected += 1;
                const summaryKey = this.getHoverStatusConfig(item.status).summaryKey;
                counts[summaryKey] += 1;
                return counts;
            }, {
                detected: 0,
                answered: 0,
                skipped: 0,
                needsReview: 0
            });

            return {
                updatedAt: new Date().toISOString(),
                summary,
                items,
                message: items.length
                    ? 'Hover here to inspect detected fields and the latest autofill results.'
                    : 'No supported fields detected yet.'
            };
        },

        renderHoverPanel(snapshot = null) {
            if (!this.floatingPanel) {
                return;
            }

            const panelSnapshot = snapshot || this.lastStatusSnapshot || this.buildHoverSnapshot();
            this.lastStatusSnapshot = panelSnapshot;

            const summaryCards = [
                { label: 'Detected', value: panelSnapshot.summary.detected },
                { label: 'Answered', value: panelSnapshot.summary.answered },
                { label: 'Skipped', value: panelSnapshot.summary.skipped },
                { label: 'Needs review', value: panelSnapshot.summary.needsReview }
            ].map(item => `
                <div class="job-autofill-panel-stat">
                    <span>${this.escapeHtml(item.label)}</span>
                    <strong>${item.value}</strong>
                </div>
            `).join('');

            const itemMarkup = panelSnapshot.items.length > 0
                ? panelSnapshot.items.map(item => {
                    const config = this.getHoverStatusConfig(item.status);
                    return `
                        <div class="job-autofill-panel-item ${config.className}">
                            <div class="job-autofill-panel-marker">${this.escapeHtml(config.marker)}</div>
                            <div class="job-autofill-panel-copy">
                                <div class="job-autofill-panel-line">
                                    <strong>${this.escapeHtml(item.displayName)}</strong>
                                    <span class="job-autofill-panel-badge">${this.escapeHtml(config.label)}</span>
                                </div>
                                <div class="job-autofill-panel-title">${this.escapeHtml(item.title)}</div>
                                ${item.detail ? `<div class="job-autofill-panel-detail">${this.escapeHtml(item.detail)}</div>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')
                : `<div class="job-autofill-panel-empty">${this.escapeHtml(panelSnapshot.message)}</div>`;

            this.floatingPanel.innerHTML = `
                <div class="job-autofill-panel-header">
                    <div>
                        <strong>Autofill status</strong>
                        <div class="job-autofill-panel-note">${this.escapeHtml(panelSnapshot.message)}</div>
                    </div>
                </div>
                <div class="job-autofill-panel-summary">${summaryCards}</div>
                <div class="job-autofill-panel-list">${itemMarkup}</div>
            `;

            this.syncDebugState();
        },

        openHoverPanel() {
            if (!this.floatingWidget) {
                return;
            }

            window.clearTimeout(this.hoverCloseTimer);
            this.hoverCloseTimer = null;
            this.renderHoverPanel(this.buildHoverSnapshot());
            this.setHoverPanelOpenState(true);
        },

        setHoverPanelOpenState(isOpen) {
            if (!this.floatingWidget) {
                return;
            }

            this.floatingWidget.classList.toggle('is-open', isOpen);

            if (this.floatingButton) {
                this.floatingButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            }

            if (this.floatingPanel) {
                this.floatingPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
            }
        },

        syncHoverPanelVisibility() {
            if (!this.floatingWidget) {
                return;
            }

            const isButtonHovered = Boolean(this.floatingButton && this.floatingButton.matches(':hover'));
            const isPanelHovered = Boolean(this.floatingPanel && this.floatingPanel.matches(':hover'));

            if (isButtonHovered || isPanelHovered) {
                this.openHoverPanel();
                return;
            }

            this.setHoverPanelOpenState(false);
        },

        scheduleHoverPanelClose() {
            if (!this.floatingWidget) {
                return;
            }

            window.clearTimeout(this.hoverOpenTimer);
            this.hoverOpenTimer = null;
            window.clearTimeout(this.hoverCloseTimer);
            this.hoverCloseTimer = window.setTimeout(() => {
                this.syncHoverPanelVisibility();
            }, 140);
        },

        recordDebugEvent(stage, outcome, data = {}) {
            const elementInfo = this.getElementDebugInfo(data.element);
            const event = {
                timestamp: new Date().toISOString(),
                stage,
                outcome,
                fieldType: data.fieldType || '',
                reason: data.reason || '',
                value: data.value || '',
                source: data.source || '',
                options: Array.isArray(data.options) ? data.options.slice(0, 12) : undefined,
                element: elementInfo.descriptor,
                label: elementInfo.labelText,
                question: elementInfo.questionText,
                name: elementInfo.name,
                id: elementInfo.id,
                htmlType: elementInfo.inputType || elementInfo.tagName,
                currentValue: elementInfo.currentValue,
                isRequired: elementInfo.isRequired,
                controlKind: elementInfo.controlKind
            };

            if (this.debugSession) {
                this.debugSession.events.push(event);
                this.syncDebugState();
            }

            const consoleMethod = outcome === 'error'
                ? 'warn'
                : outcome === 'skipped'
                    ? 'info'
                    : 'log';
            const headline = [
                '[JobAutofill][Debug]',
                stage,
                outcome,
                event.fieldType || event.htmlType || '',
                event.reason || ''
            ].filter(Boolean).join(' ');

            console[consoleMethod](headline, event);
            return event;
        },

        logDetectionReport(report, phase = 'initial') {
            if (!report) {
                return;
            }

            const detectedRows = (report.detected || []).map(item => ({
                fieldType: item.fieldType,
                matchedBy: item.matchedBy,
                matchedValue: item.matchedValue,
                confidence: item.confidence,
                confidenceLabel: item.confidenceLabel,
                reason: item.reason,
                element: item.context?.descriptor || '',
                label: item.context?.labelText || '',
                question: item.context?.questionText || '',
                name: item.context?.name || '',
                id: item.context?.id || '',
                placeholder: item.context?.placeholder || '',
                currentValue: item.context?.currentValue || '',
                isRequired: Boolean(item.context?.isRequired),
                controlKind: item.context?.controlKind || item.context?.tagName || ''
            }));
            const unmatchedRows = (report.unmatched || []).map(item => ({
                reason: item.reason,
                element: item.context?.descriptor || '',
                label: item.context?.labelText || '',
                question: item.context?.questionText || '',
                name: item.context?.name || '',
                id: item.context?.id || '',
                placeholder: item.context?.placeholder || '',
                currentValue: item.context?.currentValue || '',
                isRequired: Boolean(item.context?.isRequired),
                controlKind: item.context?.controlKind || item.context?.tagName || ''
            }));
            const skippedRows = (report.skipped || []).map(item => ({
                reason: item.reason,
                element: item.context?.descriptor || '',
                label: item.context?.labelText || '',
                question: item.context?.questionText || '',
                name: item.context?.name || '',
                id: item.context?.id || '',
                placeholder: item.context?.placeholder || '',
                currentValue: item.context?.currentValue || '',
                isRequired: Boolean(item.context?.isRequired),
                controlKind: item.context?.controlKind || item.context?.tagName || ''
            }));

            if (this.debugSession) {
                this.debugSession.detectionReports.push({
                    phase,
                    summary: report.summary,
                    detected: detectedRows,
                    unmatched: unmatchedRows,
                    skipped: skippedRows
                });
                this.syncDebugState();
            }

            console.groupCollapsed(
                `[JobAutofill][Debug] ${phase} detection: ${report.summary.detectedCount} detected, ${report.summary.unmatchedCount} unmatched, ${report.summary.skippedCount} skipped`
            );
            console.table([{
                phase,
                totalInputs: report.summary.totalInputs,
                detected: report.summary.detectedCount,
                unmatched: report.summary.unmatchedCount,
                skipped: report.summary.skippedCount,
                detectedTypes: Object.entries(report.summary.detectedTypes || {})
                    .map(([fieldType, count]) => `${fieldType}:${count}`)
                    .join(', ')
            }]);

            if (detectedRows.length > 0) {
                console.table(detectedRows);
            }

            if (unmatchedRows.length > 0) {
                console.table(unmatchedRows);
            }

            if (skippedRows.length > 0) {
                console.table(skippedRows);
            }
            console.groupEnd();
        },

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

                if (
                    changes[StorageKeys.USER_DATA] ||
                    changes[StorageKeys.RESUME] ||
                    changes[StorageKeys.RESUME_PARSED] ||
                    changes[StorageKeys.AI_ANSWER_CACHE] ||
                    changes[StorageKeys.SETTINGS]
                ) {
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

            window.clearTimeout(this.hoverOpenTimer);
            window.clearTimeout(this.hoverCloseTimer);
            window.clearTimeout(this.floatingButtonResetTimer);
            this.hoverOpenTimer = null;
            this.hoverCloseTimer = null;
            this.floatingButtonResetTimer = null;

            if (this.floatingWidget?.isConnected) {
                this.floatingWidget.remove();
            }
            this.floatingWidget = null;
            this.floatingButton = null;
            this.floatingPanel = null;

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
                const result = await chrome.storage.local.get([
                    StorageKeys.USER_DATA,
                    StorageKeys.RESUME,
                    StorageKeys.RESUME_PARSED,
                    StorageKeys.AI_ANSWER_CACHE
                ]);
                this.userData = result[StorageKeys.USER_DATA] || null;
                this.resumeData = result[StorageKeys.RESUME] || null;
                this.parsedResumeData = result[StorageKeys.RESUME_PARSED] || null;
                this.aiAnswerCache = result[StorageKeys.AI_ANSWER_CACHE] || {};
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

            const scopeRoot = this.getCurrentAutofillScopeRoot() || document;

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

            let formsInOrder = Array.from(scopeRoot.querySelectorAll('form')).filter(form => formSet.has(form));
            const allowed = new Set();

            if (fields.length === 0) {
                formsInOrder = Array.from(scopeRoot.querySelectorAll('form'));
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
            const scopeRoot = this.getCurrentAutofillScopeRoot();
            if (scopeRoot && element && scopeRoot !== element && !scopeRoot.contains(element)) {
                return false;
            }

            if (!this.settings?.confirmBeforeFill) return true;
            if (!this.allowedFormKeys) return true;
            const form = element?.closest?.('form');
            if (!form) {
                return this.allowedFormKeys.has('document');
            }
            return this.allowedFormKeys.has(this.getFormKey(form));
        },

        isZipRecruiterPage() {
            return window.location.hostname.toLowerCase().includes('ziprecruiter.com');
        },

        getZipRecruiterApplyOverlay() {
            if (!this.isZipRecruiterPage()) {
                return null;
            }

            const selectors = [
                '[role="dialog"]',
                '[aria-modal="true"]',
                '[class*="modal"]',
                '[class*="Modal"]',
                '[class*="dialog"]',
                '[class*="Dialog"]',
                '[data-testid*="modal"]',
                '[data-testid*="dialog"]'
            ].join(', ');

            const candidates = Array.from(document.querySelectorAll(selectors))
                .filter(candidate => this.isElementVisiblyRendered(candidate));

            let bestCandidate = null;
            let bestScore = -1;

            for (const candidate of candidates) {
                const text = this.normalizeText(candidate.textContent || '');
                const hasApplySignals =
                    text.includes('1 click apply') ||
                    text.includes('one click apply') ||
                    text.includes('quick apply') ||
                    text.includes('submit application') ||
                    text.includes('job application');
                const formControlCount = candidate.querySelectorAll('input, select, textarea, button').length;
                const score =
                    (candidate.getAttribute('role') === 'dialog' ? 4 : 0) +
                    (candidate.getAttribute('aria-modal') === 'true' ? 4 : 0) +
                    (hasApplySignals ? 8 : 0) +
                    Math.min(formControlCount, 8);

                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = candidate;
                }
            }

            return bestScore >= 8 ? bestCandidate : null;
        },

        getZipRecruiterOverlayHost() {
            const overlay = this.getZipRecruiterApplyOverlay();
            if (!overlay) {
                return null;
            }

            let host = overlay;
            let current = overlay;

            while (current && current !== document.body) {
                const style = window.getComputedStyle(current);
                const rect = current.getBoundingClientRect();
                const coversViewport = rect.width >= window.innerWidth * 0.6 && rect.height >= window.innerHeight * 0.6;
                const isOverlayLayer = ['fixed', 'absolute', 'sticky'].includes(style.position) && coversViewport;

                if (style.pointerEvents !== 'none' && this.isElementVisiblyRendered(current)) {
                    host = current;
                }

                if (isOverlayLayer && style.pointerEvents !== 'none') {
                    host = current;
                }

                current = current.parentElement;
            }

            return host;
        },

        getCurrentAutofillScopeRoot() {
            if (this.activeAutofillScopeRoot?.isConnected) {
                return this.activeAutofillScopeRoot;
            }

            return this.getZipRecruiterApplyOverlay();
        },

        getFloatingWidgetHost() {
            return this.getZipRecruiterOverlayHost() || document.body;
        },

        syncFloatingWidgetHost() {
            if (!this.floatingWidget?.isConnected) {
                return;
            }

            const host = this.getFloatingWidgetHost();
            if (!host || this.floatingWidget.parentElement === host) {
                this.floatingWidget.dataset.host = host && host !== document.body ? 'overlay' : 'page';
                return;
            }

            host.appendChild(this.floatingWidget);
            this.floatingWidget.dataset.host = host !== document.body ? 'overlay' : 'page';
        },

        getElementFillBlockReason(element) {
            if (!element) {
                return 'missing-element';
            }

            if (!this.isElementAllowed(element)) {
                return 'blocked-by-form-filter';
            }

            if (element.disabled) {
                return 'disabled';
            }

            if (element.readOnly) {
                return 'readonly';
            }

            if (typeof element.value === 'string' && element.value.trim()) {
                return 'already-has-value';
            }

            return null;
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
                        if (this.floatingWidget?.isConnected) {
                                return;
                        }

                        const widget = document.createElement('div');
                        widget.id = 'job-autofill-widget';

                        const panel = document.createElement('div');
                        panel.id = 'job-autofill-panel';
                        panel.setAttribute('aria-live', 'polite');
                        panel.setAttribute('aria-hidden', 'true');

                        const button = document.createElement('button');
                        button.id = 'job-autofill-btn';
                        button.type = 'button';
                        button.title = 'Fill job application form';
                        button.setAttribute('aria-controls', 'job-autofill-panel');
                        button.setAttribute('aria-expanded', 'false');
                        button.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6H16V4C16 2.89 15.11 2 14 2H10C8.89 2 8 2.89 8 4V6H4C2.89 6 2 6.89 2 8V19C2 20.11 2.89 21 4 21H20C21.11 21 22 20.11 22 19V8C22 6.89 21.11 6 20 6ZM10 4H14V6H10V4ZM20 19H4V8H20V19Z" fill="currentColor"/>
                    <path d="M13 10H11V13H8V15H11V18H13V15H16V13H13V10Z" fill="currentColor"/>
                </svg>
                <span>Autofill</span>
            `;

                        button.addEventListener('click', async () => {
                                button.disabled = true;
                                window.clearTimeout(this.floatingButtonResetTimer);
                                button.classList.remove('job-autofill-btn--success', 'job-autofill-btn--error');
                                button.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" class="spin">
                        <path d="M12 4V1L8 5L12 9V6C15.31 6 18 8.69 18 12C18 13.01 17.75 13.97 17.3 14.8L18.76 16.26C19.54 15.03 20 13.57 20 12C20 7.58 16.42 4 12 4Z" fill="currentColor"/>
                        <path d="M12 18C8.69 18 6 15.31 6 12C6 10.99 6.25 10.03 6.7 9.2L5.24 7.74C4.46 8.97 4 10.43 4 12C4 16.42 7.58 20 12 20V23L16 19L12 15V18Z" fill="currentColor"/>
                    </svg>
                    <span>Filling...</span>
                `;

                                const result = await this.performAutofill();
                                this.renderHoverPanel(this.buildHoverSnapshot());
                                this.syncHoverPanelVisibility();

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

                                this.floatingButtonResetTimer = window.setTimeout(() => {
                                        button.disabled = false;
                                        button.classList.remove('job-autofill-btn--success', 'job-autofill-btn--error');
                                        button.innerHTML = `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M20 6H16V4C16 2.89 15.11 2 14 2H10C8.89 2 8 2.89 8 4V6H4C2.89 6 2 6.89 2 8V19C2 20.11 2.89 21 4 21H20C21.11 21 22 20.11 22 19V8C22 6.89 21.11 6 20 6ZM10 4H14V6H10V4ZM20 19H4V8H20V19Z" fill="currentColor"/>
                            <path d="M13 10H11V13H8V15H11V18H13V15H16V13H13V10Z" fill="currentColor"/>
                        </svg>
                        <span>Autofill</span>
                    `;
                                        this.syncHoverPanelVisibility();
                                }, 3000);
                        });

                        button.addEventListener('mouseenter', () => {
                                window.clearTimeout(this.hoverOpenTimer);
                                this.hoverOpenTimer = window.setTimeout(() => {
                                        this.openHoverPanel();
                                }, 40);
                        });

                        button.addEventListener('mouseleave', () => {
                                this.scheduleHoverPanelClose();
                        });

                        panel.addEventListener('mouseenter', () => {
                            window.clearTimeout(this.hoverCloseTimer);
                            this.hoverCloseTimer = null;
                                this.openHoverPanel();
                        });

                        panel.addEventListener('mouseleave', () => {
                                this.scheduleHoverPanelClose();
                        });

                        widget.appendChild(panel);
                        widget.appendChild(button);
                        this.getFloatingWidgetHost().appendChild(widget);

                        this.floatingWidget = widget;
                        this.floatingButton = button;
                        this.floatingPanel = panel;
                        this.syncFloatingWidgetHost();
                        this.renderHoverPanel(this.buildHoverSnapshot());
        },

        /**
         * Main autofill function
         */
        async performAutofill() {
            if (this.autofillPromise) {
                this.recordDebugEvent('autofill', 'skipped', {
                    reason: 'already-running'
                });
                return this.autofillPromise;
            }

            this.autofillPromise = this.runAutofill();

            try {
                return await this.autofillPromise;
            } finally {
                this.autofillPromise = null;
            }
        },

        async runAutofill() {
            this.filledFields = [];
            this.allowedFormKeys = null;
            this.resetDebugSession();

            // Reload user data in case it was updated
            await this.loadUserData();

            await this.loadSettings();

            if (!this.userData) {
                this.recordDebugEvent('autofill', 'error', {
                    reason: 'missing-user-data'
                });
                return {
                    success: false,
                    error: 'No saved data found. Please set up your profile first.'
                };
            }

            if (typeof Validation !== 'undefined') {
                const validation = Validation.validateUserData(this.userData);
                if (!validation.valid) {
                    this.recordDebugEvent('autofill', 'error', {
                        reason: validation.errors.join(', ')
                    });
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

                this.activeAutofillScopeRoot = this.getZipRecruiterApplyOverlay();
                this.syncFloatingWidgetHost();

                // Detect fields (after site autofill has potentially filled some)
                const detectionReport = FieldDetector.detectFields({
                    includeDiagnostics: true,
                    root: this.activeAutofillScopeRoot || document
                });
                const detectedFields = detectionReport.detectedFields;
                this.logDetectionReport(detectionReport, 'initial');

                this.allowedFormKeys = await this.getAllowedFormKeys(detectedFields);
                if (this.settings.confirmBeforeFill && this.allowedFormKeys && this.allowedFormKeys.size === 0) {
                    this.recordDebugEvent('autofill', 'skipped', {
                        reason: 'user-canceled-confirm-before-fill'
                    });
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

                // Resolve unmapped native selects/radios/checkboxes before broader custom-control scans.
                await this.fillAiChoiceFields();

                // Fill custom combobox controls used by Greenhouse and similar forms.
                await this.fillCustomComboboxFields();

                // Targeted pass for demographic/self-ID dropdowns with weak widget semantics.
                await this.fillTargetedStructuredDropdowns();

                // Fill Hispanic/Latino dropdowns specifically  
                this.fillHispanicLatinoSelects();

                this.fillRaceSelects();

                // Fill country/location dropdowns (United States, etc.)
                this.fillCountryLocationSelects();

                // Handle location autocomplete fields
                await this.handleLocationAutocomplete();

                // Some sites re-render fields after location or select interactions.
                const refreshedReport = FieldDetector.detectFields({
                    includeDiagnostics: true,
                    root: this.activeAutofillScopeRoot || document
                });
                const refreshedFields = refreshedReport.detectedFields;
                this.logDetectionReport(refreshedReport, 'refresh');
                this.fillTextFields(refreshedFields);
                this.fillSelectFields(refreshedFields);

                // Fill open-ended manual questions after structured fields are handled.
                await this.fillAiTextQuestions(refreshedFields);

                // Handle file upload (only if not already uploaded)
                await this.handleFileUpload();

                this.recordDebugEvent('autofill', 'filled', {
                    reason: `filled-${this.filledFields.length}-fields`
                });

                return {
                    success: true,
                    filledCount: this.filledFields.length,
                    message: `Successfully filled ${this.filledFields.length} fields`
                };
            } catch (error) {
                this.recordDebugEvent('autofill', 'error', {
                    reason: error.message || 'perform-autofill-failed'
                });
                console.error('Autofill error:', error);
                return {
                    success: false,
                    error: error.message || 'An error occurred during autofill'
                };
            } finally {
                this.activeAutofillScopeRoot = null;
                this.syncFloatingWidgetHost();
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
                preferredFirstName: this.parseFirstName(this.userData.fullName),
                firstName: this.parseFirstName(this.userData.fullName),
                lastName: this.parseLastName(this.userData.fullName),
                email: this.userData.email,
                phoneCountryCode: this.getDefaultPhoneCountryCode(),
                phone: this.userData.phone,
                linkedin: this.userData.linkedin,
                github: this.userData.github,
                website: this.userData.website,
                city: this.userData.city,
                state: this.userData.state,
                location: this.formatLocation(),
                pronouns: this.userData.pronouns,
                sexualOrientation: this.userData.sexualOrientation
            };

            for (const [fieldType, value] of Object.entries(fieldMappings)) {
                if (!value) {
                    this.recordDebugEvent('text-mapping', 'skipped', {
                        fieldType,
                        reason: 'missing-profile-value',
                        source: 'profile'
                    });
                    continue;
                }

                if (!detectedFields[fieldType]) {
                    this.recordDebugEvent('text-mapping', 'skipped', {
                        fieldType,
                        reason: 'field-type-not-detected',
                        source: 'profile'
                    });
                    continue;
                }

                for (const input of detectedFields[fieldType]) {
                    if (FieldDetector.isCustomComboboxInput(input)) {
                        this.recordDebugEvent('text-mapping', 'skipped', {
                            fieldType,
                            element: input,
                            reason: 'custom-combobox-input',
                            source: 'profile'
                        });
                        continue;
                    }

                    if (this.shouldSkipLowConfidenceAutofill(input, {
                        fieldType,
                        source: 'profile',
                        stage: 'input'
                    })) {
                        continue;
                    }

                    // Special handling for city fields - check if they actually want city + state
                    let valueToFill = value;
                    if (fieldType === 'city') {
                        valueToFill = this.getCityFieldValue(input);
                    }

                    if (this.fillInput(input, valueToFill, { fieldType, source: 'profile' })) {
                        this.filledFields.push({ type: fieldType, element: input });
                        this.highlightField(input, true);
                    }
                }
            }

            // Also scan for any text inputs that might be asking for city+state combined
            this.fillCombinedLocationFields();
        },

        getParsedResumeSections() {
            if (!this.settings?.aiAssist?.useParsedResumeData || !this.parsedResumeData) {
                return null;
            }

            const structuredData = this.parsedResumeData.structuredData
                && typeof this.parsedResumeData.structuredData === 'object'
                && !Array.isArray(this.parsedResumeData.structuredData)
                ? this.parsedResumeData.structuredData
                : null;
            const sections = {
                resumeSummary: typeof this.parsedResumeData.resumeSummary === 'string'
                    ? this.parsedResumeData.resumeSummary.trim()
                    : '',
                skills: Array.isArray(this.parsedResumeData.skills)
                    ? this.parsedResumeData.skills.filter(Boolean)
                    : [],
                experienceHighlights: Array.isArray(this.parsedResumeData.experienceHighlights)
                    ? this.parsedResumeData.experienceHighlights.filter(Boolean)
                    : [],
                educationHighlights: Array.isArray(this.parsedResumeData.educationHighlights)
                    ? this.parsedResumeData.educationHighlights.filter(Boolean)
                    : [],
                certifications: Array.isArray(this.parsedResumeData.certifications)
                    ? this.parsedResumeData.certifications.filter(Boolean)
                    : [],
                projects: Array.isArray(this.parsedResumeData.projects)
                    ? this.parsedResumeData.projects.filter(Boolean)
                    : [],
                structuredData
            };

            const hasContent = Object.values(sections).some(value => {
                if (Array.isArray(value)) {
                    return value.length > 0;
                }

                if (value && typeof value === 'object') {
                    return Object.keys(value).length > 0;
                }

                return Boolean(value);
            });
            return hasContent ? sections : null;
        },

        buildResumeContextText() {
            const sections = this.getParsedResumeSections();
            if (!sections) {
                return '';
            }

            const structuredJson = sections.structuredData
                ? JSON.stringify(sections.structuredData, null, 2).slice(0, 30000)
                : '';

            return [
                sections.resumeSummary ? `Resume summary:\n${sections.resumeSummary}` : '',
                sections.skills.length ? `Skills:\n- ${sections.skills.join('\n- ')}` : '',
                sections.experienceHighlights.length ? `Experience highlights:\n- ${sections.experienceHighlights.join('\n- ')}` : '',
                sections.educationHighlights.length ? `Education highlights:\n- ${sections.educationHighlights.join('\n- ')}` : '',
                sections.certifications.length ? `Certifications:\n- ${sections.certifications.join('\n- ')}` : '',
                sections.projects.length ? `Projects:\n- ${sections.projects.join('\n- ')}` : '',
                structuredJson ? `Structured resume JSON:\n${structuredJson}` : ''
            ].filter(Boolean).join('\n\n');
        },

        getAiParsedResumePayload() {
            if (!this.settings?.aiAssist?.useParsedResumeData || !this.parsedResumeData?.structuredData) {
                return null;
            }

            return this.parsedResumeData.structuredData;
        },

        getParsedResumeWorkExperienceEntries() {
            const parsedResume = this.getAiParsedResumePayload();
            if (!parsedResume) {
                return [];
            }

            const workExperience = Array.isArray(parsedResume.workExperience)
                ? parsedResume.workExperience
                : Array.isArray(parsedResume.experience)
                    ? parsedResume.experience
                    : Array.isArray(parsedResume.employment)
                        ? parsedResume.employment
                        : [];

            return workExperience.filter(entry => entry && typeof entry === 'object');
        },

        parseResumeDateValue(rawValue, fallbackToNow = false) {
            if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
                return rawValue;
            }

            if (typeof rawValue !== 'string') {
                return fallbackToNow ? new Date() : null;
            }

            const value = rawValue.trim();
            if (!value) {
                return fallbackToNow ? new Date() : null;
            }

            const normalizedValue = this.normalizeText(value);
            if (fallbackToNow && (normalizedValue === 'present' || normalizedValue === 'current' || normalizedValue === 'now' || normalizedValue === 'today')) {
                return new Date();
            }

            const directTimestamp = Date.parse(value);
            if (!Number.isNaN(directTimestamp)) {
                return new Date(directTimestamp);
            }

            const yearMonthMatch = value.match(/^(\d{4})[-/](\d{1,2})$/);
            if (yearMonthMatch) {
                return new Date(Number(yearMonthMatch[1]), Math.max(0, Number(yearMonthMatch[2]) - 1), 1);
            }

            const monthYearMatch = value.match(/^(\d{1,2})[-/](\d{4})$/);
            if (monthYearMatch) {
                return new Date(Number(monthYearMatch[2]), Math.max(0, Number(monthYearMatch[1]) - 1), 1);
            }

            const yearOnlyMatch = value.match(/^(19|20)\d{2}$/);
            if (yearOnlyMatch) {
                return new Date(Number(value), 0, 1);
            }

            return fallbackToNow ? new Date() : null;
        },

        getResumeEntryDurationMonths(entry) {
            if (!entry || typeof entry !== 'object') {
                return 0;
            }

            const startDate = this.parseResumeDateValue(entry.startDate);
            const endDate = this.parseResumeDateValue(entry.endDate, entry.current === true);
            if (!startDate || !endDate) {
                return 0;
            }

            const elapsedMs = endDate.getTime() - startDate.getTime();
            if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
                return 0;
            }

            return Math.max(0, elapsedMs / (1000 * 60 * 60 * 24 * 30.4375));
        },

        getResumeEntrySearchText(entry) {
            if (!entry || typeof entry !== 'object') {
                return '';
            }

            return this.normalizeText([
                entry.title,
                entry.role,
                entry.position,
                entry.company,
                entry.organization,
                entry.employer,
                entry.summary,
                entry.description,
                ...(Array.isArray(entry.highlights) ? entry.highlights : []),
                ...(Array.isArray(entry.technologies) ? entry.technologies : [])
            ].filter(Boolean).join(' '));
        },

        getTotalResumeExperienceYears() {
            const entries = this.getParsedResumeWorkExperienceEntries();
            if (entries.length === 0) {
                return 0;
            }

            const months = entries.reduce((total, entry) => total + this.getResumeEntryDurationMonths(entry), 0);
            return Math.round((months / 12) * 10) / 10;
        },

        extractExperienceRequirement(payload = {}) {
            const combinedText = [
                payload.question,
                payload.fieldLabel,
                payload.helperText,
                payload.sectionContext
            ].filter(Boolean).join(' ');
            const normalized = this.normalizeText(combinedText);
            if (!normalized) {
                return null;
            }

            const minimumYearsMatch = normalized.match(/(?:at least|minimum of|minimum|over|more than)?\s*(\d+(?:\.\d+)?)\+?\s+years? of experience/);
            const minimumYears = minimumYearsMatch ? Number(minimumYearsMatch[1]) : null;
            const topics = this.extractResumeExperienceTopics(payload);

            if (minimumYears === null && topics.length === 0) {
                return null;
            }

            return {
                minimumYears,
                topics
            };
        },

        flattenResumeEvidenceStrings(value, collector = []) {
            if (typeof value === 'string') {
                const text = value.trim();
                if (text) {
                    collector.push(text);
                }
                return collector;
            }

            if (Array.isArray(value)) {
                value.forEach(item => this.flattenResumeEvidenceStrings(item, collector));
                return collector;
            }

            if (value && typeof value === 'object') {
                Object.values(value).forEach(item => this.flattenResumeEvidenceStrings(item, collector));
            }

            return collector;
        },

        getResumeEvidenceCorpus() {
            const snippets = [];
            const seen = new Set();
            const pushSnippet = value => {
                const text = typeof value === 'string' ? value.trim() : '';
                if (!text) {
                    return;
                }

                const normalized = this.normalizeText(text);
                if (!normalized || seen.has(normalized)) {
                    return;
                }

                seen.add(normalized);
                snippets.push(text);
            };

            const parsedResumeSections = this.getParsedResumeSections();
            if (parsedResumeSections) {
                pushSnippet(parsedResumeSections.resumeSummary);
                [
                    parsedResumeSections.skills,
                    parsedResumeSections.experienceHighlights,
                    parsedResumeSections.educationHighlights,
                    parsedResumeSections.certifications,
                    parsedResumeSections.projects
                ].forEach(section => {
                    if (Array.isArray(section)) {
                        section.forEach(pushSnippet);
                    }
                });
            }

            const parsedResume = this.getAiParsedResumePayload();
            if (parsedResume) {
                this.flattenResumeEvidenceStrings(parsedResume).forEach(pushSnippet);
            }

            return snippets;
        },

        extractResumeExperienceTopics(payload = {}) {
            const combinedText = [
                payload.question,
                payload.fieldLabel,
                payload.helperText,
                payload.sectionContext
            ].filter(Boolean).join(' ');
            const normalized = this.normalizeText(combinedText);
            if (!normalized) {
                return [];
            }

            const patterns = [
                /years? of experience in ([a-z0-9 +.#\/-]{2,80})/g,
                /years? of experience with ([a-z0-9 +.#\/-]{2,80})/g,
                /experience in ([a-z0-9 +.#\/-]{2,80})/g,
                /experience with ([a-z0-9 +.#\/-]{2,80})/g,
                /worked with ([a-z0-9 +.#\/-]{2,80})/g,
                /knowledge of ([a-z0-9 +.#\/-]{2,80})/g,
                /familiar with ([a-z0-9 +.#\/-]{2,80})/g,
                /proficient in ([a-z0-9 +.#\/-]{2,80})/g,
                /expertise in ([a-z0-9 +.#\/-]{2,80})/g,
                /skills? with ([a-z0-9 +.#\/-]{2,80})/g,
                /know how to use ([a-z0-9 +.#\/-]{2,80})/g,
                /using ([a-z0-9 +.#\/-]{2,80})/g
            ];

            const topics = new Set();
            const stopPhrases = [
                'for this role',
                'in this role',
                'professionally',
                'at work',
                'on the job',
                'in production'
            ];

            const addTopic = rawTopic => {
                let topic = this.normalizeText(rawTopic || '');
                if (!topic) {
                    return;
                }

                stopPhrases.forEach(phrase => {
                    const index = topic.indexOf(phrase);
                    if (index > 0) {
                        topic = topic.slice(0, index).trim();
                    }
                });

                topic = topic
                    .replace(/^(the|a|an)\s+/, '')
                    .replace(/\b(technology|technologies|tools|tool|framework|frameworks|platform|platforms)\b$/g, '')
                    .trim();

                if (!topic || topic.length < 2) {
                    return;
                }

                topic.split(/,|\//).map(part => part.trim()).filter(Boolean).forEach(part => {
                    if (part.length >= 2) {
                        topics.add(part);
                    }
                });

                if (!topic.includes(' and ')) {
                    topics.add(topic);
                    return;
                }

                const compoundSafePhrases = ['research and development', 'sales and marketing'];
                if (compoundSafePhrases.some(phrase => topic.includes(phrase))) {
                    topics.add(topic);
                    return;
                }

                topic.split(/\band\b/).map(part => part.trim()).filter(Boolean).forEach(part => {
                    if (part.length >= 2) {
                        topics.add(part);
                    }
                });
            };

            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(normalized)) !== null) {
                    addTopic(match[1]);
                }
            }

            return Array.from(topics);
        },

        getResumeTopicAliases(topic = '') {
            const normalizedTopic = this.normalizeText(topic);
            if (!normalizedTopic) {
                return [];
            }

            const aliases = new Set([normalizedTopic]);

            if (normalizedTopic === 'react' || normalizedTopic.includes('react js') || normalizedTopic.includes('reactjs')) {
                ['react', 'react js', 'reactjs', 'react native'].forEach(alias => aliases.add(alias));
            }

            if (
                normalizedTopic.includes('software development') ||
                normalizedTopic.includes('software engineering') ||
                normalizedTopic.includes('software developer') ||
                normalizedTopic.includes('software engineer')
            ) {
                [
                    'software development',
                    'software engineering',
                    'software developer',
                    'software engineer',
                    'developer',
                    'engineer',
                    'frontend',
                    'front end',
                    'backend',
                    'back end',
                    'full stack',
                    'fullstack',
                    'web development'
                ].forEach(alias => aliases.add(alias));
            }

            if (normalizedTopic.includes('react native')) {
                ['react native', 'react', 'react native app'].forEach(alias => aliases.add(alias));
            }

            if (normalizedTopic === 'ai' || normalizedTopic.includes('artificial intelligence') || normalizedTopic.includes('generative ai')) {
                ['ai', 'artificial intelligence', 'generative ai', 'genai', 'llm', 'llms', 'openai', 'machine learning', 'ml'].forEach(alias => aliases.add(alias));
            }

            if (normalizedTopic === 'ml') {
                ['ml', 'machine learning', 'ai', 'artificial intelligence'].forEach(alias => aliases.add(alias));
            }

            return Array.from(aliases);
        },

        findResumeEvidenceForTopics(topics = []) {
            if (!Array.isArray(topics) || topics.length === 0) {
                return [];
            }

            const corpus = this.getResumeEvidenceCorpus();
            if (corpus.length === 0) {
                return [];
            }

            const matches = [];
            const seen = new Set();

            for (const topic of topics) {
                const aliases = this.getResumeTopicAliases(topic);
                for (const snippet of corpus) {
                    const normalizedSnippet = this.normalizeText(snippet);
                    if (!normalizedSnippet) {
                        continue;
                    }

                    const matched = aliases.some(alias => normalizedSnippet.includes(alias));
                    if (!matched) {
                        continue;
                    }

                    const key = `${this.normalizeText(topic)}|${normalizedSnippet}`;
                    if (seen.has(key)) {
                        continue;
                    }

                    seen.add(key);
                    matches.push({
                        topic,
                        snippet: snippet.length > 220 ? `${snippet.slice(0, 217)}...` : snippet
                    });
                }
            }

            return matches.slice(0, 8);
        },

        getQuestionSpecificResumeEvidence(payload = {}) {
            const topics = this.extractResumeExperienceTopics(payload);
            if (topics.length === 0) {
                return null;
            }

            const matches = this.findResumeEvidenceForTopics(topics);
            if (matches.length === 0) {
                return null;
            }

            return {
                topics,
                matches
            };
        },

        getResumeExperienceAssessment(payload = {}) {
            const requirement = this.extractExperienceRequirement(payload);
            const evidence = this.getQuestionSpecificResumeEvidence(payload);
            const entries = this.getParsedResumeWorkExperienceEntries();
            const totalYears = this.getTotalResumeExperienceYears();

            if (!requirement && !evidence) {
                return null;
            }

            let relevantYears = 0;
            let matchedEntries = [];

            if (entries.length > 0 && requirement?.topics?.length) {
                matchedEntries = entries.filter(entry => {
                    const entryText = this.getResumeEntrySearchText(entry);
                    return requirement.topics.some(topic => this.getResumeTopicAliases(topic).some(alias => entryText.includes(alias)));
                });
                relevantYears = matchedEntries.reduce((total, entry) => total + this.getResumeEntryDurationMonths(entry), 0) / 12;
            }

            const roundedRelevantYears = Math.round(relevantYears * 10) / 10;
            const qualifies = requirement?.minimumYears !== null && requirement?.minimumYears !== undefined
                ? ((roundedRelevantYears > 0 ? roundedRelevantYears : totalYears) + 0.1 >= requirement.minimumYears && (roundedRelevantYears > 0 || totalYears > 0))
                : (evidence?.matches?.length || 0) > 0;

            return {
                minimumYears: requirement?.minimumYears ?? null,
                topics: requirement?.topics || evidence?.topics || [],
                relevantYears: roundedRelevantYears,
                totalYears,
                matchedEvidence: evidence?.matches || [],
                qualified: qualifies,
                matchedRoleCount: matchedEntries.length
            };
        },

        getParsedResumeEducationEntries() {
            const parsedResume = this.getAiParsedResumePayload();
            if (!parsedResume) {
                return [];
            }

            const education = Array.isArray(parsedResume.education)
                ? parsedResume.education
                : Array.isArray(parsedResume.educationHistory)
                    ? parsedResume.educationHistory
                    : [];

            return education.filter(entry => entry && typeof entry === 'object');
        },

        getPrimaryEducationEntry() {
            return this.getParsedResumeEducationEntries()[0] || null;
        },

        getEducationDegreeText(entry = null) {
            const educationEntry = entry || this.getPrimaryEducationEntry();
            if (!educationEntry) {
                return '';
            }

            return [educationEntry.degree, educationEntry.credential, educationEntry.fieldOfStudy]
                .filter(value => typeof value === 'string' && value.trim())
                .join(' ')
                .trim();
        },

        getEducationSchoolText(entry = null) {
            const educationEntry = entry || this.getPrimaryEducationEntry();
            if (!educationEntry) {
                return '';
            }

            return [educationEntry.institution, educationEntry.school, educationEntry.university]
                .find(value => typeof value === 'string' && value.trim())
                ?.trim() || '';
        },

        getEducationDegreeAliases(rawValue) {
            const normalizedValue = this.normalizeText(rawValue || '');
            if (!normalizedValue) {
                return [];
            }

            const aliases = new Set([normalizedValue]);
            const tokens = new Set(normalizedValue.split(' ').filter(Boolean));
            const hasToken = token => tokens.has(token);

            if (
                normalizedValue.includes('bachelor') ||
                normalizedValue.includes('bachelors') ||
                normalizedValue.includes('bachelor of science') ||
                normalizedValue.includes('bachelor of arts') ||
                normalizedValue.includes('bachelor science') ||
                normalizedValue.includes('bachelor arts') ||
                hasToken('bs') ||
                hasToken('ba') ||
                (hasToken('b') && (hasToken('s') || hasToken('a')))
            ) {
                [
                    'bachelor',
                    'bachelor degree',
                    'bachelor s degree',
                    'bachelor of science',
                    'bachelor of arts',
                    'bs',
                    'ba',
                    'b s',
                    'b a'
                ].forEach(alias => aliases.add(alias));
            }

            if (normalizedValue.includes('master') || normalizedValue.includes('mba') || normalizedValue.includes('m b a')) {
                ['master', 'master degree', 'master s degree', 'master of business administration', 'mba', 'm b a'].forEach(alias => aliases.add(alias));
            }

            if (normalizedValue.includes('associate')) {
                ['associate', 'associate s degree', 'associate degree'].forEach(alias => aliases.add(alias));
            }

            if (normalizedValue.includes('doctor') || normalizedValue.includes('phd') || normalizedValue.includes('ph d')) {
                ['doctorate', 'doctoral', 'doctor of philosophy', 'phd', 'ph d'].forEach(alias => aliases.add(alias));
            }

            return Array.from(aliases);
        },

        getEducationDegreeCategory(rawValue) {
            const normalizedValue = this.normalizeText(rawValue || '');
            if (!normalizedValue) {
                return '';
            }

            const tokens = new Set(normalizedValue.split(' ').filter(Boolean));
            const hasToken = token => tokens.has(token);

            if (normalizedValue.includes('associate')) return 'associate';
            if (
                normalizedValue.includes('bachelor') ||
                normalizedValue.includes('bachelors') ||
                normalizedValue.includes('bachelor of science') ||
                normalizedValue.includes('bachelor of arts') ||
                normalizedValue.includes('bachelor science') ||
                normalizedValue.includes('bachelor arts') ||
                hasToken('bs') ||
                hasToken('ba') ||
                (hasToken('b') && (hasToken('s') || hasToken('a')))
            ) return 'bachelor';
            if (normalizedValue.includes('master') || normalizedValue.includes('mba')) return 'master';
            if (normalizedValue.includes('doctor') || normalizedValue.includes('phd') || normalizedValue.includes('ph d') || normalizedValue.includes('juris doctor') || normalizedValue.includes('m d')) return 'doctorate';
            if (normalizedValue.includes('engineer')) return 'engineer';
            return '';
        },

        inferEducationChoiceFieldType(...values) {
            const optionTexts = values
                .flatMap(value => Array.isArray(value) ? value : [value])
                .map(value => typeof value === 'string' ? value : value?.text || '')
                .filter(Boolean);
            const normalizedText = this.normalizeText(optionTexts.join(' '));
            if (!normalizedText) {
                return null;
            }

            const hasDegreeKeyword = EDUCATION_DEGREE_KEYWORDS.some(keyword => normalizedText.includes(keyword));
            const hasSchoolKeyword = EDUCATION_SCHOOL_KEYWORDS.some(keyword => normalizedText.includes(keyword));
            const hasDegreeOptions = optionTexts.some(text => {
                const normalizedOption = this.normalizeText(text);
                return ['associate', 'bachelor', 'master', 'doctor', 'mba', 'phd', 'degree'].some(token => normalizedOption.includes(token));
            });
            const hasSchoolOptions = optionTexts.some(text => {
                const normalizedOption = this.normalizeText(text);
                return ['university', 'college', 'school', 'institute', 'academy'].some(token => normalizedOption.includes(token));
            });

            if (hasDegreeKeyword || hasDegreeOptions) {
                return 'educationDegree';
            }

            if (hasSchoolKeyword || hasSchoolOptions) {
                return 'educationSchool';
            }

            return null;
        },

        findOtherChoiceOption(options) {
            if (!Array.isArray(options) || options.length === 0) {
                return null;
            }

            return options.find(option => {
                const normalizedText = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                return normalizedText === 'other' || normalizedText.startsWith('other ');
            }) || null;
        },

        findStrictOtherChoiceOption(options) {
            if (!Array.isArray(options) || options.length === 0) {
                return null;
            }

            return options.find(option => {
                const normalizedText = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                return normalizedText === 'other';
            }) || null;
        },

        findEducationDegreeOption(options) {
            const degreeText = this.getEducationDegreeText();
            const aliases = this.getEducationDegreeAliases(degreeText);
            const degreeCategory = this.getEducationDegreeCategory(degreeText);

            if (!Array.isArray(options) || options.length === 0 || aliases.length === 0) {
                return null;
            }

            let bestMatch = null;
            let bestScore = -1;

            for (const option of options) {
                const normalizedOption = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                if (!normalizedOption) {
                    continue;
                }

                let score = 0;
                const optionCategory = this.getEducationDegreeCategory(normalizedOption);
                if (degreeCategory) {
                    if (!optionCategory) {
                        score -= 20;
                    } else if (optionCategory === degreeCategory) {
                        score += 140;
                    } else {
                        score -= 220;
                    }
                }

                aliases.forEach(alias => {
                    if (normalizedOption === alias) {
                        score += 100;
                    } else if (normalizedOption.includes(alias) || alias.includes(normalizedOption)) {
                        score += 55;
                    }
                });

                const aliasTokens = new Set(aliases.flatMap(alias => alias.split(' ').filter(Boolean)));
                normalizedOption.split(' ').filter(Boolean).forEach(token => {
                    if (aliasTokens.has(token)) {
                        score += 6;
                    }
                });

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = option;
                }
            }

            return bestScore >= 40 ? bestMatch : null;
        },

        findEducationSchoolOption(options) {
            const schoolText = this.getEducationSchoolText();
            const normalizedSchool = this.normalizeText(schoolText);

            if (!Array.isArray(options) || options.length === 0 || !normalizedSchool) {
                return null;
            }

            let bestMatch = null;
            let bestScore = -1;

            for (const option of options) {
                const normalizedOption = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                if (!normalizedOption) {
                    continue;
                }

                let score = 0;
                if (normalizedOption === normalizedSchool) {
                    score += 160;
                }

                if (normalizedOption.includes(normalizedSchool) || normalizedSchool.includes(normalizedOption)) {
                    score += 90;
                }

                const schoolTokens = new Set(normalizedSchool.split(' ').filter(token => token.length >= 3));
                normalizedOption.split(' ').filter(Boolean).forEach(token => {
                    if (schoolTokens.has(token)) {
                        score += 8;
                    }
                });

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = option;
                }
            }

            return bestScore >= 24 ? bestMatch : null;
        },

        findEducationChoiceOption(options, fieldType) {
            if (fieldType === 'educationDegree') {
                return this.findEducationDegreeOption(options);
            }

            if (fieldType === 'educationSchool') {
                return this.findEducationSchoolOption(options) || this.findOtherChoiceOption(options);
            }

            return null;
        },

        computeAiAnswerCacheKey(payload) {
            const normalizedPayload = {
                question: this.coerceTextValue(payload?.question).trim(),
                fieldLabel: this.coerceTextValue(payload?.fieldLabel).trim(),
                helperText: this.coerceTextValue(payload?.helperText).trim(),
                sectionContext: this.coerceTextValue(payload?.sectionContext).trim(),
                detectedFieldType: this.coerceTextValue(payload?.detectedFieldType).trim(),
                preferredProfileAnswer: this.coerceTextValue(payload?.preferredProfileAnswer).trim(),
                fieldHtmlType: this.coerceTextValue(payload?.fieldHtmlType).trim(),
                pageTitle: this.coerceTextValue(payload?.pageTitle).trim(),
                jobPostingText: this.coerceTextValue(payload?.jobPostingText).trim(),
                resumeContext: this.coerceTextValue(payload?.resumeContext).trim(),
                relevantProfileContext: payload?.relevantProfileContext || {},
                choiceOptions: Array.isArray(payload?.choiceOptions)
                    ? payload.choiceOptions.map(option => this.coerceTextValue(option).trim()).filter(Boolean)
                    : [],
                parsedResumeData: payload?.parsedResumeData || null,
                userProfile: payload?.userProfile || {}
            };
            const serialized = JSON.stringify(normalizedPayload);
            let hash = 0;

            for (let index = 0; index < serialized.length; index += 1) {
                hash = ((hash << 5) - hash + serialized.charCodeAt(index)) | 0;
            }

            return `ai:${(hash >>> 0).toString(16)}:${serialized.length}`;
        },

        getCachedAiAnswer(cacheKey) {
            if (!cacheKey) {
                return null;
            }

            const sessionEntry = this.sessionAnswerCache.get(cacheKey);
            if (sessionEntry) {
                const sanitizedSessionEntry = this.sanitizeAiCacheEntry(sessionEntry);
                if (sanitizedSessionEntry) {
                    if (sanitizedSessionEntry.answer !== sessionEntry.answer) {
                        this.sessionAnswerCache.set(cacheKey, sanitizedSessionEntry);
                    }

                    return {
                        ...sanitizedSessionEntry,
                        cacheSource: 'session'
                    };
                }
            }

            const persistentEntry = this.aiAnswerCache?.[cacheKey];
            if (persistentEntry) {
                const sanitizedPersistentEntry = this.sanitizeAiCacheEntry(persistentEntry);
                if (sanitizedPersistentEntry) {
                    this.sessionAnswerCache.set(cacheKey, sanitizedPersistentEntry);
                    return {
                        ...sanitizedPersistentEntry,
                        cacheSource: 'persistent'
                    };
                }
            }

            return null;
        },

        async persistAiAnswer(cacheKey, payload, answer) {
            const sanitizedAnswer = this.coerceTextValue(answer).trim();
            if (!cacheKey || !sanitizedAnswer) {
                return;
            }

            const entry = {
                answer: sanitizedAnswer,
                question: this.coerceTextValue(payload?.question).trim(),
                fieldLabel: this.coerceTextValue(payload?.fieldLabel).trim(),
                fieldHtmlType: this.coerceTextValue(payload?.fieldHtmlType).trim(),
                updatedAt: new Date().toISOString()
            };

            this.sessionAnswerCache.set(cacheKey, entry);

            if (!this.settings?.aiAssist?.cacheAnswers || typeof Storage?.setAiAnswerCacheEntry !== 'function') {
                return;
            }

            await Storage.setAiAnswerCacheEntry(cacheKey, entry);
            this.aiAnswerCache = {
                ...(this.aiAnswerCache || {}),
                [cacheKey]: entry
            };
        },

        async requestAiAnswer(payload, debugMeta = {}) {
            const enrichedPayload = this.enrichAiPayload(payload);
            const cacheKey = this.computeAiAnswerCacheKey(enrichedPayload);
            const cachedEntry = this.getCachedAiAnswer(cacheKey);

            if (cachedEntry) {
                this.recordDebugEvent('ai-answer-cache', 'filled', {
                    fieldType: debugMeta.fieldType || '',
                    element: debugMeta.element,
                    reason: `${cachedEntry.cacheSource}-cache-hit`,
                    source: 'ai-cache',
                    value: cachedEntry.answer.slice(0, 160)
                });

                return {
                    success: true,
                    answer: cachedEntry.answer,
                    model: cachedEntry.model || '',
                    cacheSource: cachedEntry.cacheSource
                };
            }

            if (!this.settings?.aiAssist?.enabled) {
                return {
                    success: false,
                    error: 'AI assistance is disabled in settings.'
                };
            }

            if (!this.settings?.aiAssist?.apiKey) {
                return {
                    success: false,
                    error: 'Missing Mistral API key. Add it in Settings > AI Assistance.'
                };
            }

            const response = this.sanitizeAiAnswerResponse(await this.sendSingleAiAnswerRequest(enrichedPayload));

            if (response?.success && response.answer) {
                await this.persistAiAnswer(cacheKey, enrichedPayload, response.answer);
            }

            return response;
        },

        enrichAiPayload(payload) {
            const inferredFieldType = payload?.detectedFieldType || this.inferStructuredChoiceFieldType(
                payload?.question,
                payload?.fieldLabel,
                payload?.helperText,
                payload?.sectionContext
            ) || '';

            return {
                ...payload,
                userProfile: payload?.userProfile || this.buildAiUserProfile(),
                relevantProfileContext: payload?.relevantProfileContext || this.buildRelevantProfileContext(inferredFieldType, payload),
                parsedResumeData: payload?.parsedResumeData || this.getAiParsedResumePayload(),
                resumeContext: typeof payload?.resumeContext === 'string'
                    ? payload.resumeContext.trim()
                    : this.buildResumeContextText()
            };
        },

        async sendSingleAiAnswerRequest(enrichedPayload) {
            return await chrome.runtime.sendMessage({
                action: 'generateAiAnswer',
                payload: enrichedPayload
            });
        },

        computeAiBatchGroupKey(payload) {
            const normalizedPayload = {
                question: this.normalizeText(payload?.question || ''),
                fieldLabel: this.normalizeText(payload?.fieldLabel || ''),
                helperText: this.normalizeText(payload?.helperText || ''),
                sectionContext: this.normalizeText(payload?.sectionContext || ''),
                detectedFieldType: this.normalizeText(payload?.detectedFieldType || ''),
                preferredProfileAnswer: this.normalizeText(payload?.preferredProfileAnswer || ''),
                fieldHtmlType: this.normalizeText(payload?.fieldHtmlType || ''),
                pageTitle: this.normalizeText(payload?.pageTitle || ''),
                choiceOptions: Array.isArray(payload?.choiceOptions)
                    ? payload.choiceOptions.map(option => this.normalizeText(option)).filter(Boolean)
                    : []
            };

            return JSON.stringify(normalizedPayload);
        },

        groupAiCandidates(candidates, buildDescriptor) {
            const groups = new Map();

            for (const candidate of candidates) {
                const descriptor = buildDescriptor(candidate);
                if (!descriptor?.payload?.question) {
                    continue;
                }

                const key = this.computeAiBatchGroupKey(descriptor.payload);
                const existingGroup = groups.get(key);

                if (existingGroup) {
                    existingGroup.targets.push(candidate);
                    continue;
                }

                groups.set(key, {
                    key,
                    payload: descriptor.payload,
                    debugMeta: descriptor.debugMeta || {},
                    targets: [candidate]
                });
            }

            return Array.from(groups.values());
        },

        chunkArray(items, chunkSize) {
            const normalizedSize = Math.max(1, Number(chunkSize) || 1);
            const chunks = [];

            for (let index = 0; index < items.length; index += normalizedSize) {
                chunks.push(items.slice(index, index + normalizedSize));
            }

            return chunks;
        },

        async requestAiAnswersBatch(entries) {
            if (!Array.isArray(entries) || entries.length === 0) {
                return [];
            }

            if (!this.settings?.aiAssist?.enabled) {
                return entries.map(() => ({
                    success: false,
                    error: 'AI assistance is disabled in settings.'
                }));
            }

            if (!this.settings?.aiAssist?.apiKey) {
                return entries.map(() => ({
                    success: false,
                    error: 'Missing Mistral API key. Add it in Settings > AI Assistance.'
                }));
            }

            const results = Array(entries.length).fill(null);
            const uncachedEntries = [];

            entries.forEach((entry, index) => {
                const enrichedPayload = this.enrichAiPayload(entry.payload);
                const cacheKey = this.computeAiAnswerCacheKey(enrichedPayload);
                const cachedEntry = this.getCachedAiAnswer(cacheKey);

                if (cachedEntry) {
                    this.recordDebugEvent('ai-answer-cache', 'filled', {
                        fieldType: entry.debugMeta?.fieldType || '',
                        element: entry.debugMeta?.element,
                        reason: `${cachedEntry.cacheSource}-cache-hit`,
                        source: 'ai-cache',
                        value: cachedEntry.answer.slice(0, 160)
                    });

                    results[index] = {
                        success: true,
                        answer: cachedEntry.answer,
                        model: cachedEntry.model || '',
                        cacheSource: cachedEntry.cacheSource
                    };
                    return;
                }

                uncachedEntries.push({
                    ...entry,
                    index,
                    enrichedPayload,
                    cacheKey
                });
            });

            const batches = this.chunkArray(uncachedEntries, 4);

            for (const batchEntries of batches) {
                if (batchEntries.length === 0) {
                    continue;
                }

                let batchResponse = null;

                if (batchEntries.length > 1) {
                    this.recordDebugEvent('ai-answer-batch', 'filled', {
                        reason: `requested-${batchEntries.length}-answers`,
                        source: 'ai'
                    });

                    batchResponse = await chrome.runtime.sendMessage({
                        action: 'generateAiAnswerBatch',
                        payloads: batchEntries.map(entry => entry.enrichedPayload)
                    });
                }

                const hasBatchAnswers = batchResponse?.success && Array.isArray(batchResponse.answers);

                for (let batchIndex = 0; batchIndex < batchEntries.length; batchIndex += 1) {
                    const entry = batchEntries[batchIndex];
                    let response = this.sanitizeAiAnswerResponse(hasBatchAnswers
                        ? (batchResponse.answers[batchIndex] || { success: false, error: 'Missing batch answer' })
                        : await this.sendSingleAiAnswerRequest(entry.enrichedPayload));

                    if (hasBatchAnswers && (!response?.success || !response.answer)) {
                        response = this.sanitizeAiAnswerResponse(await this.sendSingleAiAnswerRequest(entry.enrichedPayload));
                    }

                    if (response?.success && response.answer) {
                        await this.persistAiAnswer(entry.cacheKey, entry.enrichedPayload, response.answer);
                    }

                    results[entry.index] = response;
                }
            }

            return results.map(result => result || ({ success: false, error: 'No AI answer result returned.' }));
        },

        async fillAiTextQuestions(detectedFields) {
            const aiSettings = this.settings?.aiAssist;
            if (!aiSettings?.enabled) {
                return;
            }

            const candidates = this.findAiQuestionCandidates(detectedFields);
            if (candidates.length === 0) {
                return;
            }

            console.log(`[JobAutofill] Found ${candidates.length} AI text question candidates`);

            const jobPostingText = this.extractJobPostingText();
            const pageTitle = document.title || '';

            const groups = this.groupAiCandidates(candidates, candidate => ({
                payload: {
                    question: candidate.question,
                    fieldLabel: candidate.label,
                    helperText: candidate.helperText,
                    sectionContext: candidate.sectionContext,
                    fieldHtmlType: candidate.input instanceof HTMLTextAreaElement ? 'textarea' : 'text',
                    pageTitle,
                    jobPostingText
                },
                debugMeta: {
                    fieldType: 'aiTextQuestion',
                    element: candidate.input
                }
            }));
            const limit = Math.max(1, Math.min(aiSettings.maxQuestionsPerRun || 10, groups.length));
            const selectedGroups = groups.slice(0, limit);
            const responses = await this.requestAiAnswersBatch(selectedGroups.map(group => ({
                payload: group.payload,
                debugMeta: group.debugMeta
            })));

            for (let index = 0; index < selectedGroups.length; index += 1) {
                const group = selectedGroups[index];
                const response = responses[index];
                try {
                    if (!response?.success || !response.answer) {
                        continue;
                    }

                    for (const candidate of group.targets) {
                        if (this.fillInput(candidate.input, response.answer, {
                            fieldType: 'aiTextQuestion',
                            source: 'ai'
                        })) {
                            this.filledFields.push({ type: 'aiTextQuestion', element: candidate.input });
                            this.highlightField(candidate.input, true);
                        }
                    }
                } catch (error) {
                    console.warn('[JobAutofill] AI answer generation failed:', error);
                }
            }
        },

        buildAiUserProfile() {
            const profile = {
                fullName: this.userData?.fullName || '',
                firstName: this.parseFirstName(this.userData?.fullName || ''),
                email: this.userData?.email || '',
                phone: this.userData?.phone || '',
                phoneCountryCode: this.getDefaultPhoneCountryCode(),
                linkedin: this.userData?.linkedin || '',
                github: this.userData?.github || '',
                website: this.userData?.website || '',
                city: this.userData?.city || '',
                state: this.userData?.state || '',
                location: this.formatLocation(),
                workAuthorization: this.userData?.workAuth || '',
                sponsorship: this.userData?.sponsorship || '',
                onsiteComfort: this.userData?.onsiteComfort || '',
                relocationWillingness: this.userData?.relocationWillingness || '',
                internshipStatus: this.userData?.internshipStatus || '',
                startAvailability: this.userData?.startAvailability || '',
                over18: this.userData?.over18 || '',
                formerEmployee: this.userData?.formerEmployee || '',
                transgender: this.userData?.transgender || '',
                sexualOrientation: this.userData?.sexualOrientation || '',
                pronouns: this.userData?.pronouns || '',
                gender: this.userData?.gender || '',
                race: this.userData?.race || '',
                hispanicLatino: this.userData?.hispanicLatino || '',
                veteran: this.userData?.veteran || '',
                disability: this.userData?.disability || '',
                totalResumeExperienceYears: this.getTotalResumeExperienceYears()
            };
            const parsedResumeSections = this.getParsedResumeSections();

            if (parsedResumeSections) {
                profile.resumeSummary = parsedResumeSections.resumeSummary;
                profile.skills = parsedResumeSections.skills;
                profile.experienceHighlights = parsedResumeSections.experienceHighlights;
                profile.educationHighlights = parsedResumeSections.educationHighlights;
                profile.certifications = parsedResumeSections.certifications;
                profile.projects = parsedResumeSections.projects;
                profile.structuredResumeAvailable = Boolean(parsedResumeSections.structuredData);
            }

            const primaryEducation = this.getPrimaryEducationEntry();
            if (primaryEducation) {
                profile.primaryEducation = {
                    institution: this.getEducationSchoolText(primaryEducation),
                    degree: this.getEducationDegreeText(primaryEducation),
                    fieldOfStudy: primaryEducation.fieldOfStudy || '',
                    startDate: primaryEducation.startDate || '',
                    endDate: primaryEducation.endDate || ''
                };
            }

            return profile;
        },

        buildRelevantProfileContext(fieldType = '', payload = {}) {
            const profile = this.buildAiUserProfile();
            const normalizedFieldType = String(fieldType || '').trim();
            const relevant = {};
            const parsedResumeSections = this.getParsedResumeSections();

            const assign = (key, value) => {
                if (value === null || typeof value === 'undefined') {
                    return;
                }

                if (typeof value === 'string' && !value.trim()) {
                    return;
                }

                if (Array.isArray(value) && value.length === 0) {
                    return;
                }

                relevant[key] = value;
            };

            const addResumeFacts = () => {
                if (!parsedResumeSections) {
                    return;
                }

                assign('resumeSummary', parsedResumeSections.resumeSummary);
                assign('resumeSkills', Array.isArray(parsedResumeSections.skills) ? parsedResumeSections.skills.slice(0, 12) : []);
                assign('experienceHighlights', Array.isArray(parsedResumeSections.experienceHighlights) ? parsedResumeSections.experienceHighlights.slice(0, 8) : []);
                assign('educationHighlights', Array.isArray(parsedResumeSections.educationHighlights) ? parsedResumeSections.educationHighlights.slice(0, 6) : []);
                assign('certifications', Array.isArray(parsedResumeSections.certifications) ? parsedResumeSections.certifications.slice(0, 6) : []);
                assign('projects', Array.isArray(parsedResumeSections.projects) ? parsedResumeSections.projects.slice(0, 6) : []);
            };

            const addQuestionSpecificResumeFacts = () => {
                const evidence = this.getQuestionSpecificResumeEvidence(payload);
                if (!evidence) {
                    return;
                }

                assign('resumeMatchedTopics', evidence.topics);
                assign('resumeMatchedEvidence', evidence.matches.map(match => `${match.topic}: ${match.snippet}`));
            };

            const addResumeExperienceAssessment = () => {
                const assessment = this.getResumeExperienceAssessment(payload);
                if (!assessment) {
                    return;
                }

                assign('resumeExperienceAssessment', assessment);
            };

            const addSharedJobFacts = () => {
                assign('location', profile.location);
                assign('city', profile.city);
                assign('state', profile.state);
                assign('workAuthorization', profile.workAuthorization);
                assign('sponsorship', profile.sponsorship);
                assign('onsiteComfort', profile.onsiteComfort);
                assign('relocationWillingness', profile.relocationWillingness);
                assign('internshipStatus', profile.internshipStatus);
                assign('startAvailability', profile.startAvailability);
                assign('over18', profile.over18);
                assign('formerEmployee', profile.formerEmployee);
            };

            switch (normalizedFieldType) {
                case 'gender':
                    assign('gender', profile.gender);
                    assign('transgender', profile.transgender);
                    assign('pronouns', profile.pronouns);
                    break;
                case 'transgender':
                    assign('transgender', profile.transgender);
                    assign('gender', profile.gender);
                    break;
                case 'sexualOrientation':
                    assign('sexualOrientation', this.getStructuredChoiceValues('sexualOrientation', profile.sexualOrientation));
                    break;
                case 'pronouns':
                    assign('pronouns', profile.pronouns);
                    assign('gender', profile.gender);
                    break;
                case 'hispanicLatino':
                    assign('hispanicLatino', profile.hispanicLatino);
                    assign('race', profile.race);
                    break;
                case 'race':
                    assign('race', profile.race);
                    assign('hispanicLatino', profile.hispanicLatino);
                    break;
                case 'veteran':
                    assign('veteran', profile.veteran);
                    break;
                case 'disability':
                    assign('disability', profile.disability);
                    break;
                case 'workAuth':
                case 'sponsorship':
                case 'onsiteComfort':
                case 'relocationWillingness':
                case 'startAvailability':
                case 'internshipStatus':
                    addSharedJobFacts();
                    break;
                case 'over18':
                    assign('over18', profile.over18);
                    break;
                case 'formerEmployee':
                    assign('formerEmployee', profile.formerEmployee);
                    break;
                case 'city':
                case 'location':
                    assign('location', profile.location);
                    assign('city', profile.city);
                    assign('state', profile.state);
                    break;
                case 'educationDegree':
                    assign('primaryEducation', profile.primaryEducation);
                    assign('educationHighlights', profile.educationHighlights);
                    break;
                case 'educationSchool':
                    assign('primaryEducation', profile.primaryEducation);
                    assign('educationHighlights', profile.educationHighlights);
                    break;
                case 'phoneCountryCode':
                    assign('phoneCountryCode', profile.phoneCountryCode);
                    assign('location', profile.location);
                    break;
                default:
                    addSharedJobFacts();
                    addResumeFacts();
                    addQuestionSpecificResumeFacts();
                    addResumeExperienceAssessment();
                    assign('gender', profile.gender);
                    assign('transgender', profile.transgender);
                    assign('sexualOrientation', this.getStructuredChoiceValues('sexualOrientation', profile.sexualOrientation));
                    assign('pronouns', profile.pronouns);
                    assign('hispanicLatino', profile.hispanicLatino);
                    assign('race', profile.race);
                    assign('veteran', profile.veteran);
                    assign('disability', profile.disability);
                    break;
            }

            return Object.keys(relevant).length > 0
                ? relevant
                : (payload?.userProfile || profile);
        },

        getStructuredChoiceFieldMappings() {
            return {
                phoneCountryCode: { value: 'us', patterns: FieldDetector.patterns.phoneCountryCode?.options || {} },
                workAuth: { value: this.userData?.workAuth, patterns: FieldDetector.patterns.workAuth?.options || {} },
                sponsorship: { value: this.userData?.sponsorship, patterns: FieldDetector.patterns.sponsorship?.options || {} },
                gender: { value: this.userData?.gender, patterns: FieldDetector.patterns.gender?.options || {} },
                transgender: { value: this.userData?.transgender, patterns: FieldDetector.patterns.transgender?.options || {} },
                sexualOrientation: { value: this.userData?.sexualOrientation, patterns: FieldDetector.patterns.sexualOrientation?.options || {} },
                pronouns: { value: this.userData?.pronouns, patterns: FieldDetector.patterns.pronouns?.options || {} },
                hispanicLatino: { value: this.userData?.hispanicLatino || 'no', patterns: FieldDetector.patterns.hispanicLatino?.options || {} },
                race: { value: this.userData?.race, patterns: FieldDetector.patterns.race?.options || {} },
                veteran: { value: this.userData?.veteran, patterns: FieldDetector.patterns.veteran?.options || {} },
                disability: { value: this.userData?.disability, patterns: FieldDetector.patterns.disability?.options || {} },
                startAvailability: { value: this.userData?.startAvailability, patterns: FieldDetector.patterns.startAvailability?.options || {} },
                onsiteComfort: { value: this.userData?.onsiteComfort, patterns: FieldDetector.patterns.onsiteComfort?.options || {} },
                relocationWillingness: { value: this.userData?.relocationWillingness, patterns: FieldDetector.patterns.relocationWillingness?.options || {} },
                internshipStatus: { value: this.userData?.internshipStatus, patterns: FieldDetector.patterns.internshipStatus?.options || {} },
                over18: { value: this.userData?.over18, patterns: FieldDetector.patterns.over18?.options || {} },
                formerEmployee: { value: this.userData?.formerEmployee, patterns: FieldDetector.patterns.formerEmployee?.options || {} }
            };
        },

        getStructuredChoiceConfig(fieldType) {
            return this.getStructuredChoiceFieldMappings()[fieldType] || null;
        },

        isStrictStructuredChoiceField(fieldType) {
            return Boolean(fieldType && this.getStructuredChoiceConfig(fieldType));
        },

        isStructuredChoiceSelectionSatisfied(control, fieldType) {
            if (!this.isStrictStructuredChoiceField(fieldType)) {
                return false;
            }

            const preferredProfileAnswer = this.getPreferredProfileAnswer(fieldType);
            if (!preferredProfileAnswer) {
                return false;
            }

            const root = this.resolveCustomComboboxControl(control) || control;
            const visibleValue = root.querySelector('.select__single-value, [class*="single-value"], [class*="valueContainer"] [class*="single"], [data-value]')?.textContent?.trim() || '';
            const hiddenValues = Array.from(root.querySelectorAll('input[type="hidden"]'))
                .map(input => input.value?.trim() || '')
                .filter(Boolean);
            const currentValues = [
                visibleValue,
                this.getCustomComboboxSelectedValue(root),
                ...hiddenValues,
                this.getCustomComboboxSelectionText(root)
            ].filter(Boolean);

            if (currentValues.length === 0) {
                return false;
            }

            const patterns = FieldDetector.patterns[fieldType]?.options || {};
            return currentValues.some(value => {
                const matched = this.findStructuredChoiceOption([{ text: value, element: root }], fieldType, preferredProfileAnswer, patterns);
                return Boolean(matched);
            });
        },

        shouldFillCustomCombobox(control, fieldTypeOverride = null) {
            const fieldType = fieldTypeOverride || this.identifyCustomChoiceFieldType(control);
            if (this.isStrictStructuredChoiceField(fieldType)) {
                return !this.isStructuredChoiceSelectionSatisfied(control, fieldType);
            }

            return this.isCustomComboboxUnanswered(control);
        },

        getTargetedStructuredFieldTypes() {
            return ['gender', 'hispanicLatino', 'race', 'veteran', 'disability', 'phoneCountryCode'];
        },

        getTargetedDropdownPauseMs(fieldType) {
            if (fieldType === 'hispanicLatino') {
                return 550;
            }

            if (fieldType === 'race') {
                return 260;
            }

            return 180;
        },

        async waitForDependentStructuredDropdown(fieldType, sourceControl = null) {
            const config = this.getStructuredChoiceConfig(fieldType);
            if (!config?.value) {
                return;
            }

            await this.waitForVisibleElements(() => {
                const likelyControls = this.getLikelyStructuredDropdownControls(fieldType);
                if (likelyControls.length > 0) {
                    return likelyControls;
                }

                if (sourceControl) {
                    return this.getDependentStructuredDropdownControls(sourceControl, fieldType);
                }

                return [];
            }, {
                timeoutMs: 1200,
                intervalMs: 120
            });
        },

        getDependentStructuredDropdownControls(sourceControl, fieldType) {
            if (!sourceControl || !fieldType) {
                return [];
            }

            const controls = this.sortElementsTopToBottom(this.getCustomComboboxElements());
            const sourceResolvedControl = this.resolveCustomComboboxControl(sourceControl) || sourceControl;
            const sourceContextRoot = this.getCustomComboboxContextRoot(sourceResolvedControl);
            const sourceSection = sourceContextRoot?.parentElement || sourceContextRoot;
            const sourceRect = sourceResolvedControl.getBoundingClientRect();
            const rankedControls = [];

            for (const control of controls) {
                const resolvedControl = this.resolveCustomComboboxControl(control) || control;
                if (resolvedControl === sourceResolvedControl) {
                    continue;
                }

                if (!this.isElementAllowed(resolvedControl) || resolvedControl.disabled) {
                    continue;
                }

                const relation = sourceResolvedControl.compareDocumentPosition(resolvedControl);
                if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) {
                    continue;
                }

                const root = this.getCustomComboboxContextRoot(resolvedControl);
                const rect = resolvedControl.getBoundingClientRect();
                const verticalDelta = rect.top - sourceRect.top;
                if (verticalDelta < -20 || verticalDelta > 900) {
                    continue;
                }

                const detectedFieldTypes = this.getCustomComboboxDetectedFieldTypes(resolvedControl);
                const inferredFieldType = this.identifyCustomChoiceFieldType(resolvedControl);
                const relatedInput = resolvedControl.matches('input')
                    ? resolvedControl
                    : root?.querySelector('input[type="text"], input[type="search"], input[role="combobox"], input[aria-autocomplete="list"], input[type="hidden"], input[name], input[id]');
                const contextText = this.normalizeText(root?.textContent?.slice(0, 800) || '');
                const idNameText = this.normalizeText([
                    resolvedControl.getAttribute('id') || '',
                    resolvedControl.getAttribute('name') || '',
                    relatedInput?.getAttribute?.('id') || '',
                    relatedInput?.getAttribute?.('name') || ''
                ].join(' '));
                let score = 0;

                if (root && (root === sourceSection || sourceSection?.contains(root))) {
                    score += 35;
                }

                if (inferredFieldType === fieldType) {
                    score += 150;
                }

                if (detectedFieldTypes.includes(fieldType)) {
                    score += 180;
                }

                if (fieldType === 'race') {
                    if (contextText.includes('race') || contextText.includes('racial')) score += 120;
                    if (contextText.includes('ethnicity') || contextText.includes('ethnic')) score += 75;
                    if (idNameText.includes('race')) score += 140;
                    if (idNameText.includes('ethnic')) score += 90;
                    if (this.isCustomComboboxUnanswered(resolvedControl)) score += 25;
                }

                score += Math.max(0, 40 - Math.floor(Math.max(0, verticalDelta) / 30));

                if (score > 0) {
                    rankedControls.push({ control: resolvedControl, score });
                }
            }

            rankedControls.sort((left, right) => right.score - left.score);
            return rankedControls.map(item => item.control);
        },

        getCustomComboboxDetectedFieldTypes(control) {
            const root = this.resolveCustomComboboxControl(control) || control;
            const candidates = [
                root,
                ...Array.from(root.querySelectorAll('input, button, [role="combobox"], [aria-haspopup="listbox"]'))
            ].filter(Boolean);
            const detectedTypes = new Set();

            for (const candidate of candidates) {
                const result = typeof FieldDetector?.identifyFieldType === 'function'
                    ? FieldDetector.identifyFieldType(candidate, { includeMeta: true })
                    : null;
                if (result?.fieldType) {
                    detectedTypes.add(result.fieldType);
                }
            }

            return Array.from(detectedTypes);
        },

        getPreferredProfileAnswer(fieldType) {
            if (fieldType === 'educationDegree') {
                return this.getEducationDegreeText() || null;
            }

            if (fieldType === 'educationSchool') {
                return this.getEducationSchoolText() || null;
            }

            return this.getStructuredChoiceConfig(fieldType)?.value || null;
        },

        getStructuredChoiceValues(fieldType, value) {
            if (!value) {
                return [];
            }

            const rawValues = Array.isArray(value)
                ? value
                : String(value)
                    .split(',')
                    .map(item => item.trim())
                    .filter(Boolean);
            const values = [];
            const seen = new Set();

            rawValues.forEach(rawValue => {
                const normalizedValue = this.normalizeText(rawValue);
                let mappedValues = [rawValue.trim()];

                if (fieldType === 'sexualOrientation') {
                    if (
                        (normalizedValue.includes('bisexual') && normalizedValue.includes('pansexual')) ||
                        normalizedValue === 'bisexual and or pansexual'
                    ) {
                        mappedValues = ['bisexual', 'pansexual'];
                    } else if (normalizedValue.includes('heterosexual') || normalizedValue === 'straight' || normalizedValue === 'straight heterosexual') {
                        mappedValues = ['straight'];
                    } else if (
                        normalizedValue === 'i don t wish to answer' ||
                        normalizedValue === 'i do not wish to answer' ||
                        normalizedValue.includes('prefer not')
                    ) {
                        mappedValues = ['no_answer'];
                    } else if (['asexual', 'bisexual', 'pansexual', 'gay', 'lesbian', 'queer', 'no_answer'].includes(normalizedValue)) {
                        mappedValues = [normalizedValue];
                    }
                }

                mappedValues.forEach(mappedValue => {
                    const key = mappedValue.trim();
                    if (!key || seen.has(key)) {
                        return;
                    }

                    seen.add(key);
                    values.push(key);
                });
            });

            return values;
        },

        findPreferredChoiceOption(options, fieldType) {
            if (!fieldType || !Array.isArray(options) || options.length === 0) {
                return null;
            }

            const educationOption = this.findEducationChoiceOption(options, fieldType);
            if (educationOption) {
                return educationOption;
            }

            const config = this.getStructuredChoiceConfig(fieldType);
            if (!config?.value) {
                return null;
            }

            if (fieldType === 'phoneCountryCode') {
                return this.findPhoneCountryCodeOption(options);
            }

            return this.findStructuredChoiceOption(options, fieldType, config.value, config.patterns || {});
        },

        isAmbiguousCheckboxProfileValue(fieldType, selectedValue, options) {
            if (fieldType !== 'race') {
                return false;
            }

            const normalizedValue = this.normalizeText(selectedValue);
            if (normalizedValue !== 'asian') {
                return false;
            }

            const asianLikeOptions = options.filter(option => {
                const normalizedText = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                return normalizedText.includes('asian');
            });

            if (asianLikeOptions.length <= 1) {
                return false;
            }

            return !asianLikeOptions.some(option => {
                const normalizedText = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                return normalizedText === 'asian';
            });
        },

        findPreferredCheckboxOptions(options, fieldType) {
            if (!fieldType || !Array.isArray(options) || options.length === 0) {
                return [];
            }

            const config = this.getStructuredChoiceConfig(fieldType);
            if (!config?.value) {
                return [];
            }

            const selectedValues = this.getStructuredChoiceValues(fieldType, config.value);
            if (selectedValues.length === 0) {
                return [];
            }

            const matchedOptions = [];
            const seenKeys = new Set();

            for (const selectedValue of selectedValues) {
                if (this.isAmbiguousCheckboxProfileValue(fieldType, selectedValue, options)) {
                    continue;
                }

                const matchedOption = this.findStructuredChoiceOption(options, fieldType, selectedValue, config.patterns || {});
                if (!matchedOption) {
                    continue;
                }

                const key = matchedOption.element || matchedOption.value || matchedOption.text;
                if (seenKeys.has(key)) {
                    continue;
                }

                seenKeys.add(key);
                matchedOptions.push(matchedOption);
            }

            if (matchedOptions.length > 0) {
                return matchedOptions;
            }

            const fallbackMatch = this.findPreferredChoiceOption(options, fieldType);
            return fallbackMatch ? [fallbackMatch] : [];
        },

        inferStructuredChoiceFieldType(...texts) {
            const educationFieldType = this.inferEducationChoiceFieldType(...texts);
            if (educationFieldType) {
                return educationFieldType;
            }

            const combinedText = texts
                .filter(Boolean)
                .map(text => this.coerceTextValue(text).trim())
                .join(' ');

            const binaryFieldType = FieldDetector.classifyBinaryQuestionType(combinedText);
            if (binaryFieldType) {
                return binaryFieldType;
            }

            const normalizedText = this.normalizeText(combinedText);
            if (!normalizedText) {
                return null;
            }

            const inferableFieldTypes = [
                ...Object.keys(this.getStructuredChoiceFieldMappings()),
                'city',
                'state',
                'location'
            ];

            for (const fieldType of inferableFieldTypes) {
                if (binaryFieldType && fieldType === binaryFieldType) {
                    return fieldType;
                }

                const patterns = FieldDetector.patterns[fieldType];
                if (!patterns) continue;

                const searchableTerms = [
                    ...(patterns.labels || []),
                    ...(patterns.questions || []),
                    ...(patterns.names || [])
                ];

                if (searchableTerms.some(term => FieldDetector.containsNormalizedPhrase(normalizedText, term))) {
                    return fieldType;
                }
            }

            return null;
        },

        shouldSkipAiChoiceForProfile(context = {}, options = []) {
            const fieldType = this.inferStructuredChoiceFieldType(
                context.fieldType,
                context.question,
                context.label,
                context.helperText,
                context.sectionContext,
                context.element?.name,
                context.element?.id,
                context.element?.getAttribute?.('aria-label') || '',
                context.element?.getAttribute?.('aria-labelledby') || ''
            );

            if (!fieldType) {
                return false;
            }

            return Boolean(this.findPreferredChoiceOption(options, fieldType));
        },

        findProfileChoiceOption(options, userValue, optionPatterns) {
            if (!Array.isArray(options) || options.length === 0 || !userValue) {
                return null;
            }

            const normalizedUserValue = this.normalizeText(userValue);
            const patterns = (optionPatterns?.[userValue] || []).map(pattern => this.normalizeText(pattern));
            const oppositePatterns = Object.entries(optionPatterns || {})
                .filter(([key]) => key !== userValue)
                .flatMap(([, valuePatterns]) => valuePatterns || [])
                .map(pattern => this.normalizeText(pattern));
            let bestMatch = null;
            let bestScore = -1;

            for (const option of options) {
                const optionText = option?.text || option?.textContent || option?.value || '';
                const normalizedOptionText = this.normalizeText(optionText);
                if (!normalizedOptionText) continue;

                let score = 0;

                if (normalizedOptionText === normalizedUserValue) {
                    score += 100;
                }

                if (normalizedUserValue && FieldDetector.containsNormalizedPhrase(normalizedOptionText, normalizedUserValue)) {
                    score += 35;
                }

                for (const pattern of patterns) {
                    if (!pattern) continue;
                    if (normalizedOptionText === pattern) {
                        score += 80;
                    } else if (FieldDetector.containsNormalizedPhrase(normalizedOptionText, pattern)) {
                        score += 45;
                    }
                }

                for (const oppositePattern of oppositePatterns) {
                    if (!oppositePattern) continue;
                    if (normalizedOptionText === oppositePattern) {
                        score -= 80;
                    } else if (FieldDetector.containsNormalizedPhrase(normalizedOptionText, oppositePattern)) {
                        score -= 45;
                    }
                }

                if (normalizedUserValue === 'yes') {
                    if (normalizedOptionText.startsWith('yes') || normalizedOptionText === 'true') score += 30;
                    if (normalizedOptionText.startsWith('no') || normalizedOptionText.includes(' will not ') || normalizedOptionText.includes(' do not ')) score -= 50;
                }

                if (normalizedUserValue === 'no') {
                    if (normalizedOptionText.startsWith('no') || normalizedOptionText === 'false') score += 30;
                    if (normalizedOptionText.startsWith('yes') || normalizedOptionText.includes(' will require ') || normalizedOptionText.includes(' do require ')) score -= 50;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = option;
                }
            }

            return bestScore > 0 ? bestMatch : null;
        },

        getStructuredChoiceAliases(fieldType, userValue) {
            const aliases = new Set();
            if (!fieldType || !userValue) {
                return [];
            }

            aliases.add(userValue);

            if (fieldType === 'hispanicLatino') {
                if (userValue === 'yes') {
                    aliases.add('yes i am hispanic or latino');
                    aliases.add('yes i identify as hispanic or latino');
                    aliases.add('hispanic or latino');
                } else if (userValue === 'no') {
                    aliases.add('no i am not hispanic or latino');
                    aliases.add('not hispanic or latino');
                    aliases.add('not hispanic latino');
                } else if (userValue === 'decline') {
                    aliases.add('decline to self identify');
                    aliases.add('prefer not to answer');
                    aliases.add('i do not wish to answer');
                    aliases.add('i don t wish to answer');
                }
            }

            if (fieldType === 'veteran') {
                if (userValue === 'not_veteran') {
                    aliases.add('i am not a protected veteran');
                    aliases.add('not a protected veteran');
                    aliases.add('not protected veteran');
                } else if (userValue === 'disabled_veteran') {
                    aliases.add('disabled protected veteran');
                    aliases.add('i identify as one or more of the classifications of a protected veteran');
                } else if (userValue === 'recently_separated') {
                    aliases.add('recently separated veteran');
                } else if (userValue === 'active_wartime') {
                    aliases.add('active duty wartime or campaign badge veteran');
                    aliases.add('active duty wartime veteran');
                } else if (userValue === 'armed_forces') {
                    aliases.add('armed forces service medal veteran');
                } else if (userValue === 'decline') {
                    aliases.add('decline to self identify');
                    aliases.add('prefer not to answer');
                    aliases.add('i do not wish to answer');
                    aliases.add('i don t wish to answer');
                }
            }

            if (fieldType === 'disability') {
                if (userValue === 'yes') {
                    aliases.add('yes i have a disability');
                    aliases.add('have a disability');
                    aliases.add('yes i have a disability or have a history record of having a disability');
                } else if (userValue === 'no') {
                    aliases.add('no i do not have a disability');
                    aliases.add('no i don t have a disability');
                    aliases.add('i do not have a disability');
                    aliases.add('i don t have a disability');
                    aliases.add('do not have a disability');
                } else if (userValue === 'decline') {
                    aliases.add('decline to self identify');
                    aliases.add('prefer not to answer');
                    aliases.add('i do not wish to answer');
                    aliases.add('i don t wish to answer');
                }
            }

            return Array.from(aliases).map(alias => this.normalizeText(alias)).filter(Boolean);
        },

        getStructuredChoicePolarity(fieldType, optionText) {
            const normalizedOptionText = this.normalizeText(optionText);
            if (!fieldType || !normalizedOptionText) {
                return null;
            }

            const isDecline =
                normalizedOptionText.includes('decline') ||
                normalizedOptionText.includes('prefer not') ||
                normalizedOptionText.includes('choose not') ||
                normalizedOptionText.includes('do not wish to answer') ||
                normalizedOptionText.includes('don t wish to answer') ||
                normalizedOptionText.includes('wish not to answer');

            if (isDecline) {
                return 'decline';
            }

            if (fieldType === 'hispanicLatino') {
                if (
                    normalizedOptionText.startsWith('no') ||
                    normalizedOptionText.includes('not hispanic') ||
                    normalizedOptionText.includes('not latino') ||
                    normalizedOptionText.includes('not latina') ||
                    normalizedOptionText.includes('not latinx')
                ) {
                    return 'no';
                }

                if (
                    normalizedOptionText.startsWith('yes') ||
                    normalizedOptionText.includes('identify as hispanic') ||
                    normalizedOptionText.includes('identify as latino') ||
                    normalizedOptionText.includes('hispanic or latino') ||
                    normalizedOptionText === 'hispanic' ||
                    normalizedOptionText === 'latino'
                ) {
                    return 'yes';
                }
            }

            if (fieldType === 'disability') {
                if (
                    normalizedOptionText.startsWith('no') ||
                    normalizedOptionText.includes('do not have a disability') ||
                    normalizedOptionText.includes('don t have a disability') ||
                    normalizedOptionText.includes('do not have a history') ||
                    normalizedOptionText.includes('don t have a history')
                ) {
                    return 'no';
                }

                if (
                    normalizedOptionText.startsWith('yes') ||
                    (normalizedOptionText.includes('have a disability') && !normalizedOptionText.includes('do not') && !normalizedOptionText.includes('don t')) ||
                    normalizedOptionText.includes('history record of having a disability')
                ) {
                    return 'yes';
                }
            }

            return null;
        },

        findStructuredChoiceOption(options, fieldType, userValue, optionPatterns) {
            if (!Array.isArray(options) || options.length === 0 || !fieldType || !userValue) {
                return this.findProfileChoiceOption(options, userValue, optionPatterns);
            }

            const selectedValues = this.getStructuredChoiceValues(fieldType, userValue);
            if (selectedValues.length === 0) {
                return this.findProfileChoiceOption(options, userValue, optionPatterns);
            }

            const preferredTerms = new Set([
                ...selectedValues.flatMap(value => this.getStructuredChoiceAliases(fieldType, value)),
                ...selectedValues.flatMap(value => (optionPatterns?.[value] || []).map(pattern => this.normalizeText(pattern)).filter(Boolean))
            ]);
            const oppositeTerms = new Set(
                Object.keys(optionPatterns || {})
                    .filter(key => !selectedValues.includes(key))
                    .flatMap(key => [
                        ...this.getStructuredChoiceAliases(fieldType, key),
                        ...((optionPatterns?.[key] || []).map(pattern => this.normalizeText(pattern)).filter(Boolean))
                    ])
                    .filter(Boolean)
            );

            let bestMatch = null;
            let bestScore = -1;

            for (const option of options) {
                const optionText = option?.text || option?.textContent || option?.value || '';
                const normalizedOptionText = this.normalizeText(optionText);
                if (!normalizedOptionText) continue;

                let score = 0;
                const polarity = this.getStructuredChoicePolarity(fieldType, normalizedOptionText);

                for (const term of preferredTerms) {
                    if (!term) continue;
                    if (normalizedOptionText === term) {
                        score += 90;
                    } else if (FieldDetector.containsNormalizedPhrase(normalizedOptionText, term)) {
                        score += 55;
                    }
                }

                for (const term of oppositeTerms) {
                    if (!term) continue;
                    if (normalizedOptionText === term) {
                        score -= 90;
                    } else if (FieldDetector.containsNormalizedPhrase(normalizedOptionText, term)) {
                        score -= 55;
                    }
                }

                if (fieldType === 'veteran' && userValue === 'not_veteran' && normalizedOptionText.includes('not a protected veteran')) {
                    score += 35;
                }
                if (fieldType === 'disability' && userValue === 'no' && (normalizedOptionText.includes('do not have a disability') || normalizedOptionText.includes('don t have a disability'))) {
                    score += 35;
                }
                if (fieldType === 'hispanicLatino' && userValue === 'no' && normalizedOptionText.includes('not hispanic')) {
                    score += 35;
                }
                if (selectedValues.includes('decline') && (normalizedOptionText.includes('wish to answer') || normalizedOptionText.includes('prefer not') || normalizedOptionText.includes('decline'))) {
                    score += 35;
                }

                if (['hispanicLatino', 'disability'].includes(fieldType) && polarity && selectedValues.length === 1) {
                    if (polarity === selectedValues[0]) {
                        score += 160;
                    } else {
                        score -= 190;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = option;
                }
            }

            return bestScore > 0 ? bestMatch : this.findProfileChoiceOption(options, userValue, optionPatterns);
        },

        isOptionCompatibleWithProfileAnswer(option, fieldType, preferredProfileAnswer) {
            if (!fieldType || !preferredProfileAnswer || !option) {
                return true;
            }

            const patterns = FieldDetector.patterns[fieldType]?.options || {};
            return this.findStructuredChoiceOption([option], fieldType, preferredProfileAnswer, patterns) !== null;
        },

        async fillCustomComboboxFields() {
            const attemptedControls = new Set();
            let progressMade = false;

            for (let pass = 0; pass < 6; pass += 1) {
                const controls = this.sortElementsTopToBottom(this.getCustomComboboxElements());
                if (controls.length === 0) {
                    this.recordDebugEvent('custom-combobox', 'skipped', {
                        reason: 'no-custom-combobox-controls-found',
                        source: 'scanner'
                    });
                    return;
                }

                if (pass === 0) {
                    console.log(`[JobAutofill] Found ${controls.length} custom combobox controls`);
                }

                let passProgress = false;

                for (const control of controls) {
                    const inferredFieldType = this.identifyCustomChoiceFieldType(control);

                    if (this.getTargetedStructuredFieldTypes().includes(inferredFieldType)) {
                        this.recordDebugEvent('custom-combobox', 'skipped', {
                            fieldType: inferredFieldType,
                            element: control,
                            reason: 'reserved-for-targeted-dropdown-pass',
                            source: 'profile-or-ai'
                        });
                        continue;
                    }

                    if (!this.isElementAllowed(control)) {
                        this.recordDebugEvent('custom-combobox', 'skipped', {
                            fieldType: inferredFieldType,
                            element: control,
                            reason: 'blocked-by-form-filter',
                            source: 'profile-or-ai'
                        });
                        continue;
                    }

                    if (control.disabled) {
                        this.recordDebugEvent('custom-combobox', 'skipped', {
                            fieldType: inferredFieldType,
                            element: control,
                            reason: 'disabled',
                            source: 'profile-or-ai'
                        });
                        continue;
                    }

                    if (!this.shouldFillCustomCombobox(control, inferredFieldType)) {
                        this.recordDebugEvent('custom-combobox', 'skipped', {
                            fieldType: inferredFieldType,
                            element: control,
                            reason: 'already-answered',
                            value: this.getCustomComboboxSelectionText(control),
                            source: 'profile-or-ai'
                        });
                        continue;
                    }

                    const identity = this.getCustomComboboxIdentity(control);
                    if (attemptedControls.has(identity)) {
                        this.recordDebugEvent('custom-combobox', 'skipped', {
                            fieldType: inferredFieldType,
                            element: control,
                            reason: 'already-attempted-this-run',
                            source: 'profile-or-ai'
                        });
                        continue;
                    }

                    attemptedControls.add(identity);

                    const resolved = await this.resolveCustomComboboxField(control);
                    if (!resolved) {
                        this.recordDebugEvent('custom-combobox', 'skipped', {
                            fieldType: inferredFieldType,
                            element: control,
                            reason: 'no-selection-resolved',
                            source: 'profile-or-ai'
                        });
                        continue;
                    }

                    passProgress = true;
                    progressMade = true;
                    this.filledFields.push({ type: resolved.type, element: control });
                    this.highlightField(control, true);
                    console.log(`[JobAutofill] Selected ${resolved.type} custom combobox option: ${resolved.text}`);

                    // React forms often re-render after each selection. Restart from the top.
                    await new Promise(resolve => setTimeout(resolve, 120));
                    break;
                }

                if (!passProgress) {
                    break;
                }
            }

            if (!progressMade) {
                console.log('[JobAutofill] No custom combobox selections were applied');
            }
        },

        async fillTargetedStructuredDropdowns() {
            const fieldTypes = this.getTargetedStructuredFieldTypes();
            const claimedControlIds = new Set();
            const completedFieldTypes = new Set();
            const resolvedControlsByFieldType = new Map();
            for (let pass = 0; pass < 3; pass += 1) {
                let passProgress = false;

                for (const fieldType of fieldTypes) {
                    if (completedFieldTypes.has(fieldType)) {
                        continue;
                    }

                    const config = this.getStructuredChoiceConfig(fieldType);
                    if (!config?.value) {
                        continue;
                    }

                    let candidates = this.rankStructuredDropdownControls(fieldType);
                    if (fieldType === 'race' && candidates.length === 0) {
                        const dependentControls = this.getDependentStructuredDropdownControls(
                            resolvedControlsByFieldType.get('hispanicLatino'),
                            fieldType
                        );
                        if (dependentControls.length > 0) {
                            candidates = dependentControls.map((control, index) => ({ control, score: 1000 - index }));
                        }
                    }

                    let fallbackControl = null;
                    if (candidates.length === 0) {
                        fallbackControl = await this.findStructuredDropdownControlByOptions(
                            fieldType,
                            fieldType === 'race'
                                ? this.getDependentStructuredDropdownControls(resolvedControlsByFieldType.get('hispanicLatino'), fieldType)
                                : []
                        );
                    }

                    if (candidates.length === 0 && !fallbackControl) {
                        if (pass === 0) {
                            this.recordDebugEvent('targeted-dropdown', 'skipped', {
                                fieldType,
                                reason: 'no-matching-dropdown-control-found',
                                source: 'profile'
                            });
                        }
                        continue;
                    }

                    let resolved = null;
                    let resolvedControl = null;

                    const orderedControls = candidates.map(candidate => candidate.control);
                    if (fallbackControl && !orderedControls.includes(fallbackControl)) {
                        orderedControls.unshift(fallbackControl);
                    }

                    for (const control of orderedControls) {
                        const controlId = this.getCustomComboboxIdentity(control);
                        if (claimedControlIds.has(controlId)) {
                            continue;
                        }

                        if (!this.shouldFillCustomCombobox(control, fieldType)) {
                            continue;
                        }

                        resolved = await this.resolveCustomComboboxField(control, fieldType);
                        if (resolved) {
                            resolvedControl = control;
                            claimedControlIds.add(controlId);
                            completedFieldTypes.add(fieldType);
                            resolvedControlsByFieldType.set(fieldType, control);
                            break;
                        }
                    }

                    if (!resolved || !resolvedControl) {
                        if (pass === 0) {
                            this.recordDebugEvent('targeted-dropdown', 'skipped', {
                                fieldType,
                                reason: 'targeted-resolution-failed',
                                source: 'profile'
                            });
                        }
                        continue;
                    }

                    passProgress = true;
                    this.filledFields.push({ type: resolved.type || fieldType, element: resolvedControl });
                    this.highlightField(resolvedControl, true);
                    this.recordDebugEvent('targeted-dropdown', 'filled', {
                        fieldType,
                        element: resolvedControl,
                        reason: 'targeted-dropdown-selected',
                        value: resolved.text,
                        source: resolved.source || 'profile'
                    });

                    if (fieldType === 'hispanicLatino') {
                        await this.waitForDependentStructuredDropdown('race', resolvedControl);
                    }

                    await new Promise(resolve => setTimeout(resolve, this.getTargetedDropdownPauseMs(fieldType)));
                }

                if (!passProgress) {
                    break;
                }
            }
        },

        rankStructuredDropdownControls(fieldType) {
            const controls = this.sortElementsTopToBottom(this.getCustomComboboxElements());
            const rankedControls = [];
            const patterns = FieldDetector.patterns[fieldType] || {};
            const searchTerms = [
                ...(patterns.labels || []),
                ...(patterns.questions || []),
                ...(patterns.names || [])
            ].map(term => this.normalizeText(term)).filter(Boolean);

            for (const control of controls) {
                if (!this.isElementAllowed(control) || control.disabled) continue;

                const root = this.getCustomComboboxContextRoot(control);
                const contextText = this.normalizeText(root?.textContent?.slice(0, 800) || '');
                const detectedFieldTypes = this.getCustomComboboxDetectedFieldTypes(control);
                const ariaLabel = this.normalizeText(control.getAttribute('aria-label') || '');
                const relatedInput = control.matches('input')
                    ? control
                    : root?.querySelector('input[type="text"], input[type="search"], input[role="combobox"], input[aria-autocomplete="list"], input[type="hidden"], input[name], input[id]');
                const idNameText = this.normalizeText([
                    control.getAttribute('id') || '',
                    control.getAttribute('name') || '',
                    relatedInput?.getAttribute?.('id') || '',
                    relatedInput?.getAttribute?.('name') || ''
                ].join(' '));
                const labelledByText = this.normalizeText([
                    FieldDetector.getAriaLabelledByText(control),
                    FieldDetector.getAriaLabelledByText(relatedInput),
                    relatedInput?.getAttribute?.('aria-label') || '',
                    relatedInput?.placeholder || ''
                ].join(' '));
                const directContext = relatedInput && typeof FieldDetector?.getFieldDebugContext === 'function'
                    ? FieldDetector.getFieldDebugContext(relatedInput)
                    : null;
                const directContextText = this.normalizeText([
                    directContext?.questionText || '',
                    directContext?.labelText || '',
                    directContext?.placeholder || '',
                    directContext?.ariaLabel || '',
                    directContext?.ariaLabelledBy || ''
                ].join(' '));
                const inferredFieldType = this.identifyCustomChoiceFieldType(control);
                const directFieldType = this.inferStructuredChoiceFieldType(
                    directContext?.questionText,
                    directContext?.labelText,
                    directContext?.placeholder,
                    directContext?.ariaLabel,
                    directContext?.ariaLabelledBy,
                    labelledByText,
                    ariaLabel
                );
                let score = 0;

                if (inferredFieldType === fieldType) {
                    score += 100;
                } else if (inferredFieldType) {
                    score -= 55;
                }

                if (detectedFieldTypes.includes(fieldType)) {
                    score += 180;
                } else if (detectedFieldTypes.length > 0) {
                    score -= 70;
                }

                if (directFieldType === fieldType) {
                    score += 120;
                } else if (directFieldType) {
                    score -= 80;
                }

                for (const term of searchTerms) {
                    if (!term) continue;
                    if (contextText.includes(term)) score += 10;
                    if (ariaLabel.includes(term)) score += 15;
                    if (labelledByText.includes(term)) score += 18;
                    if (directContextText.includes(term)) score += 28;
                    if (idNameText.includes(term)) score += 24;
                }

                if (fieldType === 'veteran' && contextText.includes('veteran status')) score += 25;
                if (fieldType === 'disability' && contextText.includes('disability status')) score += 25;
                if (fieldType === 'hispanicLatino' && (contextText.includes('hispanic') || contextText.includes('latino'))) score += 25;
                if (fieldType === 'gender' && contextText.includes('gender')) score += 25;
                if (fieldType === 'veteran' && idNameText.includes('veteran')) score += 30;
                if (fieldType === 'disability' && idNameText.includes('disability')) score += 30;
                if (fieldType === 'hispanicLatino' && (idNameText.includes('hispanic') || idNameText.includes('ethnicity'))) score += 30;
                if (fieldType === 'gender' && idNameText.includes('gender')) score += 30;
                if (fieldType === 'veteran' && directContextText.includes('veteran status')) score += 40;
                if (fieldType === 'disability' && directContextText.includes('disability status')) score += 40;
                if (fieldType === 'hispanicLatino' && (directContextText.includes('hispanic') || directContextText.includes('latino'))) score += 40;
                if (fieldType === 'gender' && directContextText.includes('gender')) score += 40;

                if (fieldType !== 'race' && directFieldType === 'race') score -= 60;
                if (fieldType !== 'hispanicLatino' && directFieldType === 'hispanicLatino') score -= 60;
                if (fieldType !== 'veteran' && directFieldType === 'veteran') score -= 60;
                if (fieldType !== 'disability' && directFieldType === 'disability') score -= 60;
                if (fieldType !== 'race' && detectedFieldTypes.includes('race')) score -= 80;
                if (fieldType !== 'hispanicLatino' && detectedFieldTypes.includes('hispanicLatino')) score -= 80;
                if (fieldType !== 'veteran' && detectedFieldTypes.includes('veteran')) score -= 80;
                if (fieldType !== 'disability' && detectedFieldTypes.includes('disability')) score -= 80;
                if (fieldType !== 'gender' && detectedFieldTypes.includes('gender')) score -= 80;
                if (fieldType !== 'phoneCountryCode' && detectedFieldTypes.includes('phoneCountryCode')) score -= 80;

                if (score > 0) {
                    rankedControls.push({ control, score });
                }
            }

            rankedControls.sort((left, right) => right.score - left.score);
            return rankedControls;
        },

        getLikelyStructuredDropdownControls(fieldType) {
            const controls = this.sortElementsTopToBottom(this.getCustomComboboxElements());
            const patterns = FieldDetector.patterns[fieldType] || {};
            const searchTerms = [
                ...(patterns.labels || []),
                ...(patterns.questions || []),
                ...(patterns.names || [])
            ].map(term => this.normalizeText(term)).filter(Boolean);

            return controls.filter(control => {
                if (!this.isElementAllowed(control) || control.disabled) {
                    return false;
                }

                const root = this.getCustomComboboxContextRoot(control);
                const detectedFieldTypes = this.getCustomComboboxDetectedFieldTypes(control);
                const inferredFieldType = this.identifyCustomChoiceFieldType(control);
                const relatedInput = control.matches('input')
                    ? control
                    : root?.querySelector('input[type="text"], input[type="search"], input[role="combobox"], input[aria-autocomplete="list"], input[type="hidden"], input[name], input[id]');
                const idNameText = this.normalizeText([
                    control.getAttribute('id') || '',
                    control.getAttribute('name') || '',
                    relatedInput?.getAttribute?.('id') || '',
                    relatedInput?.getAttribute?.('name') || ''
                ].join(' '));
                const contextText = this.normalizeText(root?.textContent?.slice(0, 800) || '');
                const directFieldType = this.inferStructuredChoiceFieldType(
                    FieldDetector.getAriaLabelledByText(control),
                    control.getAttribute('aria-label') || '',
                    relatedInput?.getAttribute?.('aria-label') || '',
                    relatedInput?.placeholder || '',
                    idNameText,
                    contextText
                );

                if (inferredFieldType === fieldType || directFieldType === fieldType || detectedFieldTypes.includes(fieldType)) {
                    return true;
                }

                return searchTerms.some(term => term && (contextText.includes(term) || idNameText.includes(term)));
            });
        },

        scoreComboboxOptionSetForFieldType(fieldType, options) {
            if (!fieldType || !Array.isArray(options) || options.length === 0) {
                return 0;
            }

            const optionPatterns = FieldDetector.patterns[fieldType]?.options || {};
            const matchedGroups = new Set();
            const specificGroups = new Set();
            const genericGroups = new Set();
            let score = 0;

            for (const option of options) {
                const normalizedText = this.normalizeText(option.text || option.element?.textContent || '');
                if (!normalizedText) continue;

                for (const [groupKey, signals] of Object.entries(optionPatterns)) {
                    const normalizedSignals = (signals || []).map(signal => this.normalizeText(signal)).filter(Boolean);
                    const matchedSignal = normalizedSignals.find(signal => normalizedText === signal || normalizedText.includes(signal) || signal.includes(normalizedText));
                    if (matchedSignal) {
                        matchedGroups.add(groupKey);
                        if (this.isGenericStructuredChoiceText(matchedSignal) && this.isGenericStructuredChoiceText(normalizedText)) {
                            genericGroups.add(groupKey);
                            score += 3;
                        } else {
                            specificGroups.add(groupKey);
                            score += 15;
                        }
                        break;
                    }
                }
            }

            if (specificGroups.size === 0 && genericGroups.size > 0) {
                return 0;
            }

            score += specificGroups.size * 30;
            score += genericGroups.size * 5;

            if (fieldType === 'race' && specificGroups.size >= 3) {
                score += 80;
            }

            if (fieldType === 'gender' && specificGroups.size >= 2) {
                score += 45;
            }

            if (['hispanicLatino', 'veteran', 'disability'].includes(fieldType) && specificGroups.size >= 2) {
                score += 45;
            }

            return score;
        },

        isGenericStructuredChoiceText(text) {
            const normalizedText = this.normalizeText(text);
            if (!normalizedText) {
                return false;
            }

            return new Set([
                'yes',
                'no',
                'true',
                'false',
                'decline',
                'decline to self identify',
                'prefer not',
                'prefer not to answer',
                'do not wish',
                'do not wish to answer',
                'don t wish to answer',
                'choose not',
                'choose not to answer'
            ]).has(normalizedText);
        },

        async findStructuredDropdownControlByOptions(fieldType, preferredControls = []) {
            const controls = [...preferredControls, ...this.getLikelyStructuredDropdownControls(fieldType)]
                .filter((control, index, array) => array.indexOf(control) === index);
            let bestControl = null;
            let bestScore = 0;

            if (controls.length === 0) {
                return null;
            }

            for (const control of controls) {
                const options = await this.getComboboxOptions(control);
                const inferredFieldType = this.inferComboboxFieldTypeFromOptions(control, options);
                this.closeCustomCombobox(control);

                if (inferredFieldType !== fieldType) {
                    continue;
                }

                const score = this.scoreComboboxOptionSetForFieldType(fieldType, options);
                if (score > bestScore) {
                    bestScore = score;
                    bestControl = control;
                }
            }

            return bestControl;
        },

        closeCustomCombobox(control) {
            const root = this.resolveCustomComboboxControl(control) || control;
            if (!root) {
                return;
            }

            const input = root.querySelector(`input.${GREENHOUSE_SELECT_CLASSES.input}, .${GREENHOUSE_SELECT_CLASSES.input} input, input[type="text"], input[type="search"]`);
            const keyboardTarget = input || root;

            if (root.getAttribute('aria-expanded') === 'true' || keyboardTarget.getAttribute?.('aria-expanded') === 'true') {
                keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape' }));
                keyboardTarget.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Escape', code: 'Escape' }));
            }

            keyboardTarget.blur?.();
        },

        findBestStructuredDropdownControl(fieldType) {
            return this.rankStructuredDropdownControls(fieldType)[0]?.control || null;
        },

        async fillAiCustomComboboxFields() {
            const aiSettings = this.settings?.aiAssist;
            if (!aiSettings?.enabled) {
                return;
            }

            const controls = this.getCustomComboboxElements();
            const candidates = [];

            for (const control of controls) {
                if (!this.isElementAllowed(control) || control.disabled) continue;
                if (!this.isCustomComboboxUnanswered(control)) continue;

                const context = this.getAiFieldContext(control);
                if (!context.question || !this.looksLikeChoiceQuestion(context.question, context.sectionContext)) continue;
                if (this.shouldSkipAiChoiceForProfile({ ...context, element: control })) continue;

                const options = await this.getComboboxOptions(control);
                if (options.length < 2 || options.length > 12) continue;

                candidates.push({
                    type: 'combobox',
                    element: control,
                    question: context.question,
                    label: context.label,
                    helperText: context.helperText,
                    sectionContext: context.sectionContext,
                    detectedFieldType: this.inferEducationChoiceFieldType(
                        context.question,
                        context.label,
                        context.helperText,
                        context.sectionContext,
                        options
                    ),
                    options
                });
            }

            if (candidates.length === 0) {
                return;
            }

            const jobPostingText = this.extractJobPostingText();
            const pageTitle = document.title || '';

            const groups = this.groupAiCandidates(candidates, candidate => ({
                payload: {
                    question: candidate.question,
                    fieldLabel: candidate.label,
                    helperText: candidate.helperText,
                    sectionContext: candidate.sectionContext,
                    choiceOptions: candidate.options.map(option => option.text),
                    fieldHtmlType: candidate.type,
                    pageTitle,
                    jobPostingText
                },
                debugMeta: {
                    fieldType: 'aiComboboxChoice',
                    element: candidate.element
                }
            }));
            const limit = Math.max(1, Math.min(aiSettings.maxQuestionsPerRun || 10, groups.length));
            const selectedGroups = groups.slice(0, limit);
            const responses = await this.requestAiAnswersBatch(selectedGroups.map(group => ({
                payload: group.payload,
                debugMeta: group.debugMeta
            })));

            for (let index = 0; index < selectedGroups.length; index += 1) {
                const group = selectedGroups[index];
                const response = responses[index];
                try {
                    if (!response?.success || !response.answer) continue;

                    for (const candidate of group.targets) {
                        if (this.shouldSkipAiChoiceForProfile(candidate)) {
                            this.recordDebugEvent('ai-choice', 'skipped', {
                                fieldType: candidate.detectedFieldType,
                                element: candidate.element,
                                reason: 'profile-backed-choice-field',
                                source: 'profile'
                            });
                            continue;
                        }

                        const matchedOption = this.findBestAiChoiceMatch(candidate.options, response.answer);
                        if (!matchedOption) continue;

                        if (this.applyChoiceControl(matchedOption.element)) {
                            this.filledFields.push({ type: 'aiComboboxChoice', element: candidate.element });
                            this.highlightField(candidate.element, true);
                            console.log(`[JobAutofill] AI selected custom combobox option: ${matchedOption.text}`);
                        }
                    }
                } catch (error) {
                    console.warn('[JobAutofill] AI custom combobox selection failed:', error);
                }
            }
        },

        async resolveCustomComboboxField(control, fieldTypeOverride = null) {
            const choiceContext = this.getChoiceFieldContext(control);
            const contextEducationFieldType = this.inferEducationChoiceFieldType(
                choiceContext.question,
                choiceContext.label,
                choiceContext.helperText,
                choiceContext.sectionContext
            );
            const initialFieldType = fieldTypeOverride || this.identifyCustomChoiceFieldType(control) || contextEducationFieldType;

            if (initialFieldType === 'educationSchool') {
                const schoolResolved = await this.resolveEducationSchoolComboboxField(control, []);
                if (schoolResolved) {
                    return schoolResolved;
                }
            }

            const rawOptions = await this.getComboboxOptions(control);
            const fieldType = contextEducationFieldType || this.inferEducationChoiceFieldType(
                choiceContext.question,
                choiceContext.label,
                choiceContext.helperText,
                choiceContext.sectionContext,
                rawOptions
            ) || initialFieldType || this.inferComboboxFieldTypeFromOptions(control, rawOptions);
            const config = fieldType ? this.getStructuredChoiceConfig(fieldType) : null;
            const profileOptions = this.filterComboboxOptionsForFieldType(rawOptions, fieldType);
            const options = profileOptions.length > 0 ? profileOptions : rawOptions;
            const isAcknowledgement = this.isAcknowledgementQuestion(choiceContext.question, choiceContext.sectionContext, choiceContext.label);

            if (fieldType === 'city' || fieldType === 'location') {
                const locationResolved = await this.resolveLocationComboboxField(control, fieldType, rawOptions);
                if (locationResolved) {
                    return locationResolved;
                }
            }

            if (fieldType === 'educationSchool') {
                const schoolResolved = await this.resolveEducationSchoolComboboxField(control, rawOptions);
                if (schoolResolved) {
                    return schoolResolved;
                }
            }

            this.recordDebugEvent('custom-combobox-options', options.length > 0 ? 'filled' : 'skipped', {
                fieldType,
                element: control,
                reason: options.length > 0
                    ? (profileOptions.length > 0 ? `resolved-${options.length}-candidate-options` : `using-raw-${options.length}-option-ai-fallback`)
                    : 'no-valid-options-after-filtering',
                source: 'profile-or-ai',
                options: options.map(option => option.text)
            });

            if (options.length === 0) {
                if (fieldType) {
                    console.log(`[JobAutofill] No valid ${fieldType} combobox options found for detected field`);
                }
                return null;
            }

            if (!fieldType && options.length === 1) {
                if (await this.applyCustomComboboxSelection(control, options[0], null)) {
                    return {
                        type: isAcknowledgement ? 'acknowledgement' : 'singleOptionChoice',
                        text: options[0].text,
                        source: 'rule'
                    };
                }
            }

            const educationOption = this.findEducationChoiceOption(options, fieldType);
            if (educationOption && await this.applyCustomComboboxSelection(control, educationOption, fieldType)) {
                return {
                    type: fieldType,
                    text: educationOption.text,
                    source: 'profile'
                };
            }

            if (config?.value) {
                const matched = this.findCustomComboboxProfileOption(options, fieldType, config);
                if (!matched) {
                    this.recordDebugEvent('custom-combobox', 'skipped', {
                        fieldType,
                        element: control,
                        reason: 'no-profile-option-match',
                        value: config.value,
                        source: 'profile'
                    });
                }
                if (matched && await this.applyCustomComboboxSelection(control, matched, fieldType)) {
                    return {
                        type: fieldType,
                        text: matched.text,
                        source: 'profile'
                    };
                }
            }

            const aiMatch = await this.resolveCustomComboboxWithAi(control, options, fieldType);
            if (aiMatch) {
                return aiMatch;
            }

            this.recordDebugEvent('custom-combobox', 'skipped', {
                fieldType,
                element: control,
                reason: 'no-profile-or-ai-match',
                source: config?.value ? 'profile-or-ai' : 'ai'
            });

            return null;
        },

        getLocationComboboxSearchValue(fieldType) {
            if (fieldType === 'city') {
                return this.userData?.city || this.formatLocation();
            }

            if (fieldType === 'location') {
                return this.formatLocation() || this.userData?.city || '';
            }

            return '';
        },

        getEducationComboboxSearchValue(fieldType) {
            if (fieldType === 'educationSchool') {
                return this.getEducationSchoolText();
            }

            if (fieldType === 'educationDegree') {
                return this.getEducationDegreeText();
            }

            return '';
        },

        async resolveLocationComboboxField(control, fieldType, existingOptions = []) {
            const searchValue = this.getLocationComboboxSearchValue(fieldType);
            if (!searchValue) {
                return null;
            }

            const root = this.resolveCustomComboboxControl(control) || control;
            const input = root.querySelector(`input.${GREENHOUSE_SELECT_CLASSES.input}, .${GREENHOUSE_SELECT_CLASSES.input} input, input[type="text"], input[type="search"]`);
            if (!input) {
                return null;
            }

            input.focus?.();
            this.setElementValue(input, searchValue);
            this.dispatchValueEvents(input, { emitFocus: false, emitBlur: false });
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));

            await new Promise(resolve => setTimeout(resolve, 180));

            const refreshedOptions = await this.getComboboxOptions(root);
            const options = refreshedOptions.length > 0 ? refreshedOptions : existingOptions;
            const normalizedSearch = this.normalizeText(searchValue);
            const normalizedCity = this.normalizeText(this.userData?.city || '');
            const matchedOption = options.find(option => {
                const normalizedText = this.normalizeText(option.text || '');
                return normalizedText.includes(normalizedSearch) || (normalizedCity && normalizedText.includes(normalizedCity));
            });

            if (!matchedOption) {
                this.recordDebugEvent('custom-combobox', 'skipped', {
                    fieldType,
                    element: control,
                    reason: 'no-location-option-match',
                    value: searchValue,
                    source: 'profile'
                });
                return null;
            }

            if (!await this.applyCustomComboboxSelection(root, matchedOption, fieldType)) {
                return null;
            }

            return {
                type: fieldType,
                text: matchedOption.text,
                source: 'profile'
            };
        },

        async resolveEducationSchoolComboboxField(control, existingOptions = []) {
            const searchValue = this.getEducationComboboxSearchValue('educationSchool');
            if (!searchValue) {
                return null;
            }

            const root = this.resolveCustomComboboxControl(control) || control;
            const input = root.querySelector(`input.${GREENHOUSE_SELECT_CLASSES.input}, .${GREENHOUSE_SELECT_CLASSES.input} input, input[type="text"], input[type="search"]`);
            if (!input) {
                const fallbackOption = this.findEducationChoiceOption(existingOptions, 'educationSchool');
                if (!fallbackOption || !await this.applyCustomComboboxSelection(control, fallbackOption, 'educationSchool')) {
                    return null;
                }

                return {
                    type: 'educationSchool',
                    text: fallbackOption.text,
                    source: 'profile'
                };
            }

            this.setComboboxSearchValue(root, searchValue);

            const schoolState = await this.waitForComboboxState(root, {
                timeoutMs: 1500,
                intervalMs: 150,
                minWaitMs: 1500
            });
            const initialOptions = schoolState.options.map(option => ({
                text: (option.textContent || '').replace(/\s+/g, ' ').trim(),
                element: option
            })).filter(option => option.text && !this.isPlaceholderOption(option.text));
            let matchedOption = this.findEducationSchoolOption(initialOptions);

            if (!matchedOption) {
                // Strategy 1: clear input and wait for the full unfiltered list.
                // Many school comboboxes use async server search — typing "Other" searches
                // for schools named "Other" (0 results). "Other" only appears in the default
                // unfiltered list shown when the input is empty.
                this.setComboboxSearchValue(root, '');
                await new Promise(resolve => setTimeout(resolve, 300));

                // Ensure the dropdown is still open after clearing.
                if (root.getAttribute('aria-expanded') !== 'true') {
                    await this.openCustomCombobox(root);
                    await new Promise(resolve => setTimeout(resolve, 150));
                }

                const unfilteredState = await this.waitForComboboxState(root, {
                    timeoutMs: 2000,
                    intervalMs: 150,
                    minWaitMs: 500
                });
                const unfilteredOptions = unfilteredState.options.map(option => ({
                    text: (option.textContent || '').replace(/\s+/g, ' ').trim(),
                    element: option
                })).filter(option => option.text && !this.isPlaceholderOption(option.text));

                // Use broader match — handles "Other", "Other (please specify)", etc.
                matchedOption = this.findOtherChoiceOption(unfilteredOptions);

                // Strategy 2: if empty list (combobox requires typing), try typing "other".
                if (!matchedOption && unfilteredOptions.length === 0) {
                    this.setComboboxSearchValue(root, 'other');
                    const otherTypedState = await this.waitForComboboxState(root, {
                        timeoutMs: 1500,
                        intervalMs: 150,
                        minWaitMs: 800
                    });
                    const otherTypedOptions = otherTypedState.options.map(option => ({
                        text: (option.textContent || '').replace(/\s+/g, ' ').trim(),
                        element: option
                    })).filter(option => option.text && !this.isPlaceholderOption(option.text));
                    matchedOption = this.findOtherChoiceOption(otherTypedOptions);
                }
            }

            if (!matchedOption) {
                // Last resort: search existingOptions / initialOptions for any "other" entry.
                const fallbackPool = initialOptions.length > 0 ? initialOptions : existingOptions;
                matchedOption = this.findOtherChoiceOption(fallbackPool);
            }

            if (!matchedOption) {
                this.recordDebugEvent('custom-combobox', 'skipped', {
                    fieldType: 'educationSchool',
                    element: control,
                    reason: 'school-search-returned-no-matches-and-other-not-found',
                    value: searchValue,
                    source: 'profile'
                });
                return null;
            }

            if (!await this.applyCustomComboboxSelection(root, matchedOption, 'educationSchool')) {
                return null;
            }

            return {
                type: 'educationSchool',
                text: matchedOption.text,
                source: 'profile'
            };
        },

        async resolveCustomComboboxWithAi(control, options, detectedFieldType = null) {
            const aiSettings = this.settings?.aiAssist;
            if (!aiSettings?.enabled || !Array.isArray(options) || options.length < 2) {
                return null;
            }

            if (!detectedFieldType && options.length > 20) {
                this.recordDebugEvent('custom-combobox', 'skipped', {
                    fieldType: detectedFieldType,
                    element: control,
                    reason: 'unclassified-large-option-list',
                    source: 'ai',
                    options: options.slice(0, 12).map(option => option.text)
                });
                return null;
            }

            const context = this.getChoiceFieldContext(control);
            if (!context.question) {
                return null;
            }
            const preferredProfileAnswer = this.getPreferredProfileAnswer(detectedFieldType);

            try {
                const response = await this.requestAiAnswer({
                    question: context.question,
                    fieldLabel: context.label,
                    helperText: context.helperText,
                    sectionContext: context.sectionContext,
                    detectedFieldType: detectedFieldType || '',
                    preferredProfileAnswer: preferredProfileAnswer || '',
                    choiceOptions: options.map(option => option.text),
                    fieldHtmlType: 'combobox',
                    pageTitle: document.title || '',
                    jobPostingText: this.extractJobPostingText()
                }, {
                    fieldType: detectedFieldType || 'aiComboboxChoice',
                    element: control
                });

                if (!response?.success || !response.answer) {
                    return null;
                }

                const matchedOption = this.findBestAiChoiceMatch(options, response.answer);
                if (!matchedOption) {
                    return null;
                }

                const preferredOption = preferredProfileAnswer && detectedFieldType
                    ? this.findStructuredChoiceOption(options, detectedFieldType, preferredProfileAnswer, FieldDetector.patterns[detectedFieldType]?.options || {})
                    : null;
                const finalOption = this.isOptionCompatibleWithProfileAnswer(matchedOption, detectedFieldType, preferredProfileAnswer)
                    ? matchedOption
                    : preferredOption;

                if (!finalOption || !await this.applyCustomComboboxSelection(control, finalOption, detectedFieldType)) {
                    return null;
                }

                return {
                    type: detectedFieldType || 'aiComboboxChoice',
                    text: finalOption.text,
                    source: 'ai'
                };
            } catch (error) {
                console.warn('[JobAutofill] AI custom combobox selection failed:', error);
                return null;
            }
        },

        findCustomComboboxProfileOption(options, fieldType, config) {
            if (fieldType === 'phoneCountryCode') {
                const phoneCodeOption = this.findPhoneCountryCodeOption(options);
                if (phoneCodeOption) {
                    return phoneCodeOption;
                }
            }

            return this.findStructuredChoiceOption(options, fieldType, config.value, config.patterns);
        },

        inferComboboxFieldTypeFromOptions(control, options) {
            if (!Array.isArray(options) || options.length === 0) {
                return null;
            }

            const context = this.getChoiceFieldContext(control);
            const contextText = this.normalizeText([
                context.question,
                context.label,
                context.helperText,
                context.sectionContext,
                control?.getAttribute?.('aria-label') || '',
                control?.getAttribute?.('aria-labelledby') || ''
            ].join(' '));

            const phoneLikeOptions = options.filter(option => this.looksLikePhoneCountryCodeOption(option.text));
            if (
                phoneLikeOptions.length >= Math.min(8, Math.max(3, Math.floor(options.length * 0.15))) ||
                ((contextText.includes('phone') || contextText.includes('dial code') || contextText.includes('country code')) && phoneLikeOptions.length >= 2)
            ) {
                return 'phoneCountryCode';
            }

            const directContextFieldType = this.inferStructuredChoiceFieldType(
                context.question,
                context.label,
                context.helperText,
                control?.getAttribute?.('aria-label') || '',
                control?.getAttribute?.('aria-labelledby') || ''
            );

            if (directContextFieldType) {
                return directContextFieldType;
            }

            const optionScoredFieldTypes = ['race', 'gender', 'hispanicLatino', 'veteran', 'disability'];
            let bestFieldType = null;
            let bestScore = 0;

            for (const fieldType of optionScoredFieldTypes) {
                const score = this.scoreComboboxOptionSetForFieldType(fieldType, options);
                if (score > bestScore) {
                    bestScore = score;
                    bestFieldType = fieldType;
                }
            }

            if (bestFieldType && bestScore >= 40) {
                return bestFieldType;
            }

            return this.inferStructuredChoiceFieldType(
                context.sectionContext,
                options.slice(0, 12).map(option => option.text).join(' ')
            );
        },

        filterComboboxOptionsForFieldType(options, fieldType) {
            if (!Array.isArray(options) || options.length === 0 || !fieldType) {
                return options || [];
            }

            if (fieldType === 'phoneCountryCode') {
                return options.filter(option => this.looksLikePhoneCountryCodeOption(option.text));
            }

            const patterns = FieldDetector.patterns[fieldType]?.options || {};
            const signals = new Set(
                Object.values(patterns)
                    .flat()
                    .map(signal => this.normalizeText(signal))
                    .filter(Boolean)
            );

            if (signals.size === 0) {
                return options;
            }

            const filtered = options.filter(option => {
                const normalizedText = this.normalizeText(option.text || option.element?.textContent || '');
                if (!normalizedText) return false;

                for (const signal of signals) {
                    if (!signal) continue;
                    if (normalizedText === signal || normalizedText.includes(signal) || signal.includes(normalizedText)) {
                        return true;
                    }
                }

                return false;
            });

            // If the list clearly does not belong to this field type, reject it entirely.
            if (filtered.length === 0) {
                return [];
            }

            return filtered;
        },

        looksLikePhoneCountryCodeOption(text) {
            const rawText = (text || '').replace(/\s+/g, ' ').trim();
            const normalizedText = this.normalizeText(rawText);
            if (!normalizedText || normalizedText.length < 2) {
                return false;
            }

            const hasDialCode = /\+\d{1,4}\b/.test(rawText) || /\(\+\d{1,4}\)/.test(rawText);
            const hasCountryName = [
                'united states', 'usa', 'canada', 'united kingdom', 'uk', 'australia',
                'india', 'germany', 'france', 'spain', 'brazil', 'mexico'
            ].some(signal => normalizedText.includes(signal));

            return hasDialCode || hasCountryName;
        },

        findPhoneCountryCodeOption(options) {
            let bestMatch = null;
            let bestScore = -1;

            for (const option of options) {
                const rawText = (option.text || option.element?.textContent || '').replace(/\s+/g, ' ').trim();
                const normalizedText = this.normalizeText(rawText);
                if (!normalizedText) continue;

                let score = 0;
                if (normalizedText.includes('united states')) score += 50;
                if (normalizedText.includes('usa')) score += 40;
                if (/(^|\s)us(\s|$)/.test(normalizedText)) score += 20;
                if (/\+1\b/.test(rawText) || /\(\+1\)/.test(rawText)) score += 35;
                if (normalizedText.includes('canada')) score -= 20;

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = option;
                }
            }

            return bestScore > 0 ? bestMatch : null;
        },

        getChoiceFieldContext(input) {
            const context = this.getAiFieldContext(input);
            const fallbackQuestion = context.question || context.label || this.extractQuestionSentence(context.sectionContext || '') || '';

            return {
                ...context,
                question: fallbackQuestion,
                label: context.label || fallbackQuestion
            };
        },

        getChoiceGroupContainer(input) {
            if (!input) {
                return null;
            }

            const inputType = (input.type || '').toLowerCase();
            if (!['checkbox', 'radio'].includes(inputType)) {
                return this.findQuestionContainer(input);
            }

            let current = input.parentElement;
            while (current && current !== document.body) {
                const groupInputs = Array.from(current.querySelectorAll(`input[type="${inputType}"]`));
                if (groupInputs.includes(input) && groupInputs.length >= 2) {
                    const distinctLabels = new Set(
                        groupInputs
                            .map(element => FieldDetector.getChoiceLabelText(element).trim())
                            .filter(Boolean)
                    );

                    if (distinctLabels.size >= 2) {
                        return current;
                    }
                }

                current = current.parentElement;
            }

            return this.findQuestionContainer(input);
        },

        getChoiceGroupKey(input) {
            if (!input) {
                return '';
            }

            const container = this.getChoiceGroupContainer(input);
            const inputType = (input.type || '').toLowerCase();
            const containerText = (container?.textContent || '').replace(/\s+/g, ' ').trim();
            const normalizedQuestion = this.normalizeText(
                this.extractQuestionSentence(containerText) ||
                FieldDetector.getQuestionText(input) ||
                FieldDetector.getLabelText(input) ||
                ''
            );
            const containerIdentity = this.normalizeText([
                container?.id || '',
                container?.getAttribute?.('data-testid') || '',
                container?.getAttribute?.('data-qa') || '',
                container?.className || ''
            ].join(' '));

            return [inputType, normalizedQuestion, containerIdentity].filter(Boolean).join('|');
        },

        async applyCustomComboboxSelection(control, option, fieldType = null) {
            if (!control || !option?.element) {
                this.recordDebugEvent('custom-combobox-select', 'skipped', {
                    fieldType,
                    element: control,
                    reason: !control ? 'missing-control' : 'missing-option-element',
                    source: 'profile-or-ai'
                });
                return false;
            }

            const root = this.resolveCustomComboboxControl(control) || control;
            const input = root.querySelector(`input.${GREENHOUSE_SELECT_CLASSES.input}, .${GREENHOUSE_SELECT_CLASSES.input} input, input[type="text"]`);
            const beforeState = this.getCustomComboboxSelectionState(root);
            const expectedSelection = this.normalizeText(option.text || option.element.textContent || '');

            if (!expectedSelection) {
                this.recordDebugEvent('custom-combobox-select', 'skipped', {
                    fieldType,
                    element: control,
                    reason: 'empty-option-text',
                    source: 'profile-or-ai'
                });
                return false;
            }

            this.recordDebugEvent('custom-combobox-select', 'filled', {
                fieldType,
                element: control,
                reason: 'dispatching-react-selection-sequence',
                value: option.text,
                source: 'profile-or-ai'
            });

            option.element.scrollIntoView?.({ block: 'nearest' });

            root.focus?.();

            const target = option.element;
            target.click?.();
            target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

            for (let attempt = 0; attempt < 6; attempt += 1) {
                await new Promise(resolve => setTimeout(resolve, 80));

                if (attempt === 2 && !this.isStrictStructuredChoiceField(fieldType)) {
                    const keyboardTarget = input || root;
                    keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
                    keyboardTarget.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
                }

                const currentState = this.getCustomComboboxSelectionState(root);
                const optionMarkedSelected =
                    target.getAttribute('aria-selected') === 'true' ||
                    target.classList.contains('select__option--is-selected') ||
                    target.getAttribute('data-selected') === 'true';

                const selectionConfirmed = this.didCustomComboboxSelectionChange(beforeState, currentState, option, fieldType, target);

                if (selectionConfirmed || optionMarkedSelected) {
                    root.dispatchEvent(new Event('change', { bubbles: true }));
                    root.dispatchEvent(new Event('blur', { bubbles: true }));
                    this.recordDebugEvent('custom-combobox-select', 'filled', {
                        fieldType,
                        element: control,
                        reason: 'selection-confirmed',
                        value: option.text,
                        source: 'profile-or-ai'
                    });
                    return true;
                }
            }

            this.recordDebugEvent('custom-combobox-select', 'skipped', {
                fieldType,
                element: control,
                reason: 'selection-did-not-stick',
                value: option.text,
                source: 'profile-or-ai'
            });
            return false;
        },

        getCustomComboboxSelectionState(control) {
            const root = this.resolveCustomComboboxControl(control) || control;
            const hiddenValueSummary = Array.from(root.querySelectorAll('input[type="hidden"], input[name], input[id]'))
                .map(input => `${input.name || input.id || input.type || 'input'}:${input.value || ''}`)
                .join(' | ');

            return {
                text: this.normalizeText(this.getCustomComboboxSelectionText(root)),
                hiddenValues: this.normalizeText(hiddenValueSummary),
                expanded: root.getAttribute('aria-expanded') || root.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') || ''
            };
        },

        didCustomComboboxSelectionChange(beforeState, currentState, option, fieldType, target) {
            const currentText = currentState?.text || '';
            const currentHiddenValues = currentState?.hiddenValues || '';
            const textChanged = Boolean(currentText) && currentText !== (beforeState?.text || '');
            const hiddenChanged = Boolean(currentHiddenValues) && currentHiddenValues !== (beforeState?.hiddenValues || '');
            const menuClosed = currentState?.expanded === 'false' || !target?.isConnected;
            const matchesText = this.matchesCustomComboboxSelection(currentText, option, fieldType);
            const matchesHiddenValue = this.matchesCustomComboboxSelection(currentHiddenValues, option, fieldType);
            const isStrictStructuredChoice = this.isStrictStructuredChoiceField(fieldType);

            if ((textChanged && matchesText) || (hiddenChanged && matchesHiddenValue)) {
                return true;
            }

            if (menuClosed && (matchesText || matchesHiddenValue)) {
                return true;
            }

            if (!isStrictStructuredChoice && menuClosed && (textChanged || hiddenChanged)) {
                return true;
            }

            return false;
        },

        matchesCustomComboboxSelection(currentSelection, option, fieldType) {
            const normalizedCurrent = this.normalizeText(currentSelection || '');
            const normalizedOptionText = this.normalizeText(option?.text || option?.element?.textContent || '');
            const normalizedDataValue = this.normalizeText(option?.element?.getAttribute?.('data-value') || '');

            if (!normalizedCurrent) {
                return false;
            }

            const candidates = [normalizedOptionText, normalizedDataValue].filter(Boolean);
            if (candidates.some(candidate =>
                normalizedCurrent === candidate ||
                normalizedCurrent.includes(candidate) ||
                candidate.includes(normalizedCurrent)
            )) {
                return true;
            }

            if (fieldType === 'phoneCountryCode') {
                const phoneSignals = ['united states', 'usa', 'us', '1'];
                return phoneSignals.every(signal => {
                    if (signal === '1') {
                        return normalizedCurrent.includes('1') || candidates.some(candidate => candidate.includes('1'));
                    }
                    return normalizedCurrent.includes(signal) || candidates.some(candidate => candidate.includes(signal));
                }) ||
                ((normalizedCurrent === 'us' || normalizedCurrent === 'usa' || normalizedCurrent === '1') &&
                    candidates.some(candidate => candidate.includes('united states') || candidate.includes('usa') || candidate.includes('1')));
            }

            return false;
        },

        getCustomComboboxIdentity(control) {
            const resolvedControl = this.resolveCustomComboboxControl(control) || control;
            if (!resolvedControl?.dataset) {
                return resolvedControl?.getAttribute?.('id') || resolvedControl?.getAttribute?.('aria-labelledby') || resolvedControl?.getAttribute?.('aria-label') || '';
            }

            if (!resolvedControl.dataset.jobAutofillComboboxId) {
                this.comboboxIdentityCounter = (this.comboboxIdentityCounter || 0) + 1;
                resolvedControl.dataset.jobAutofillComboboxId = `jobautofill-combobox-${this.comboboxIdentityCounter}`;
            }

            return resolvedControl.dataset.jobAutofillComboboxId;
        },

        getCustomComboboxInputElements() {
            const selector = [
                'input[type="text"]',
                'input[type="search"]',
                'input[role="combobox"]',
                'input[aria-autocomplete="list"]',
                '[role="combobox"] input',
                '[aria-haspopup="listbox"] input'
            ].join(', ');

            return Array.from(document.querySelectorAll(selector)).filter(input => {
                if (!input || !input.isConnected) return false;
                if (!FieldDetector.isCustomComboboxInput(input)) return false;
                return this.isElementVisiblyRendered(input);
            });
        },

        resolveComboboxRootFromInput(input) {
            if (!input || !input.isConnected || !FieldDetector.isCustomComboboxInput(input)) {
                return null;
            }

            const selectorCandidates = [
                `.${GREENHOUSE_SELECT_CLASSES.control}`,
                '[role="combobox"]',
                '[aria-haspopup="listbox"]',
                '.select__value-container',
                '[class*="select"][class*="control"]',
                '[class*="select"][class*="container"]',
                '[class*="dropdown"]',
                '[class*="combobox"]'
            ];

            for (const selector of selectorCandidates) {
                const candidate = input.closest(selector);
                if (candidate && candidate.tagName !== 'SELECT') {
                    return candidate;
                }
            }

            let current = input.parentElement;
            let depth = 0;

            while (current && depth < 6) {
                const style = window.getComputedStyle(current);
                const hasDropdownHint =
                    current.getAttribute('aria-haspopup') === 'listbox' ||
                    current.hasAttribute('aria-expanded') ||
                    current.querySelector('svg, [class*="icon"], [class*="arrow"], [class*="chevron"], input[type="hidden"]');

                if (style.display !== 'none' && style.visibility !== 'hidden' && hasDropdownHint) {
                    return current;
                }

                current = current.parentElement;
                depth += 1;
            }

            return input.parentElement || input;
        },

        getCustomComboboxElements() {
            const selector = [
                '[role="combobox"]',
                'button[aria-haspopup="listbox"]',
                '[aria-haspopup="listbox"][aria-expanded]',
                `.${GREENHOUSE_SELECT_CLASSES.control}`,
                `.${GREENHOUSE_SELECT_CLASSES.control} input`,
                'input[role="combobox"]',
                'input[aria-autocomplete="list"]',
                '[role="combobox"] input',
                '[aria-haspopup="listbox"] input',
                `.${GREENHOUSE_SELECT_CLASSES.indicator}`,
                '[data-testid*="select"] button',
                '[data-qa*="select"] button'
            ].join(', ');

            const controls = [];
            const seen = new Set();

            for (const element of document.querySelectorAll(selector)) {
                if (!element || !element.isConnected) continue;
                if (element.tagName === 'SELECT') continue;

                const control = this.resolveCustomComboboxControl(element);
                if (!control) continue;

                const identity = control.getAttribute('id') || control.getAttribute('aria-labelledby') || control.outerHTML.slice(0, 180);
                if (seen.has(identity)) continue;

                seen.add(identity);
                controls.push(control);
            }

            for (const input of this.getCustomComboboxInputElements()) {
                const control = this.resolveCustomComboboxControl(input);
                if (!control) continue;

                const identity = control.getAttribute('id') || control.getAttribute('aria-labelledby') || control.outerHTML.slice(0, 180);
                if (seen.has(identity)) continue;

                seen.add(identity);
                controls.push(control);
            }

            for (const element of this.getFallbackCustomComboboxElements()) {
                const control = this.resolveCustomComboboxControl(element);
                if (!control) continue;

                const identity = control.getAttribute('id') || control.getAttribute('aria-labelledby') || control.outerHTML.slice(0, 180);
                if (seen.has(identity)) continue;

                seen.add(identity);
                controls.push(control);
            }

            return controls.filter(control => {
                const style = window.getComputedStyle(control);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }
                return control.offsetParent !== null || control.getClientRects().length > 0;
            });
        },

        getFallbackCustomComboboxElements() {
            const candidates = [];
            const seen = new Set();
            const selector = [
                'button',
                '[role="button"]',
                '[tabindex]',
                '[aria-expanded]',
                '[aria-haspopup]',
                '[class*="select"]',
                '[class*="dropdown"]',
                '[class*="control"]',
                '[class*="trigger"]'
            ].join(', ');

            for (const candidate of document.querySelectorAll(selector)) {
                if (!candidate || !candidate.isConnected) continue;
                if (candidate.tagName === 'SELECT' || candidate.matches('input, textarea')) continue;
                if (!this.looksLikeGenericSelectControl(candidate)) continue;

                const identity =
                    candidate.getAttribute('id') ||
                    candidate.getAttribute('aria-labelledby') ||
                    candidate.getAttribute('aria-label') ||
                    candidate.outerHTML.slice(0, 180);
                if (seen.has(identity)) continue;

                seen.add(identity);
                candidates.push(candidate);
            }

            return candidates;
        },

        looksLikeGenericSelectControl(element) {
            if (!element) {
                return false;
            }

            const tagName = (element.tagName || '').toLowerCase();
            if (['a', 'span', 'p', 'label'].includes(tagName)) {
                return false;
            }

            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            const normalizedText = this.normalizeText(text);
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }

            if (rect.width < 80 || rect.height < 20 || rect.height > 90) {
                return false;
            }

            const hasPlaceholderText = ['select', 'choose', 'please select', 'please choose'].some(signal =>
                normalizedText === signal || normalizedText.startsWith(signal)
            );
            const hasDropdownHint =
                element.getAttribute('aria-haspopup') === 'listbox' ||
                element.hasAttribute('aria-expanded') ||
                element.getAttribute('role') === 'combobox' ||
                element.getAttribute('role') === 'button' ||
                element.hasAttribute('tabindex') ||
                element.querySelector('svg, [class*="icon"], [class*="arrow"], [class*="chevron"]') ||
                element.querySelector('input[type="hidden"]');

            const contextText = element
                .closest('fieldset, section, article, [class*="question"], [class*="field"], [class*="form-item"], [class*="form-group"]')
                ?.textContent?.slice(0, 500) || '';
            const likelyQuestionContext = this.inferStructuredChoiceFieldType(contextText);

            return Boolean(hasDropdownHint && (hasPlaceholderText || likelyQuestionContext));
        },

        sortElementsTopToBottom(elements) {
            return [...elements].sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                const topDelta = Math.abs(leftRect.top - rightRect.top);

                if (topDelta > 6) {
                    return leftRect.top - rightRect.top;
                }

                if (Math.abs(leftRect.left - rightRect.left) > 6) {
                    return leftRect.left - rightRect.left;
                }

                const relation = left.compareDocumentPosition(right);
                if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
                    return -1;
                }
                if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
                    return 1;
                }

                return 0;
            });
        },

        resolveCustomComboboxControl(element) {
            if (!element || !element.isConnected) return null;

            if ((element.tagName || '').toLowerCase() === 'input' && FieldDetector.isCustomComboboxInput(element)) {
                return this.resolveComboboxRootFromInput(element);
            }

            const root =
                element.closest(`.${GREENHOUSE_SELECT_CLASSES.control}`) ||
                element.closest('[role="combobox"]') ||
                element.closest('button[aria-haspopup="listbox"]') ||
                element.closest('[aria-haspopup="listbox"]');

            if (root && root.tagName !== 'SELECT') {
                return root;
            }

            if (this.looksLikeGenericSelectControl(element)) {
                return element;
            }

            return null;
        },

        getCustomComboboxContextRoot(control) {
            const resolvedControl = this.resolveCustomComboboxControl(control) || control;
            return this.findQuestionContainer(resolvedControl) ||
                resolvedControl.closest('fieldset, section, article, [class*="question"], [class*="field"], [class*="form-group"], [class*="form-item"]') ||
                resolvedControl.parentElement ||
                resolvedControl;
        },

        isElementVisiblyRendered(element) {
            if (!element) {
                return false;
            }

            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }

            const rect = element.getBoundingClientRect();
            return (rect.width > 0 && rect.height > 0) || element.getClientRects().length > 0;
        },

        isCustomComboboxUnanswered(control) {
            const root = this.resolveCustomComboboxControl(control) || control;
            const selectedValue = this.getCustomComboboxSelectedValue(root);
            if (selectedValue) {
                return false;
            }

            const placeholderText = this.normalizeText(this.getCustomComboboxPlaceholderText(root));
            if (!placeholderText) {
                return true;
            }

            const placeholderSignals = ['select', 'choose', 'please select', 'please choose', 'open', 'options'];
            return placeholderSignals.some(signal => placeholderText === signal || placeholderText.startsWith(signal));
        },

        getCustomComboboxSelectionText(control) {
            if (!control) return '';

            const root = this.resolveCustomComboboxControl(control) || control;

            const selectedValue = this.getCustomComboboxSelectedValue(root);
            if (selectedValue) {
                return selectedValue;
            }

            const placeholderText = this.getCustomComboboxPlaceholderText(root);
            if (placeholderText) {
                return placeholderText;
            }

            return root.textContent?.trim() || '';
        },

        getCustomComboboxSelectedValue(control) {
            if (!control) return '';

            const root = this.resolveCustomComboboxControl(control) || control;

            const hiddenValue = Array.from(root.querySelectorAll('input[type="hidden"]'))
                .map(input => input.value?.trim() || '')
                .find(Boolean);
            if (hiddenValue) {
                return hiddenValue;
            }

            const visibleValue = root.querySelector('.select__single-value, [class*="single-value"], [class*="valueContainer"] [class*="single"], [data-value]');
            if (visibleValue?.textContent?.trim()) {
                return visibleValue.textContent.trim();
            }

            const textInput = root.querySelector('input[type="text"]');
            if (textInput?.value?.trim()) {
                return textInput.value.trim();
            }

            return '';
        },

        getCustomComboboxPlaceholderText(control) {
            if (!control) return '';

            const root = this.resolveCustomComboboxControl(control) || control;

            const placeholderNode = root.querySelector('.select__placeholder, [class*="placeholder"]');
            if (placeholderNode?.textContent?.trim()) {
                return placeholderNode.textContent.trim();
            }

            const textInput = root.querySelector('input[type="text"]');
            if (textInput?.placeholder?.trim()) {
                return textInput.placeholder.trim();
            }

            const ariaLabel = root.getAttribute('aria-label') || '';
            if (ariaLabel.trim()) {
                return ariaLabel.trim();
            }

            return '';
        },

        identifyCustomChoiceFieldType(control) {
            const resolvedControl = this.resolveCustomComboboxControl(control) || control;
            const detectedFieldTypes = this.getCustomComboboxDetectedFieldTypes(resolvedControl);
            if (detectedFieldTypes.length === 1) {
                return detectedFieldTypes[0];
            }
            const controlText = (this.getCustomComboboxSelectionText(resolvedControl) || resolvedControl.textContent || '').toLowerCase();
            const ariaLabel = (resolvedControl.getAttribute('aria-label') || '').toLowerCase();
            const labelledBy = FieldDetector.getAriaLabelledByText(resolvedControl).toLowerCase();
            const root = this.getCustomComboboxContextRoot(resolvedControl);
            const nearbyInputs = Array.from(root.querySelectorAll('input[type="hidden"], input[name], input[id]'));
            const relatedSignals = nearbyInputs
                .filter(input => input !== resolvedControl)
                .map(input => [input.name || '', input.id || '', input.getAttribute('aria-label') || ''].join(' '))
                .join(' ')
                .toLowerCase();
            const contextText = (root.textContent || '').toLowerCase().slice(0, 350);
            const questionFirstType = this.inferStructuredChoiceFieldType(labelledBy, ariaLabel, contextText);
            if (questionFirstType) {
                return questionFirstType;
            }

            return this.inferStructuredChoiceFieldType(controlText, relatedSignals, contextText);
        },

        async getComboboxOptions(control) {
            if (!control) return [];

            const resolvedControl = this.resolveCustomComboboxControl(control) || control;

            await this.openCustomCombobox(resolvedControl);

            const options = await this.waitForVisibleElements(() => {
                return this.findVisibleComboboxOptions(resolvedControl);
            }, {
                timeoutMs: 2000,
                intervalMs: 150
            });

            const resolvedOptions = options.map(option => ({
                text: (option.textContent || '').replace(/\s+/g, ' ').trim(),
                element: option
            })).filter(option => option.text && !this.isPlaceholderOption(option.text));

            const resolvedFieldType = this.identifyCustomChoiceFieldType(resolvedControl) ||
                this.inferComboboxFieldTypeFromOptions(resolvedControl, resolvedOptions);

            this.recordDebugEvent('custom-combobox-options', resolvedOptions.length > 0 ? 'filled' : 'skipped', {
                fieldType: resolvedFieldType,
                element: resolvedControl,
                reason: resolvedOptions.length > 0 ? `found-${resolvedOptions.length}-visible-options` : 'no-visible-options-found',
                source: 'profile-or-ai',
                options: resolvedOptions.map(option => option.text)
            });

            return resolvedOptions;
        },

        async openCustomCombobox(control) {
            const root = this.resolveCustomComboboxControl(control) || control;

            const indicator = root.querySelector(`.${GREENHOUSE_SELECT_CLASSES.indicator}`);
            const input = root.querySelector(`input.${GREENHOUSE_SELECT_CLASSES.input}, .${GREENHOUSE_SELECT_CLASSES.input} input, input[type="text"]`);

            if (root.getAttribute('aria-expanded') !== 'true' && control.getAttribute('aria-expanded') !== 'true') {
                const targets = [control, root, indicator, input].filter(Boolean);

                for (const target of targets) {
                    if (root.getAttribute('aria-expanded') === 'true' || control.getAttribute('aria-expanded') === 'true') {
                        break;
                    }

                    this.clickElement(target);
                    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                }
            }

            if (root.getAttribute('aria-expanded') === 'true' || control.getAttribute('aria-expanded') === 'true') {
                return;
            }

            if (input) {
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
                input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
            } else {
                root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
                root.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
            }
        },

        getScopedVisibleComboboxListboxes(control) {
            const root = this.resolveCustomComboboxControl(control) || control;
            const listboxIds = [
                root.getAttribute('aria-controls'),
                root.getAttribute('aria-owns'),
                root.querySelector('input[aria-controls]')?.getAttribute('aria-controls'),
                root.querySelector('input[aria-owns]')?.getAttribute('aria-owns')
            ].filter(Boolean);
            const explicitListboxes = listboxIds.flatMap(listboxId => listboxId.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean));
            const visibleListboxes = Array.from(document.querySelectorAll(
                `[role="listbox"], [data-reach-listbox-popover], [class*="listbox"], [class*="menu"], .${GREENHOUSE_SELECT_CLASSES.menu}`
            ));
            const listboxes = [...new Set([...explicitListboxes, ...visibleListboxes])].filter(listbox => this.isElementVisiblyRendered(listbox));

            const rootRect = root.getBoundingClientRect();
            return listboxes
                .map(listbox => {
                    const rect = listbox.getBoundingClientRect();
                    const horizontalDistance = Math.abs(rect.left - rootRect.left);
                    const verticalDistance = rect.top >= rootRect.top
                        ? rect.top - rootRect.top
                        : rootRect.top - rect.bottom;
                    const score = horizontalDistance + verticalDistance;
                    const containsActiveDescendant = Boolean(root.getAttribute('aria-activedescendant')) &&
                        listbox.querySelector(`#${CSS.escape(root.getAttribute('aria-activedescendant'))}`);
                    const isExplicit = explicitListboxes.includes(listbox);

                    return {
                        listbox,
                        score: isExplicit ? score - 1000 : containsActiveDescendant ? score - 500 : score
                    };
                })
                .sort((left, right) => left.score - right.score)
                .slice(0, 2)
                .map(item => item.listbox);
        },

        getVisibleComboboxEmptyState(control) {
            const emptyStateSignals = [
                'no matches found',
                'no match found',
                'no results found',
                'no results',
                'no options'
            ];

            for (const listbox of this.getScopedVisibleComboboxListboxes(control)) {
                const nodes = [listbox, ...Array.from(listbox.querySelectorAll('*'))];
                for (const node of nodes) {
                    if (!this.isElementVisiblyRendered(node)) {
                        continue;
                    }

                    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                    const normalizedText = this.normalizeText(text);
                    if (!normalizedText) {
                        continue;
                    }

                    if (emptyStateSignals.some(signal => normalizedText.includes(signal))) {
                        return text;
                    }
                }
            }

            return '';
        },

        async waitForComboboxState(control, options = {}) {
            const timeoutMs = options.timeoutMs || 1500;
            const intervalMs = options.intervalMs || 150;
            const minWaitMs = options.minWaitMs || 0;
            const startedAt = Date.now();

            while (Date.now() - startedAt < timeoutMs) {
                const visibleOptions = this.findVisibleComboboxOptions(control);
                if (visibleOptions.length > 0) {
                    return { options: visibleOptions, emptyStateText: '' };
                }

                const emptyStateText = this.getVisibleComboboxEmptyState(control);
                if (emptyStateText && (Date.now() - startedAt) >= minWaitMs) {
                    return { options: [], emptyStateText };
                }

                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }

            return {
                options: this.findVisibleComboboxOptions(control),
                emptyStateText: this.getVisibleComboboxEmptyState(control)
            };
        },

        setComboboxSearchValue(control, value) {
            const root = this.resolveCustomComboboxControl(control) || control;
            const input = root.querySelector(`input.${GREENHOUSE_SELECT_CLASSES.input}, .${GREENHOUSE_SELECT_CLASSES.input} input, input[type="text"], input[type="search"]`);
            if (!input) {
                return null;
            }

            input.focus?.();
            this.setElementValue(input, value);
            this.dispatchValueEvents(input, { emitFocus: false, emitBlur: false });
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
            return input;
        },

        findVisibleComboboxOptions(control) {
            const root = this.resolveCustomComboboxControl(control) || control;
            const scopedListboxes = this.getScopedVisibleComboboxListboxes(root);

            const optionSelector = `[role="option"], li, button, [data-option], [data-value], .${GREENHOUSE_SELECT_CLASSES.option}`;
            const options = [];
            for (const listbox of scopedListboxes) {
                for (const option of listbox.querySelectorAll(optionSelector)) {
                    const text = (option.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!this.isElementVisiblyRendered(option)) continue;
                    if (!text || text.length > 120) continue;
                    options.push(option);
                }
            }

            return options;
        },

        async fillAiChoiceFields() {
            const aiSettings = this.settings?.aiAssist;
            if (!aiSettings?.enabled) {
                return;
            }

            const candidates = this.collectAiChoiceCandidates();
            if (candidates.length === 0) {
                return;
            }

            console.log(`[JobAutofill] Found ${candidates.length} AI choice candidates`);

            const jobPostingText = this.extractJobPostingText();
            const pageTitle = document.title || '';
            const batchedCandidates = [];

            for (const candidate of candidates) {
                const resolvedFieldType = candidate.detectedFieldType || this.inferStructuredChoiceFieldType(
                    candidate.question,
                    candidate.label,
                    candidate.helperText,
                    candidate.sectionContext,
                    candidate.options,
                    candidate.element?.name,
                    candidate.element?.id,
                    candidate.element?.getAttribute?.('aria-label') || '',
                    candidate.element?.getAttribute?.('aria-labelledby') || ''
                );

                if (resolvedFieldType && resolvedFieldType !== candidate.detectedFieldType) {
                    candidate.detectedFieldType = resolvedFieldType;
                }

                if (candidate.singleOptionAutoApply && candidate.options.length === 1) {
                    const applied = this.applyChoiceCandidateOption(candidate, candidate.options[0], 'rule');

                    if (applied) {
                        this.filledFields.push({ type: 'aiChoiceField', element: candidate.options[0].element });
                        this.highlightField(candidate.options[0].element, true);
                    }
                    continue;
                }

                if (candidate.type === 'checkbox') {
                    const preferredOptions = this.findPreferredCheckboxOptions(candidate.options, candidate.detectedFieldType);
                    if (preferredOptions.length > 0) {
                        let appliedAny = false;

                        for (const preferredOption of preferredOptions) {
                            if (!this.applyChoiceCandidateOption(candidate, preferredOption, 'profile')) {
                                continue;
                            }

                            appliedAny = true;
                            this.filledFields.push({ type: candidate.detectedFieldType || 'aiChoiceField', element: preferredOption.element });
                            this.highlightField(preferredOption.element, true);
                        }

                        if (appliedAny) {
                            continue;
                        }
                    }
                }

                const preferredOption = this.findPreferredChoiceOption(candidate.options, candidate.detectedFieldType);
                if (preferredOption) {
                    if (this.applyChoiceCandidateOption(candidate, preferredOption, 'profile')) {
                        this.filledFields.push({ type: candidate.detectedFieldType || 'aiChoiceField', element: preferredOption.element });
                        this.highlightField(preferredOption.element, true);
                    }
                    continue;
                }

                const resumeBackedOption = this.findResumeBackedChoiceOption(candidate);
                if (resumeBackedOption) {
                    if (this.applyChoiceCandidateOption(candidate, resumeBackedOption, 'resume')) {
                        this.filledFields.push({ type: candidate.detectedFieldType || 'aiChoiceField', element: resumeBackedOption.element });
                        this.highlightField(resumeBackedOption.element, true);
                    }
                    continue;
                }

                batchedCandidates.push(candidate);
            }

            if (batchedCandidates.length === 0) {
                return;
            }

            const groups = this.groupAiCandidates(batchedCandidates, candidate => ({
                payload: {
                    question: candidate.question,
                    fieldLabel: candidate.label,
                    helperText: candidate.helperText,
                    sectionContext: candidate.sectionContext,
                    detectedFieldType: candidate.detectedFieldType || '',
                    preferredProfileAnswer: this.getPreferredProfileAnswer(candidate.detectedFieldType) || '',
                    choiceOptions: candidate.options.map(option => option.text),
                    fieldHtmlType: candidate.type,
                    pageTitle,
                    jobPostingText
                },
                debugMeta: {
                    fieldType: candidate.detectedFieldType || 'aiChoiceField',
                    element: candidate.element
                }
            }));
            const limit = Math.max(1, Math.min(aiSettings.maxQuestionsPerRun || 10, groups.length));
            const selectedGroups = groups.slice(0, limit);
            const responses = await this.requestAiAnswersBatch(selectedGroups.map(group => ({
                payload: group.payload,
                debugMeta: group.debugMeta
            })));

            for (let index = 0; index < selectedGroups.length; index += 1) {
                const group = selectedGroups[index];
                const response = responses[index];
                try {
                    for (const candidate of group.targets) {
                        if (!response?.success || !response.answer) {
                            continue;
                        }

                        const matchedOption = this.findBestAiChoiceMatch(candidate.options, response.answer);
                        if (!matchedOption) {
                            continue;
                        }

                        const preferredProfileAnswer = this.getPreferredProfileAnswer(candidate.detectedFieldType);
                        const preferredOption = preferredProfileAnswer && candidate.detectedFieldType
                            ? this.findStructuredChoiceOption(candidate.options, candidate.detectedFieldType, preferredProfileAnswer, FieldDetector.patterns[candidate.detectedFieldType]?.options || {})
                            : null;
                        const finalOption = this.isOptionCompatibleWithProfileAnswer(matchedOption, candidate.detectedFieldType, preferredProfileAnswer)
                            ? matchedOption
                            : preferredOption;

                        if (!finalOption) {
                            this.recordDebugEvent('ai-choice', 'skipped', {
                                fieldType: candidate.detectedFieldType,
                                element: candidate.element,
                                reason: 'ai-answer-conflicted-with-profile-and-no-safe-fallback',
                                source: 'ai'
                            });
                            continue;
                        }

                        const applied = this.applyChoiceCandidateOption(candidate, finalOption, 'ai');

                        if (applied) {
                            this.filledFields.push({ type: 'aiChoiceField', element: finalOption.element });
                            this.highlightField(finalOption.element, true);
                        }
                    }
                } catch (error) {
                    console.warn('[JobAutofill] AI choice selection failed:', error);
                }
            }
        },

        collectAiChoiceCandidates() {
            return [
                ...this.collectAiSelectCandidates(),
                ...this.collectAiRadioCandidates(),
                ...this.collectAiCheckboxCandidates()
            ];
        },

        collectAiSelectCandidates() {
            const selects = Array.from(document.querySelectorAll('select'));
            const candidates = [];

            for (const select of selects) {
                if (!this.isElementAllowed(select) || select.disabled) continue;
                if (select.value && select.selectedIndex > 0) continue;

                const context = this.getChoiceFieldContext(select);
                if (!context.question) continue;
                if (!this.looksLikeChoiceQuestion(context.question, context.sectionContext) && !context.label) continue;

                const options = this.getSelectableOptions(select);

                const isAcknowledgement = this.isAcknowledgementQuestion(context.question, context.sectionContext, context.label);
                if (options.length > 12) continue;
                if (options.length < 2 && !(isAcknowledgement && options.length === 1)) continue;

                candidates.push({
                    type: 'select',
                    element: select,
                    question: context.question,
                    label: context.label,
                    helperText: context.helperText,
                    sectionContext: context.sectionContext,
                    detectedFieldType: this.inferEducationChoiceFieldType(
                        context.question,
                        context.label,
                        context.helperText,
                        context.sectionContext,
                        options
                    ) || FieldDetector.identifyFieldType(select)
                        || this.inferComboboxFieldTypeFromOptions(select, options)
                        || this.inferStructuredChoiceFieldType(context.question, context.label, context.sectionContext),
                    options,
                    singleOptionAutoApply: isAcknowledgement && options.length === 1
                });
            }

            return candidates;
        },

        collectAiRadioCandidates() {
            const groups = new Map();

            for (const radio of document.querySelectorAll('input[type="radio"]')) {
                const key = this.getChoiceGroupKey(radio) || radio.name || this.normalizeText(FieldDetector.getQuestionText(radio)) || `radio-${groups.size}`;
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key).push(radio);
            }

            const candidates = [];
            for (const radios of groups.values()) {
                if (radios.some(radio => radio.checked)) continue;
                if (radios.some(radio => !this.isElementAllowed(radio) || radio.disabled)) continue;

                const context = this.getChoiceFieldContext(radios[0]);
                if (!context.question) continue;
                if (!this.looksLikeChoiceQuestion(context.question, context.sectionContext) && !context.label) continue;

                const options = radios
                    .map(radio => ({ text: FieldDetector.getChoiceLabelText(radio).trim(), element: radio }))
                    .filter(option => option.text && !this.isPlaceholderOption(option.text));

                if (options.length < 2 || options.length > 8) continue;

                candidates.push({
                    type: 'radio',
                    element: radios[0],
                    question: context.question,
                    label: context.label,
                    helperText: context.helperText,
                    sectionContext: context.sectionContext,
                    detectedFieldType: this.inferComboboxFieldTypeFromOptions(radios[0], options)
                        || this.inferStructuredChoiceFieldType(context.question, context.label, context.sectionContext),
                    options
                });
            }

            return candidates;
        },

        collectAiCheckboxCandidates() {
            const groups = new Map();

            for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
                const key = this.getChoiceGroupKey(checkbox) || checkbox.name || this.normalizeText(FieldDetector.getQuestionText(checkbox)) || `checkbox-${groups.size}`;
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key).push(checkbox);
            }

            const candidates = [];
            for (const checkboxes of groups.values()) {
                if (checkboxes.every(checkbox => checkbox.checked)) continue;
                if (checkboxes.some(checkbox => !this.isElementAllowed(checkbox) || checkbox.disabled)) continue;

                const context = this.getChoiceFieldContext(checkboxes[0]);
                const normalizedQuestion = this.normalizeText(context.question || '');
                if (!context.question) continue;
                if (!this.looksLikeChoiceQuestion(context.question, context.sectionContext) && !context.label) continue;
                if ((normalizedQuestion.includes('terms') || normalizedQuestion.includes('privacy') || normalizedQuestion.includes('consent')) && !this.isAcknowledgementQuestion(context.question, context.sectionContext, context.label)) continue;

                const options = checkboxes
                    .filter(checkbox => !checkbox.checked)
                    .map(checkbox => ({ text: FieldDetector.getChoiceLabelText(checkbox).trim(), element: checkbox }))
                    .filter(option => option.text && !this.isPlaceholderOption(option.text));

                const isAcknowledgement = this.isAcknowledgementQuestion(context.question, context.sectionContext, context.label);

                if (options.length > 16) continue;
                if (options.length < 2 && !(isAcknowledgement && options.length === 1)) continue;

                candidates.push({
                    type: 'checkbox',
                    element: checkboxes[0],
                    question: context.question,
                    label: context.label,
                    helperText: context.helperText,
                    sectionContext: context.sectionContext,
                    detectedFieldType: this.inferComboboxFieldTypeFromOptions(checkboxes[0], options)
                        || this.inferStructuredChoiceFieldType(context.question, context.label, context.sectionContext),
                    options,
                    singleOptionAutoApply: isAcknowledgement && options.length === 1
                });
            }

            return candidates;
        },

        looksLikeChoiceQuestion(question, sectionContext) {
            const normalizedQuestion = this.normalizeText(question || '');
            const normalizedContext = this.normalizeText(sectionContext || '');
            const negativeSignals = ['resume', 'upload', 'drag and drop', 'subscribe', 'job alert'];
            if (negativeSignals.some(signal => normalizedQuestion.includes(signal) || normalizedContext.includes(signal))) {
                return false;
            }

            return normalizedQuestion.length >= 6;
        },

        isAcknowledgementQuestion(question, sectionContext, label = '') {
            const normalized = this.normalizeText([question, sectionContext, label].filter(Boolean).join(' '));
            if (!normalized) {
                return false;
            }

            const acknowledgementSignals = [
                'privacy policy', 'candidate privacy', 'ai guidelines', 'guidelines', 'acknowledge',
                'confirm', 'i have read', 'i agree', 'please select yes', 'consent'
            ];

            return acknowledgementSignals.some(signal => normalized.includes(signal));
        },

        isPlaceholderOption(text) {
            const normalizedText = this.normalizeText(text);
            return ['select', 'choose', 'please select', 'please choose'].some(prefix => normalizedText === prefix || normalizedText.startsWith(prefix));
        },

        getSelectableOptions(select) {
            if (!select) {
                return [];
            }

            return Array.from(select.options)
                .map((optionElement, index) => ({
                    text: (optionElement.textContent || '').trim(),
                    value: optionElement.value,
                    element: optionElement,
                    index
                }))
                .filter(option => option.text && !option.element.disabled && !this.isPlaceholderOption(option.text));
        },

        findBestAiChoiceMatch(options, answer) {
            const normalizedAnswer = this.normalizeText(answer);
            const binaryOptions = this.getBinaryChoiceOptions(options);

            if (binaryOptions.yes && binaryOptions.no) {
                const answerPolarity = this.getBinaryAnswerPolarity(normalizedAnswer);
                if (answerPolarity === 'yes') {
                    return binaryOptions.yes;
                }

                if (answerPolarity === 'no') {
                    return binaryOptions.no;
                }
            }

            let bestMatch = null;
            let bestScore = -1;

            for (const option of options) {
                const normalizedText = this.normalizeText(option.text);
                let score = 0;

                if (normalizedText === normalizedAnswer) {
                    score += 20;
                }
                if (normalizedAnswer.includes(normalizedText) || normalizedText.includes(normalizedAnswer)) {
                    score += 12;
                }

                const answerTokens = new Set(normalizedAnswer.split(' ').filter(Boolean));
                const optionTokens = normalizedText.split(' ').filter(Boolean);
                for (const token of optionTokens) {
                    if (answerTokens.has(token)) {
                        score += 2;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = option;
                }
            }

            return bestScore > 0 ? bestMatch : null;
        },

        getBinaryChoiceOptions(options = []) {
            if (!Array.isArray(options) || options.length === 0) {
                return { yes: null, no: null };
            }

            const yes = options.find(option => {
                const normalizedText = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                return normalizedText === 'yes' || normalizedText.startsWith('yes ') || normalizedText === 'true';
            }) || null;

            const no = options.find(option => {
                const normalizedText = this.normalizeText(option?.text || option?.textContent || option?.value || '');
                return normalizedText === 'no' || normalizedText.startsWith('no ') || normalizedText === 'false';
            }) || null;

            return { yes, no };
        },

        getBinaryAnswerPolarity(answer = '') {
            const normalizedAnswer = this.normalizeText(answer);
            if (!normalizedAnswer) {
                return null;
            }

            const negativeSignals = [
                'no',
                'not',
                'do not',
                'don t',
                'have not',
                'haven t',
                'without experience',
                'no experience',
                'cannot',
                'can t'
            ];

            if (negativeSignals.some(signal => normalizedAnswer === signal || normalizedAnswer.startsWith(`${signal} `) || normalizedAnswer.includes(` ${signal} `))) {
                return 'no';
            }

            if (/\b\d+(?:\.\d+)?\s+years?\b/.test(normalizedAnswer)) {
                return 'yes';
            }

            const positiveSignals = [
                'yes',
                'i have',
                'have experience',
                'experienced',
                'familiar',
                'proficient',
                'knowledge',
                'worked with',
                'used',
                'can',
                'comfortable'
            ];

            if (positiveSignals.some(signal => normalizedAnswer === signal || normalizedAnswer.startsWith(`${signal} `) || normalizedAnswer.includes(` ${signal} `))) {
                return 'yes';
            }

            return null;
        },

        findResumeBackedChoiceOption(candidate) {
            if (!candidate || !Array.isArray(candidate.options) || candidate.options.length === 0) {
                return null;
            }

            const binaryOptions = this.getBinaryChoiceOptions(candidate.options);
            if (!binaryOptions.yes || !binaryOptions.no) {
                return null;
            }

            const assessment = this.getResumeExperienceAssessment({
                question: candidate.question,
                fieldLabel: candidate.label,
                helperText: candidate.helperText,
                sectionContext: candidate.sectionContext
            });

            if (!assessment) {
                return null;
            }

            if (assessment.minimumYears !== null) {
                return assessment.qualified ? binaryOptions.yes : null;
            }

            if (!assessment.matchedEvidence || assessment.matchedEvidence.length === 0) {
                return null;
            }

            return binaryOptions.yes;
        },

        applySelectOption(select, option, context = {}) {
            if (!select || !option) {
                this.recordDebugEvent('select', 'skipped', {
                    fieldType: context.fieldType,
                    element: select,
                    reason: !select ? 'missing-select' : 'missing-option',
                    source: context.source
                });
                return false;
            }

            const blockReason = this.getElementFillBlockReason(select);
            if (blockReason && blockReason !== 'already-has-value') {
                this.recordDebugEvent('select', 'skipped', {
                    fieldType: context.fieldType,
                    element: select,
                    reason: blockReason,
                    source: context.source
                });
                return false;
            }

            if (select.value && select.selectedIndex > 0) {
                this.recordDebugEvent('select', 'skipped', {
                    fieldType: context.fieldType,
                    element: select,
                    reason: 'already-selected',
                    source: context.source
                });
                return false;
            }

            const optionElement = option instanceof HTMLOptionElement ? option : option.element;
            const optionIndex = typeof option.index === 'number'
                ? option.index
                : optionElement
                    ? Array.from(select.options).indexOf(optionElement)
                    : -1;
            const optionValue = optionElement ? optionElement.value : option.value;

            if (optionIndex >= 0) {
                select.selectedIndex = optionIndex;
            }

            if (typeof optionValue !== 'undefined') {
                select.value = optionValue;
            }

            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            const applied = optionIndex >= 0
                ? select.selectedIndex === optionIndex
                : select.value === optionValue;

            this.recordDebugEvent('select', applied ? 'filled' : 'skipped', {
                fieldType: context.fieldType,
                element: select,
                reason: applied ? 'selected-option' : 'select-value-did-not-stick',
                value: optionElement?.textContent?.trim() || option.text || optionValue || '',
                source: context.source
            });

            return applied;
        },

        applyChoiceCandidateOption(candidate, option, source = 'ai') {
            if (!candidate || !option) {
                return false;
            }

            if (candidate.type === 'select') {
                return this.applySelectOption(candidate.element, option.element || option, {
                    fieldType: candidate.detectedFieldType,
                    source
                });
            }

            return this.applyChoiceControl(option.element || option);
        },

        setCheckableInput(input) {
            if (!input || !this.isElementAllowed(input) || input.disabled) {
                return false;
            }

            const wasChecked = input.checked;
            input.checked = true;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('click', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            if (!input.checked && !wasChecked) {
                this.clickElement(input);
            }

            if (!input.checked) {
                const label = input.labels?.[0] || input.closest('label');
                if (label) {
                    this.clickElement(label);
                }
            }

            if (!input.checked) {
                return false;
            }

            this.highlightField(input, true);
            return true;
        },

        applyChoiceControl(control) {
            if (!control) return false;
            if (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')) {
                return this.setCheckableInput(control);
            }

            control.focus?.();
            control.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true }));
            control.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            control.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
            control.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

            const optionRoot = control.closest('[role="option"], li, button, [data-option], [data-value], .select__option');
            const selected = optionRoot?.getAttribute('aria-selected');
            return selected !== 'false';
        },

        findAiQuestionCandidates(detectedFields) {
            const mappedInputs = new Set(Object.values(detectedFields || {}).flat());
            const textInputs = document.querySelectorAll('textarea, input[type="text"], input:not([type])');
            const candidates = [];

            for (const input of textInputs) {
                if (mappedInputs.has(input)) {
                    continue;
                }

                if (!this.isElementAllowed(input) || input.disabled || input.readOnly) {
                    continue;
                }

                if (input.value && input.value.trim()) {
                    continue;
                }

                if (!this.isAiEligibleTextInput(input)) {
                    continue;
                }

                const context = this.getAiFieldContext(input);
                if (!context.question) {
                    continue;
                }

                candidates.push({
                    input,
                    question: context.question,
                    label: context.label,
                    helperText: context.helperText,
                    sectionContext: context.sectionContext
                });
            }

            return candidates;
        },

        isAiEligibleTextInput(input) {
            const inputType = (input.type || 'text').toLowerCase();
            if (!['text', 'search', ''].includes(inputType) && !(input instanceof HTMLTextAreaElement)) {
                return false;
            }

            const role = (input.getAttribute('role') || '').toLowerCase();
            const ariaAutocomplete = (input.getAttribute('aria-autocomplete') || '').toLowerCase();
            const className = typeof input.className === 'string' ? input.className.toLowerCase() : '';
            if (
                !(input instanceof HTMLTextAreaElement) && (
                    role === 'combobox' ||
                    Boolean(input.closest('[role="combobox"]')) ||
                    ariaAutocomplete === 'list' ||
                    ariaAutocomplete === 'both' ||
                    className.includes(GREENHOUSE_SELECT_CLASSES.input)
                )
            ) {
                return false;
            }

            const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
            if (autocomplete && !['on', 'off'].includes(autocomplete) && /(address-level|country|postal|organization|cc-|bday|sex)/.test(autocomplete)) {
                return false;
            }

            const allText = [
                FieldDetector.getLabelText(input),
                input.placeholder,
                input.getAttribute('aria-label'),
                FieldDetector.getAriaLabelledByText(input),
                input.name,
                input.id,
                input.closest('div, fieldset, section, article')?.textContent?.slice(0, 500) || ''
            ].filter(Boolean).join(' ').toLowerCase();

            if (/autogen|select2|react-select|tomselect|chosen|combobox|listbox/.test(`${input.name || ''} ${input.id || ''}`.toLowerCase())) {
                return false;
            }

            if (/resume|cv|cover letter\s*\*|upload|attachment|portfolio upload|drag and drop|drop files? here/.test(allText)) {
                return false;
            }

            const obviousStructuredPatterns = [
                'first name', 'last name', 'full name', 'email', 'phone', 'linkedin', 'city', 'state',
                'postal', 'zip', 'address', 'country', 'website', 'portfolio', 'github', 'salary'
            ];
            if (obviousStructuredPatterns.some(pattern => allText.includes(pattern))) {
                return false;
            }

            const likelyNonQuestionPatterns = [
                'search', 'filter', 'coupon', 'promo code', 'referral code', 'employee referral',
                'portfolio url', 'personal website', 'current company', 'school', 'university'
            ];
            if (likelyNonQuestionPatterns.some(pattern => allText.includes(pattern))) {
                return false;
            }

            const aiPromptPatterns = [
                'why', 'what', 'how', 'describe', 'tell us', 'tell me', 'superpower', 'kryptonite',
                'cover letter', 'summary', 'motivation', 'interested', 'excited', 'fit for this role',
                'experience', 'background', 'accomplishment', 'achievement', 'challenge', '?'
            ];

            const context = this.getAiFieldContext(input);
            const hasManualQuestionSignal = Boolean(context.question) && (
                this.looksLikeQuestionPrompt(context.question) ||
                this.looksLikeQuestionPrompt(context.sectionContext)
            );

            if (hasManualQuestionSignal) {
                return true;
            }

            return input instanceof HTMLTextAreaElement || aiPromptPatterns.some(pattern => allText.includes(pattern));
        },

        getAiFieldContext(input) {
            const labelText = FieldDetector.getLabelText(input);
            const ariaText = input.getAttribute('aria-label') || '';
            const questionText = FieldDetector.getQuestionText(input);
            const placeholder = input.placeholder || '';
            const ariaDescriptionText = this.getAriaDescribedByText(input);
            const inputType = (input.type || '').toLowerCase();
            const wrapper = ['checkbox', 'radio'].includes(inputType)
                ? (this.getChoiceGroupContainer(input) || this.findQuestionContainer(input))
                : this.findQuestionContainer(input);
            const sectionText = (wrapper?.textContent || '').replace(/\s+/g, ' ').trim();
            const visibleQuestion = this.extractQuestionSentence(sectionText);
            const helperText = this.extractHelperText(input, wrapper, [labelText, ariaText, questionText, visibleQuestion, placeholder]);

            const questionCandidates = [
                labelText,
                ariaText,
                questionText,
                ariaDescriptionText,
                visibleQuestion,
                placeholder
            ].map(text => this.coerceTextValue(text).replace(/\s+/g, ' ').trim()).filter(Boolean);

            const question = questionCandidates.find(text => this.looksLikeQuestionPrompt(text)) || questionCandidates[0] || '';

            return {
                label: labelText || ariaText || questionText || '',
                question,
                helperText,
                sectionContext: sectionText.slice(0, 350)
            };
        },

        findQuestionContainer(input) {
            const selectors = [
                '[data-testid*="question"]',
                '[data-qa*="question"]',
                '[class*="application"]',
                '[class*="question"]',
                '[class*="field"]',
                '[class*="form-item"]',
                '[class*="form-group"]',
                'fieldset',
                'section'
            ];

            for (const selector of selectors) {
                const container = input.closest(selector);
                if (container && container.textContent && container.textContent.trim().length > 0) {
                    return container;
                }
            }

            return input.parentElement;
        },

        extractQuestionSentence(text) {
            const normalizedText = (text || '').replace(/\s+/g, ' ').trim();
            if (!normalizedText) {
                return '';
            }

            const questionMatch = normalizedText.match(/([^.!?]*\?)/);
            if (questionMatch?.[1]) {
                return questionMatch[1].trim();
            }

            const sentenceCandidates = normalizedText
                .split(/(?<=[.!])\s+/)
                .map(sentence => sentence.trim())
                .filter(Boolean);

            return sentenceCandidates.find(sentence => this.looksLikeQuestionPrompt(sentence)) || '';
        },

        extractHelperText(input, container, excludedTexts) {
            const excluded = new Set((excludedTexts || []).map(text => (text || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
            const helperSelectors = [
                '[class*="hint"]',
                '[class*="help"]',
                '[class*="description"]',
                '[class*="subtitle"]',
                '[aria-live]',
                'small',
                'p'
            ];

            const helperTexts = [];
            if (container) {
                for (const selector of helperSelectors) {
                    for (const node of container.querySelectorAll(selector)) {
                        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                        if (text && !excluded.has(text) && text.length <= 220) {
                            helperTexts.push(text);
                        }
                    }
                }
            }

            const describedByText = this.getAriaDescribedByText(input);
            if (describedByText && !excluded.has(describedByText)) {
                helperTexts.unshift(describedByText);
            }

            return helperTexts.slice(0, 2).join(' ');
        },

        getAriaDescribedByText(input) {
            const describedBy = input.getAttribute('aria-describedby');
            if (!describedBy) return '';

            return describedBy.split(/\s+/)
                .map(id => document.getElementById(id)?.textContent?.trim() || '')
                .filter(Boolean)
                .join(' ');
        },

        looksLikeQuestionPrompt(text) {
            const normalizedText = this.normalizeText(text);
            if (!normalizedText || normalizedText.length < 8) {
                return false;
            }

            const positiveSignals = [
                'why', 'what', 'how', 'tell us', 'tell me', 'describe', 'share', 'explain',
                'interested', 'motivation', 'superpower', 'kryptonite', 'background', 'experience',
                'fit for this role', 'accomplishment', 'achievement', 'challenge', 'cover letter'
            ];
            const negativeSignals = [
                'optional', 'required', 'max', 'characters', 'upload', 'drag and drop',
                'resume', 'cv', 'search', 'select', 'choose', 'click', 'continue'
            ];

            if (negativeSignals.some(signal => normalizedText.includes(signal)) && !normalizedText.includes('?')) {
                return false;
            }

            return text.includes('?') || positiveSignals.some(signal => normalizedText.includes(this.normalizeText(signal)));
        },

        extractJobPostingText() {
            const selectors = [
                '[class*="job-description"]',
                '[class*="description"]',
                '[data-testid*="job-description"]',
                'main',
                'article'
            ];

            for (const selector of selectors) {
                const nodes = Array.from(document.querySelectorAll(selector));
                for (const node of nodes) {
                    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                    if (text.length > 500 && this.looksLikeJobPostingText(text)) {
                        return text.slice(0, 6000);
                    }
                }
            }

            const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
            return this.looksLikeJobPostingText(bodyText) ? bodyText.slice(0, 6000) : bodyText.slice(0, 2500);
        },

        looksLikeJobPostingText(text) {
            const normalizedText = this.normalizeText(text);
            const indicators = [
                'what you will do',
                'what we are looking for',
                'responsibilities',
                'qualifications',
                'about us',
                'job description',
                'requirements'
            ];

            return indicators.some(indicator => normalizedText.includes(this.normalizeText(indicator)));
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

        getDefaultPhoneCountryCode() {
            return '+1';
        },

        /**
         * Find and fill text inputs that ask for combined city+state
         */
        fillCombinedLocationFields() {
            const allInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');

            for (const input of allInputs) {
                // Skip if already filled
                if (input.value && input.value.trim()) continue;
                if (FieldDetector.isCustomComboboxInput(input)) continue;

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
        fillInput(input, value, options = {}) {
            if (!input || !value) {
                this.recordDebugEvent('input', 'skipped', {
                    fieldType: options.fieldType,
                    element: input,
                    reason: !input ? 'missing-input' : 'missing-fill-value',
                    value,
                    source: options.source
                });
                return false;
            }

            const blockReason = this.getElementFillBlockReason(input);
            if (blockReason) {
                this.recordDebugEvent('input', 'skipped', {
                    fieldType: options.fieldType,
                    element: input,
                    reason: blockReason,
                    value,
                    source: options.source
                });
                return false;
            }

            try {
                if (options.focus === true) {
                    input.focus();
                }

                for (let attempt = 0; attempt < 2; attempt += 1) {
                    this.setElementValue(input, value);
                    this.dispatchValueEvents(input, {
                        emitFocus: options.emitFocus === true,
                        emitBlur: options.emitBlur !== false
                    });

                    if (this.normalizeText(input.value) === this.normalizeText(value)) {
                        this.recordDebugEvent('input', 'filled', {
                            fieldType: options.fieldType,
                            element: input,
                            reason: 'value-applied',
                            value,
                            source: options.source
                        });
                        return true;
                    }
                }

                this.recordDebugEvent('input', 'skipped', {
                    fieldType: options.fieldType,
                    element: input,
                    reason: 'input-value-did-not-stick',
                    value,
                    source: options.source
                });
                return false;
            } catch (error) {
                this.recordDebugEvent('input', 'error', {
                    fieldType: options.fieldType,
                    element: input,
                    reason: error.message || 'fill-input-threw',
                    value,
                    source: options.source
                });
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

        dispatchValueEvents(element, options = {}) {
            if (options.emitFocus === true) {
                element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            }
            element.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                data: typeof element.value === 'string' ? element.value : null,
                inputType: 'insertText'
            }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            if (options.emitBlur !== false) {
                element.dispatchEvent(new Event('blur', { bubbles: true }));
            }
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

                const radios = FieldDetector.findYesNoRadios(fieldType, {
                    root: this.getCurrentAutofillScopeRoot() || document
                });
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
            return this.setCheckableInput(radio);
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
            return this.coerceTextValue(text)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .replace(/\bu\s+s\b/g, 'us')
                .replace(/\bu\s+s\s+a\b/g, 'usa')
                .trim();
        },

        coerceTextValue(value, depth = 0) {
            if (value == null || depth > 3) {
                return '';
            }

            if (typeof value === 'string') {
                return value;
            }

            if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
                return String(value);
            }

            if (Array.isArray(value)) {
                return value
                    .map(item => this.coerceTextValue(item, depth + 1))
                    .filter(Boolean)
                    .join(' ')
                    .slice(0, 4000);
            }

            if (typeof value === 'object') {
                const priorityKeys = ['answer', 'text', 'label', 'value', 'content', 'message'];

                for (const key of priorityKeys) {
                    const preferredText = this.coerceTextValue(value[key], depth + 1);
                    if (preferredText) {
                        return preferredText;
                    }
                }

                return Object.values(value)
                    .map(item => this.coerceTextValue(item, depth + 1))
                    .filter(Boolean)
                    .join(' ')
                    .slice(0, 4000);
            }

            return '';
        },

        sanitizeAiCacheEntry(entry) {
            const answer = this.coerceTextValue(entry?.answer).trim();
            if (!answer) {
                return null;
            }

            return {
                ...entry,
                answer
            };
        },

        sanitizeAiAnswerResponse(response) {
            if (!response || typeof response !== 'object') {
                return response;
            }

            return {
                ...response,
                answer: this.coerceTextValue(response.answer).trim()
            };
        },

        getAutofillConfidenceThreshold(fieldType) {
            const thresholds = {
                fullName: 80,
                location: 74,
                city: 72,
                state: 72,
                phoneCountryCode: 78
            };

            return thresholds[fieldType] || 65;
        },

        getDetectionMetaForAutofill(element, expectedFieldType = '') {
            if (!element || typeof FieldDetector?.identifyFieldType !== 'function') {
                return null;
            }

            const result = FieldDetector.identifyFieldType(element, { includeMeta: true });
            if (!result?.fieldType) {
                return null;
            }

            if (expectedFieldType && result.fieldType !== expectedFieldType) {
                return null;
            }

            return result;
        },

        shouldSkipLowConfidenceAutofill(element, context = {}) {
            const detection = this.getDetectionMetaForAutofill(element, context.fieldType);
            if (!detection || !Number.isFinite(detection.confidence) || detection.confidence <= 0) {
                return false;
            }

            const minimumConfidence = this.getAutofillConfidenceThreshold(context.fieldType);
            if (detection.confidence >= minimumConfidence) {
                return false;
            }

            this.recordDebugEvent(context.stage || 'input', 'skipped', {
                fieldType: context.fieldType,
                element,
                reason: 'low-confidence-detection',
                source: context.source,
                value: `confidence-${detection.confidence}`,
                confidence: detection.confidence,
                confidenceLabel: detection.confidenceLabel,
                matchedBy: detection.matchedBy
            });
            return true;
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
                    if (!this.isElementAllowed(radio) || radio.disabled) continue;

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
                    const matchesValue = this.findStructuredChoiceOption([
                        { text: `${labelText} ${radioValue}`.trim(), element: radio }
                    ], fieldType, config.value, config.patterns) !== null;

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
                if (FieldDetector.isCustomComboboxInput(input)) {
                    continue;
                }

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
                this.dispatchValueEvents(input, { emitFocus: false, emitBlur: false });
                input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
                input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

                const normalizedLocation = this.normalizeText(location);

                // Look for autocomplete suggestions near the input first.
                const findSuggestions = () => {
                    const containerCandidates = [
                        input.closest('[role="combobox"]'),
                        input.closest('[class*="autocomplete"]'),
                        input.closest('[class*="typeahead"]'),
                        input.parentElement,
                        document.body
                    ].filter(Boolean);

                    const selector = [
                        '[role="listbox"] [role="option"]',
                        '[role="option"]',
                        '[class*="autocomplete"] [role="option"]',
                        '[class*="autocomplete"] li',
                        '[class*="typeahead"] li',
                        '[class*="suggestion"]',
                        '[class*="combobox"] [data-option]',
                        '[class*="combobox"] [data-value]'
                    ].join(', ');

                    const seen = new Set();
                    const candidates = [];
                    for (const container of containerCandidates) {
                        for (const candidate of container.querySelectorAll(selector)) {
                            if (!seen.has(candidate)) {
                                seen.add(candidate);
                                candidates.push(candidate);
                            }
                        }
                    }

                    return candidates.filter(el => {
                        const style = window.getComputedStyle(el);
                        const isVisible = style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0' &&
                            el.offsetParent !== null;
                        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                        const normalizedText = this.normalizeText(text);
                        const hasText = text.length > 0;
                        const looksReasonableLength = text.length >= 3 && text.length <= 80;
                        const looksLikeLocation =
                            normalizedText.includes(normalizedLocation) ||
                            (normalizedText.includes(this.normalizeText(this.userData.city || '')) &&
                                normalizedText.includes(this.normalizeText(this.userData.state || '')));

                        return isVisible && hasText && looksReasonableLength && looksLikeLocation;
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
                    // No valid suggestions, keep the typed value.
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

                // Penalize noisy non-location suggestions.
                if (text.length > 80) {
                    score -= 8;
                }

                if (!text.includes(',') && !text.includes(userCity)) {
                    score -= 4;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = suggestion;
                }
            }

            if (bestScore <= 0) {
                console.log('[JobAutofill] No reliable location suggestion found, keeping typed value');
                return null;
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
            const selectMappings = this.getStructuredChoiceFieldMappings();

            for (const [fieldType, config] of Object.entries(selectMappings)) {
                if (!config.value) {
                    this.recordDebugEvent('select-mapping', 'skipped', {
                        fieldType,
                        reason: 'missing-profile-value',
                        source: 'profile'
                    });
                    continue;
                }

                if (!detectedFields[fieldType]) {
                    this.recordDebugEvent('select-mapping', 'skipped', {
                        fieldType,
                        reason: 'field-type-not-detected',
                        source: 'profile'
                    });
                    continue;
                }

                for (const select of detectedFields[fieldType]) {
                    if (select.tagName !== 'SELECT') {
                        this.recordDebugEvent('select', 'skipped', {
                            fieldType,
                            element: select,
                            reason: 'not-native-select',
                            source: 'profile'
                        });
                        continue;
                    }

                    if (!this.isElementAllowed(select)) {
                        this.recordDebugEvent('select', 'skipped', {
                            fieldType,
                            element: select,
                            reason: 'blocked-by-form-filter',
                            source: 'profile'
                        });
                        continue;
                    }

                    if (this.shouldSkipLowConfidenceAutofill(select, {
                        fieldType,
                        source: 'profile',
                        stage: 'select'
                    })) {
                        continue;
                    }

                    const option = this.findProfileChoiceOption(
                        this.getSelectableOptions(select),
                        config.value,
                        config.patterns || {}
                    );
                    if (!option) {
                        this.recordDebugEvent('select', 'skipped', {
                            fieldType,
                            element: select,
                            reason: 'no-matching-option',
                            value: config.value,
                            source: 'profile'
                        });
                        continue;
                    }

                    if (this.applySelectOption(select, option, { fieldType, source: 'profile' })) {
                        this.filledFields.push({ type: fieldType, element: select });
                        this.highlightField(select, true);
                    }
                }
            }

            this.fillEducationSelects();
            this.fillBinarySelects();
            this.fillSingleOptionSelects();
        },

        fillEducationSelects() {
            for (const select of document.querySelectorAll('select')) {
                if (select.value && select.selectedIndex > 0) continue;
                if (!this.isElementAllowed(select) || select.disabled) continue;

                const context = this.getChoiceFieldContext(select);
                const options = this.getSelectableOptions(select);
                const fieldType = this.inferEducationChoiceFieldType(
                    context.question,
                    context.label,
                    context.helperText,
                    context.sectionContext,
                    options,
                    select.name,
                    select.id,
                    select.getAttribute('aria-label') || ''
                );

                if (!fieldType) {
                    continue;
                }

                const option = this.findEducationChoiceOption(options, fieldType);
                if (!option) {
                    this.recordDebugEvent('select', 'skipped', {
                        fieldType,
                        element: select,
                        reason: 'no-education-option-match',
                        source: 'profile'
                    });
                    continue;
                }

                if (this.applySelectOption(select, option, { fieldType, source: 'profile' })) {
                    this.filledFields.push({ type: fieldType, element: select });
                    this.highlightField(select, true);
                }
            }
        },

        fillSingleOptionSelects() {
            const allSelects = document.querySelectorAll('select');

            for (const select of allSelects) {
                if (select.value && select.selectedIndex > 0) continue;
                if (!this.isElementAllowed(select) || select.disabled) continue;

                const options = this.getSelectableOptions(select);
                if (options.length !== 1) continue;

                if (this.applySelectOption(select, options[0], { fieldType: 'singleOptionChoice', source: 'rule' })) {
                    this.filledFields.push({ type: 'singleOptionChoice', element: select });
                    this.highlightField(select, true);
                }
            }
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

                if (this.floatingWidget?.isConnected && this.isZipRecruiterPage()) {
                    this.syncFloatingWidgetHost();
                }

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
