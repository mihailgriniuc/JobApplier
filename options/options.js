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
        location: document.getElementById('displayLocation'),
        workAuth: document.getElementById('displayWorkAuth'),
        sponsorship: document.getElementById('displaySponsorship'),
        startAvailability: document.getElementById('displayStartAvailability'),
        gender: document.getElementById('displayGender'),
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

    // Settings toggles
    const autoDetectToggle = document.getElementById('autoDetectToggle');
    const showIndicatorsToggle = document.getElementById('showIndicatorsToggle');
    const confirmFillToggle = document.getElementById('confirmFillToggle');

    // Import/Export
    const exportBtn = document.getElementById('exportBtn');
    const importDropZone = document.getElementById('importDropZone');
    const importInput = document.getElementById('importInput');
    const importResult = document.getElementById('importResult');

    // Clear data
    const clearDataBtn = document.getElementById('clearDataBtn');

    // Label mappings
    const labelMappings = {
        gender: {
            male: 'Male',
            female: 'Female',
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

        if (!userData) {
            return;
        }

        // Display personal info
        displayElements.fullName.textContent = userData.fullName || '-';
        displayElements.email.textContent = userData.email || '-';
        displayElements.phone.textContent = userData.phone || '-';
        displayElements.linkedin.textContent = userData.linkedin || '-';
        displayElements.location.textContent = formatLocation(userData.city, userData.state);

        // Display work auth
        displayElements.workAuth.textContent = userData.workAuth === 'yes' ? 'Yes' :
            userData.workAuth === 'no' ? 'No' : '-';
        displayElements.sponsorship.textContent = userData.sponsorship === 'yes' ? 'Yes' :
            userData.sponsorship === 'no' ? 'No' : '-';
        displayElements.startAvailability.textContent = labelMappings.startAvailability[userData.startAvailability] || '-';

        // Display demographics
        displayElements.gender.textContent = labelMappings.gender[userData.gender] || '-';
        displayElements.race.textContent = labelMappings.race[userData.race] || '-';
        displayElements.veteran.textContent = labelMappings.veteran[userData.veteran] || '-';
        displayElements.disability.textContent = labelMappings.disability[userData.disability] || '-';

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
        }
    }

    /**
     * Load settings
     */
    async function loadSettings() {
        const settings = await Storage.getSettings();

        autoDetectToggle.checked = settings.autoDetect !== false;
        showIndicatorsToggle.checked = settings.showIndicators !== false;
        confirmFillToggle.checked = settings.confirmBeforeFill === true;
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

    // Edit modal
    editPersonalBtn.addEventListener('click', async () => {
        const userData = await Storage.getUserData();
        if (userData) {
            document.getElementById('editFullName').value = userData.fullName || '';
            document.getElementById('editEmail').value = userData.email || '';
            document.getElementById('editPhone').value = userData.phone || '';
            document.getElementById('editLinkedin').value = userData.linkedin || '';
            document.getElementById('editCity').value = userData.city || '';
            document.getElementById('editState').value = userData.state || '';
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
            city: document.getElementById('editCity').value.trim(),
            state: document.getElementById('editState').value.trim()
        });

        const validation = Validation.validateUserData(updatedUserData);
        if (!validation.valid) {
            alert(validation.errors.join('\n'));
            return;
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
    autoDetectToggle.addEventListener('change', saveSettings);
    showIndicatorsToggle.addEventListener('change', saveSettings);
    confirmFillToggle.addEventListener('change', saveSettings);

    async function saveSettings() {
        await Storage.saveSettings({
            autoDetect: autoDetectToggle.checked,
            showIndicators: showIndicatorsToggle.checked,
            confirmBeforeFill: confirmFillToggle.checked
        });
    }

    // Shortcuts link
    document.getElementById('shortcutsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
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

    // Clear data
    clearDataBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete all your saved data? This action cannot be undone.')) {
            await Storage.clearAllData();
            await loadData();
            alert('All data has been deleted.');

            // Reset displays
            Object.values(displayElements).forEach(el => {
                el.textContent = '-';
            });

            document.getElementById('resumeDisplay').innerHTML = '<p class="no-data">No resume uploaded</p>';
        }
    });
});
