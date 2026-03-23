/**
 * Options Page JavaScript for Job Application Autofill
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Tab elements
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    // Profile display elements
    const displayElements = {
        fullName: document.getElementById('displayFullName'),
        email: document.getElementById('displayEmail'),
        phone: document.getElementById('displayPhone'),
        linkedin: document.getElementById('displayLinkedin'),
        github: document.getElementById('displayGithub'),
        website: document.getElementById('displayWebsite'),
        location: document.getElementById('displayLocation'),
        workAuth: document.getElementById('displayWorkAuth'),
        sponsorship: document.getElementById('displaySponsorship'),
        onsiteComfort: document.getElementById('displayOnsiteComfort'),
        relocationWillingness: document.getElementById('displayRelocationWillingness'),
        internshipStatus: document.getElementById('displayInternshipStatus'),
        over18: document.getElementById('displayOver18'),
        formerEmployee: document.getElementById('displayFormerEmployee'),
        startAvailability: document.getElementById('displayStartAvailability'),
        gender: document.getElementById('displayGender'),
        sexualOrientation: document.getElementById('displaySexualOrientation'),
        hispanicLatino: document.getElementById('displayHispanicLatino'),
        race: document.getElementById('displayRace'),
        veteran: document.getElementById('displayVeteran'),
        disability: document.getElementById('displayDisability')
    };

    // Modal elements
    const editModal = document.getElementById('editModal');
    const editPersonalBtn = document.getElementById('editPersonalBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const saveEditBtn = document.getElementById('saveEditBtn');
    const editSexualOrientationInputs = Array.from(document.querySelectorAll('input[name="editSexualOrientation"]'));

    // Settings toggles
    const autoDetectToggle = document.getElementById('autoDetectToggle');
    const showIndicatorsToggle = document.getElementById('showIndicatorsToggle');
    const confirmFillToggle = document.getElementById('confirmFillToggle');
    const aiCacheAnswersToggle = document.getElementById('aiCacheAnswersToggle');
    const aiUseParsedResumeToggle = document.getElementById('aiUseParsedResumeToggle');
    const mistralApiKeyInput = document.getElementById('mistralApiKeyInput');
    const aiModelInput = document.getElementById('aiModelInput');
    const aiMaxCharactersInput = document.getElementById('aiMaxCharactersInput');
    const aiMaxQuestionsInput = document.getElementById('aiMaxQuestionsInput');
    const aiExtraContextInput = document.getElementById('aiExtraContextInput');
    const parsedResumeStatus = document.getElementById('parsedResumeStatus');
    const parsedResumeDetails = document.getElementById('parsedResumeDetails');

    // Import/Export
    const exportBtn = document.getElementById('exportBtn');
    const importDropZone = document.getElementById('importDropZone');
    const importInput = document.getElementById('importInput');
    const importResult = document.getElementById('importResult');
    const parseResumeBtn = document.getElementById('parseResumeBtn');
    const replaceResumeBtn = document.getElementById('replaceResumeBtn');
    const removeResumeBtn = document.getElementById('removeResumeBtn');
    const resumeInput = document.getElementById('resumeInput');
    const resumeResult = document.getElementById('resumeResult');
    const parsedResumePreviewMeta = document.getElementById('parsedResumePreviewMeta');
    const parsedResumePreviewSections = document.getElementById('parsedResumePreviewSections');
    const parsedResumeJsonPreview = document.getElementById('parsedResumeJsonPreview');

    // Clear data
    const clearDataBtn = document.getElementById('clearDataBtn');

    // Label mappings
    const labelMappings = {
        yesNo: {
            yes: 'Yes',
            no: 'No'
        },
        gender: {
            male: 'Male',
            female: 'Female',
            decline: 'Decline to self-identify'
        },
        hispanicLatino: {
            yes: 'Yes',
            no: 'No',
            decline: 'Decline to self-identify'
        },
        race: {
            american_indian: 'American Indian or Alaska Native',
            asian: 'Asian',
            black: 'Black or African American',
            hispanic: 'Hispanic or Latino',
            native_hawaiian: 'Native Hawaiian or Pacific Islander',
            white: 'White',
            two_or_more: 'Two or More Races',
            decline: 'Decline to self-identify'
        },
        veteran: {
            not_veteran: 'Not a Protected Veteran',
            disabled_veteran: 'Disabled Veteran',
            recently_separated: 'Recently Separated Veteran',
            active_wartime: 'Active Duty Wartime Veteran',
            armed_forces: 'Armed Forces Service Medal Veteran',
            decline: 'Decline to self-identify'
        },
        disability: {
            yes: 'Yes, I have a disability',
            no: 'No, I do not have a disability',
            decline: 'Decline to self-identify'
        },
        startAvailability: {
            immediately: 'Immediately',
            '1_week': '1 Week',
            '2_weeks': '2 Weeks',
            '3_weeks': '3 Weeks',
            '4_weeks': '4 Weeks'
        }
    };

    let editSexualOrientationTouched = false;

    function getSexualOrientationOptionValues(value) {
        return (value || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    }

    function formatSexualOrientation(value) {
        const labels = [];
        const seen = new Set();
        const selectedValues = Validation.getSexualOrientationValues(value);

        if (selectedValues.includes('bisexual') || selectedValues.includes('pansexual')) {
            seen.add('bisexual_pansexual');
            labels.push('Bisexual and/or pansexual');
        }

        const labelMap = {
            asexual: 'Asexual',
            gay: 'Gay',
            straight: 'Heterosexual / Straight',
            lesbian: 'Lesbian',
            queer: 'Queer',
            no_answer: "I don't wish to answer"
        };

        selectedValues.forEach(selectedValue => {
            if (selectedValue === 'bisexual' || selectedValue === 'pansexual') {
                return;
            }

            const label = labelMap[selectedValue] || selectedValue.replace(/_/g, ' ');
            const key = label.toLowerCase();
            if (seen.has(key)) {
                return;
            }

            seen.add(key);
            labels.push(label);
        });

        return labels.length > 0 ? labels.join(', ') : '-';
    }

    function setEditSexualOrientationSelections(value) {
        const selectedValues = new Set(Validation.getSexualOrientationValues(value));

        editSexualOrientationInputs.forEach(input => {
            const optionValues = getSexualOrientationOptionValues(input.value);
            input.checked = optionValues.some(optionValue => selectedValues.has(optionValue));
        });

        editSexualOrientationTouched = false;
    }

    function getEditSexualOrientationValue(fallbackValue = '') {
        const selectedValues = [];
        const seen = new Set();

        editSexualOrientationInputs.forEach(input => {
            if (!input.checked) {
                return;
            }

            getSexualOrientationOptionValues(input.value).forEach(optionValue => {
                if (seen.has(optionValue)) {
                    return;
                }

                seen.add(optionValue);
                selectedValues.push(optionValue);
            });
        });

        if (selectedValues.length > 0) {
            return Validation.normalizeSexualOrientationValue(selectedValues);
        }

        return editSexualOrientationTouched ? '' : Validation.normalizeSexualOrientationValue(fallbackValue);
    }

    function handleEditSexualOrientationChange(event) {
        editSexualOrientationTouched = true;

        const currentValues = getSexualOrientationOptionValues(event.target.value);
        if (!event.target.checked) {
            return;
        }

        if (currentValues.includes('no_answer')) {
            editSexualOrientationInputs.forEach(input => {
                if (input !== event.target) {
                    input.checked = false;
                }
            });
            return;
        }

        editSexualOrientationInputs.forEach(input => {
            if (input === event.target) {
                return;
            }

            if (getSexualOrientationOptionValues(input.value).includes('no_answer')) {
                input.checked = false;
            }
        });
    }

    // Initialize
    await loadData();
    await loadSettings();

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`${tabId}Tab`).classList.add('active');
        });
    });

    /**
     * Load and display user data
     */
    async function loadData() {
        const userData = await Storage.getUserData();

        // Display personal info
        displayElements.fullName.textContent = userData?.fullName || '-';
        displayElements.email.textContent = userData?.email || '-';
        displayElements.phone.textContent = userData?.phone || '-';
        displayElements.linkedin.textContent = userData?.linkedin || '-';
        displayElements.github.textContent = userData?.github || '-';
        displayElements.website.textContent = userData?.website || '-';
        displayElements.location.textContent = formatLocation(userData?.city, userData?.state);

        // Display work auth
        displayElements.workAuth.textContent = labelMappings.yesNo[userData?.workAuth] || '-';
        displayElements.sponsorship.textContent = labelMappings.yesNo[userData?.sponsorship] || '-';
        displayElements.onsiteComfort.textContent = labelMappings.yesNo[userData?.onsiteComfort] || '-';
        displayElements.relocationWillingness.textContent = labelMappings.yesNo[userData?.relocationWillingness] || '-';
        displayElements.internshipStatus.textContent = labelMappings.yesNo[userData?.internshipStatus] || '-';
        displayElements.over18.textContent = labelMappings.yesNo[userData?.over18] || '-';
        displayElements.formerEmployee.textContent = labelMappings.yesNo[userData?.formerEmployee] || '-';
        displayElements.startAvailability.textContent = labelMappings.startAvailability[userData?.startAvailability] || '-';

        // Display demographics
        displayElements.gender.textContent = labelMappings.gender[userData?.gender] || '-';
        displayElements.sexualOrientation.textContent = formatSexualOrientation(userData?.sexualOrientation);
        displayElements.hispanicLatino.textContent = labelMappings.hispanicLatino[userData?.hispanicLatino] || '-';
        displayElements.race.textContent = labelMappings.race[userData?.race] || '-';
        displayElements.veteran.textContent = labelMappings.veteran[userData?.veteran] || '-';
        displayElements.disability.textContent = labelMappings.disability[userData?.disability] || '-';

        // Load resume info
        const resume = await Storage.getResume();
        const resumeDisplay = document.getElementById('resumeDisplay');

        if (resume) {
            resumeDisplay.innerHTML = `
        <div class="resume-file">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="currentColor"/>
          </svg>
          <div class="resume-file-info">
            <span class="resume-file-name">${resume.name}</span>
            <span class="resume-file-size">${formatFileSize(resume.size)}</span>
          </div>
        </div>
      `;
                } else {
                        resumeDisplay.innerHTML = '<p class="no-data">No resume uploaded</p>';
        }

                removeResumeBtn.disabled = !resume;
                parseResumeBtn.disabled = !resume;

                await renderParsedResumeStatus(resume);
    }

    /**
     * Load settings
     */
    async function loadSettings() {
        const settings = await Storage.getSettings();

        autoDetectToggle.checked = settings.autoDetect !== false;
        showIndicatorsToggle.checked = settings.showIndicators !== false;
        confirmFillToggle.checked = settings.confirmBeforeFill === true;
        aiCacheAnswersToggle.checked = settings.aiAssist?.cacheAnswers !== false;
        aiUseParsedResumeToggle.checked = settings.aiAssist?.useParsedResumeData !== false;
        mistralApiKeyInput.value = settings.aiAssist?.apiKey || '';
        aiModelInput.value = settings.aiAssist?.model || 'mistral-small-latest';
        aiMaxCharactersInput.value = settings.aiAssist?.maxCharacters || 320;
        aiMaxQuestionsInput.value = settings.aiAssist?.maxQuestionsPerRun || 10;
        aiExtraContextInput.value = settings.aiAssist?.extraContext || '';
    }

    /**
     * Format location string
     */
    function formatLocation(city, state) {
        if (city && state) return `${city}, ${state}`;
        return city || state || '-';
    }

    /**
     * Format file size
     */
    function formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getParsedResumeSections(parsedResumeData) {
        if (!parsedResumeData || typeof parsedResumeData !== 'object') {
            return null;
        }

        const structuredData = parsedResumeData.structuredData
            && typeof parsedResumeData.structuredData === 'object'
            && !Array.isArray(parsedResumeData.structuredData)
            ? parsedResumeData.structuredData
            : null;

        const sections = {
            resumeSummary: typeof parsedResumeData.resumeSummary === 'string' ? parsedResumeData.resumeSummary.trim() : '',
            skills: Array.isArray(parsedResumeData.skills) ? parsedResumeData.skills.filter(Boolean) : [],
            experienceHighlights: Array.isArray(parsedResumeData.experienceHighlights) ? parsedResumeData.experienceHighlights.filter(Boolean) : [],
            educationHighlights: Array.isArray(parsedResumeData.educationHighlights) ? parsedResumeData.educationHighlights.filter(Boolean) : [],
            certifications: Array.isArray(parsedResumeData.certifications) ? parsedResumeData.certifications.filter(Boolean) : [],
            projects: Array.isArray(parsedResumeData.projects) ? parsedResumeData.projects.filter(Boolean) : [],
            structuredData
        };

        return Object.values(sections).some(value => {
            if (Array.isArray(value)) {
                return value.length > 0;
            }

            if (value && typeof value === 'object') {
                return Object.keys(value).length > 0;
            }

            return Boolean(value);
        })
            ? sections
            : null;
    }

    function renderParsedResumePreview(parsedResumeData, resume) {
        const sections = getParsedResumeSections(parsedResumeData);

        if (!resume) {
            parsedResumePreviewMeta.textContent = 'No structured data available yet.';
            parsedResumePreviewSections.innerHTML = '<p class="help-text">Upload a resume to preview extracted sections and JSON.</p>';
            parsedResumeJsonPreview.textContent = 'No structured resume JSON available.';
            return;
        }

        if (!sections || parsedResumeData?.isParsed !== true) {
            parsedResumePreviewMeta.textContent = 'Resume uploaded, but structured extraction is not ready.';
            parsedResumePreviewSections.innerHTML = '<p class="help-text">Use Re-Extract Resume to inspect what the AI will use.</p>';
            parsedResumeJsonPreview.textContent = 'No structured resume JSON available.';
            return;
        }

        const cards = [];

        if (sections.resumeSummary) {
            cards.push([
                '<article class="parsed-resume-section">',
                '<h4>Summary</h4>',
                `<p>${escapeHtml(sections.resumeSummary)}</p>`,
                '</article>'
            ].join(''));
        }

        [
            ['Skills', sections.skills],
            ['Experience', sections.experienceHighlights],
            ['Education', sections.educationHighlights],
            ['Certifications', sections.certifications],
            ['Projects', sections.projects]
        ].forEach(([title, items]) => {
            if (!Array.isArray(items) || items.length === 0) {
                return;
            }

            cards.push([
                '<article class="parsed-resume-section">',
                `<h4>${escapeHtml(title)}</h4>`,
                `<ul>${items.slice(0, 6).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
                '</article>'
            ].join(''));
        });

        parsedResumePreviewSections.innerHTML = cards.length > 0
            ? cards.join('')
            : '<p class="help-text">Structured resume JSON exists, but there are no compact preview sections to show.</p>';

        const parsedAtLabel = parsedResumeData?.parsedAt
            ? new Date(parsedResumeData.parsedAt).toLocaleString()
            : 'unknown time';
        const pageCountLabel = Number(parsedResumeData?.ocrPageCount) > 0
            ? `${parsedResumeData.ocrPageCount} page${parsedResumeData.ocrPageCount === 1 ? '' : 's'}`
            : 'page count unavailable';
        parsedResumePreviewMeta.textContent = `Parsed with ${parsedResumeData.parser || 'AI'} on ${parsedAtLabel} from ${pageCountLabel}.`;

        const previewPayload = sections.structuredData || {
            resumeSummary: sections.resumeSummary,
            skills: sections.skills,
            experienceHighlights: sections.experienceHighlights,
            educationHighlights: sections.educationHighlights,
            certifications: sections.certifications,
            projects: sections.projects
        };
        parsedResumeJsonPreview.textContent = JSON.stringify(previewPayload, null, 2);
    }

    async function renderParsedResumeStatus(resume) {
        const parsedResumeData = await Storage.getParsedResumeData();
        const sections = getParsedResumeSections(parsedResumeData);
        renderParsedResumePreview(parsedResumeData, resume);

        if (!resume) {
            parsedResumeStatus.textContent = 'No resume uploaded';
            parsedResumeDetails.textContent = 'Upload a resume to make structured resume context available when parsing data is present.';
            return;
        }

        if (!sections || parsedResumeData?.isParsed !== true) {
            parsedResumeStatus.textContent = 'Resume uploaded';
            parsedResumeDetails.textContent = 'Your resume is uploaded, but structured sections are not yet available. AI answers will still use your saved profile and extra context.';
            return;
        }

        const sectionDetails = [];
        if (sections.resumeSummary) sectionDetails.push('summary');
        if (sections.skills.length) sectionDetails.push(`${sections.skills.length} skills`);
        if (sections.experienceHighlights.length) sectionDetails.push(`${sections.experienceHighlights.length} experience highlights`);
        if (sections.educationHighlights.length) sectionDetails.push(`${sections.educationHighlights.length} education highlights`);
        if (sections.certifications.length) sectionDetails.push(`${sections.certifications.length} certifications`);
        if (sections.projects.length) sectionDetails.push(`${sections.projects.length} projects`);
        if (sections.structuredData) sectionDetails.push('full structured JSON');

        parsedResumeStatus.textContent = 'Structured resume context ready';
        parsedResumeDetails.textContent = `Available sections: ${sectionDetails.join(', ')}.`;
    }

    async function parseStoredResume(force = true) {
        const response = await chrome.runtime.sendMessage({
            action: 'parseStoredResume',
            force
        });

        if (!response?.success) {
            throw new Error(response?.error || 'Failed to extract structured resume data.');
        }

        return response.parsedResume || null;
    }

    parseResumeBtn.addEventListener('click', async () => {
        const resume = await Storage.getResume();
        if (!resume) {
            showResumeResult(false, 'Upload a resume before running extraction.');
            return;
        }

        const previousLabel = parseResumeBtn.textContent;
        parseResumeBtn.disabled = true;
        parseResumeBtn.textContent = 'Extracting...';

        try {
            await parseStoredResume(true);
            await loadData();
            showResumeResult(true, 'Re-extracted structured resume JSON. Review the preview below.');
        } catch (error) {
            showResumeResult(false, `Failed to extract structured resume data: ${error.message}`);
        } finally {
            parseResumeBtn.disabled = false;
            parseResumeBtn.textContent = previousLabel;
        }
    });

    // Edit modal
    editPersonalBtn.addEventListener('click', async () => {
        const userData = await Storage.getUserData();
        if (userData) {
            document.getElementById('editFullName').value = userData.fullName || '';
            document.getElementById('editEmail').value = userData.email || '';
            document.getElementById('editPhone').value = userData.phone || '';
            document.getElementById('editLinkedin').value = userData.linkedin || '';
            document.getElementById('editGithub').value = userData.github || '';
            document.getElementById('editWebsite').value = userData.website || '';
            document.getElementById('editCity').value = userData.city || '';
            document.getElementById('editState').value = userData.state || '';
            document.getElementById('editWorkAuth').value = userData.workAuth || '';
            document.getElementById('editSponsorship').value = userData.sponsorship || '';
            document.getElementById('editOnsiteComfort').value = userData.onsiteComfort || '';
            document.getElementById('editRelocationWillingness').value = userData.relocationWillingness || '';
            document.getElementById('editInternshipStatus').value = userData.internshipStatus || '';
            document.getElementById('editOver18').value = userData.over18 || '';
            document.getElementById('editFormerEmployee').value = userData.formerEmployee || '';
            document.getElementById('editStartAvailability').value = userData.startAvailability || '';
            document.getElementById('editGender').value = userData.gender || '';
            setEditSexualOrientationSelections(userData.sexualOrientation || '');
            document.getElementById('editHispanicLatino').value = userData.hispanicLatino || '';
            document.getElementById('editRace').value = userData.race || '';
            document.getElementById('editVeteran').value = userData.veteran || '';
            document.getElementById('editDisability').value = userData.disability || '';
        }
        editModal.classList.remove('hidden');
    });

    closeModalBtn.addEventListener('click', () => {
        editModal.classList.add('hidden');
    });

    cancelEditBtn.addEventListener('click', () => {
        editModal.classList.add('hidden');
    });

    saveEditBtn.addEventListener('click', async () => {
        const userData = await Storage.getUserData() || {};

        // Update data
        const updatedUserData = Validation.normalizeUserData({
            ...userData,
            fullName: document.getElementById('editFullName').value.trim(),
            email: document.getElementById('editEmail').value.trim(),
            phone: document.getElementById('editPhone').value.trim(),
            linkedin: document.getElementById('editLinkedin').value.trim(),
            github: document.getElementById('editGithub').value.trim(),
            website: document.getElementById('editWebsite').value.trim(),
            city: document.getElementById('editCity').value.trim(),
            state: document.getElementById('editState').value.trim(),
            workAuth: document.getElementById('editWorkAuth').value,
            sponsorship: document.getElementById('editSponsorship').value,
            onsiteComfort: document.getElementById('editOnsiteComfort').value,
            relocationWillingness: document.getElementById('editRelocationWillingness').value,
            internshipStatus: document.getElementById('editInternshipStatus').value,
            over18: document.getElementById('editOver18').value,
            formerEmployee: document.getElementById('editFormerEmployee').value,
            startAvailability: document.getElementById('editStartAvailability').value,
            gender: document.getElementById('editGender').value,
            sexualOrientation: getEditSexualOrientationValue(userData.sexualOrientation || ''),
            hispanicLatino: document.getElementById('editHispanicLatino').value,
            race: document.getElementById('editRace').value,
            veteran: document.getElementById('editVeteran').value,
            disability: document.getElementById('editDisability').value
        });

        const validation = Validation.validateUserData(updatedUserData);
        if (!validation.valid) {
            alert(validation.errors.join('\n'));
            return;
        }

        if (validation.warnings?.length) {
            const confirmed = confirm(`${validation.warnings.join('\n\n')}\n\nSave anyway?`);
            if (!confirmed) {
                return;
            }
        }

        await Storage.saveUserData(validation.normalizedData);
        await loadData();
        editModal.classList.add('hidden');
    });

    // Close modal on outside click
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.classList.add('hidden');
        }
    });

    // Settings toggles
    editSexualOrientationInputs.forEach(input => {
        input.addEventListener('change', handleEditSexualOrientationChange);
    });

    autoDetectToggle.addEventListener('change', saveSettings);
    showIndicatorsToggle.addEventListener('change', saveSettings);
    confirmFillToggle.addEventListener('change', saveSettings);
    aiCacheAnswersToggle.addEventListener('change', saveSettings);
    aiUseParsedResumeToggle.addEventListener('change', saveSettings);
    mistralApiKeyInput.addEventListener('change', saveSettings);
    aiModelInput.addEventListener('change', saveSettings);
    aiMaxCharactersInput.addEventListener('change', saveSettings);
    aiMaxQuestionsInput.addEventListener('change', saveSettings);
    aiExtraContextInput.addEventListener('change', saveSettings);

    async function saveSettings() {
        await Storage.saveSettings({
            autoDetect: autoDetectToggle.checked,
            showIndicators: showIndicatorsToggle.checked,
            confirmBeforeFill: confirmFillToggle.checked,
            aiAssist: {
                enabled: true,
                cacheAnswers: aiCacheAnswersToggle.checked,
                useParsedResumeData: aiUseParsedResumeToggle.checked,
                apiKey: mistralApiKeyInput.value.trim(),
                model: aiModelInput.value.trim() || 'mistral-small-latest',
                maxCharacters: Number(aiMaxCharactersInput.value) || 320,
                maxQuestionsPerRun: Number(aiMaxQuestionsInput.value) || 10,
                extraContext: aiExtraContextInput.value.trim()
            }
        });
    }

    // Shortcuts link
    document.getElementById('shortcutsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    replaceResumeBtn.addEventListener('click', () => resumeInput.click());

    resumeInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        if (!Validation.isValidResumeType(file)) {
            showResumeResult(false, 'Please upload a PDF, DOC, or DOCX resume file.');
            resumeInput.value = '';
            return;
        }

        if (!Validation.isValidFileSize(file)) {
            showResumeResult(false, 'Resume file must be 5 MB or smaller.');
            resumeInput.value = '';
            return;
        }

        try {
            await Storage.saveResume(file);
            let parseWarning = '';

            try {
                await parseStoredResume(true);
            } catch (error) {
                parseWarning = error.message;
            }

            await loadData();
            showResumeResult(
                true,
                parseWarning
                    ? `Saved ${file.name}, but structured extraction failed: ${parseWarning}`
                    : `Saved ${file.name} and extracted structured resume JSON for AI answers.`
            );
        } catch (error) {
            showResumeResult(false, `Failed to save resume: ${error.message}`);
        } finally {
            resumeInput.value = '';
        }
    });

    removeResumeBtn.addEventListener('click', async () => {
        const confirmed = confirm('Remove the currently saved resume and its parsed resume data?');
        if (!confirmed) {
            return;
        }

        await Storage.deleteResume();
        await loadData();
        showResumeResult(true, 'Removed the saved resume.');
    });

    // Export
    exportBtn.addEventListener('click', async () => {
        try {
            const data = await Storage.exportData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `job-autofill-backup-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            alert('Failed to export data: ' + error.message);
        }
    });

    // Import
    importDropZone.addEventListener('click', () => importInput.click());

    importDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        importDropZone.classList.add('dragover');
    });

    importDropZone.addEventListener('dragleave', () => {
        importDropZone.classList.remove('dragover');
    });

    importDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        importDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleImport(e.dataTransfer.files[0]);
        }
    });

    importInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImport(e.target.files[0]);
        }
    });

    async function handleImport(file) {
        if (!file.name.endsWith('.json')) {
            showImportResult(false, 'Please select a JSON file');
            return;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const result = await Storage.importData(data);

            showImportResult(result.success, result.message);

            if (result.success) {
                await loadData();
                await loadSettings();
            }
        } catch (error) {
            showImportResult(false, 'Invalid JSON file: ' + error.message);
        }
    }

    function showImportResult(success, message) {
        importResult.classList.remove('hidden', 'success', 'error');
        importResult.classList.add(success ? 'success' : 'error');
        importResult.textContent = message;

        setTimeout(() => {
            importResult.classList.add('hidden');
        }, 5000);
    }

    function showResumeResult(success, message) {
        resumeResult.classList.remove('hidden', 'success', 'error');
        resumeResult.classList.add(success ? 'success' : 'error');
        resumeResult.textContent = message;

        setTimeout(() => {
            resumeResult.classList.add('hidden');
        }, 5000);
    }

    // Clear data
    clearDataBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete all your saved data? This action cannot be undone.')) {
            await Storage.clearAllData();
            await loadData();
            await loadSettings();
            alert('All data has been deleted.');
        }
    });
});
