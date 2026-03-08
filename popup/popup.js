/**
 * Popup JavaScript for Job Application Autofill
 * Handles setup wizard, data persistence, and autofill triggering
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Screen elements
    const consentScreen = document.getElementById('consentScreen');
    const setupScreen = document.getElementById('setupScreen');
    const mainScreen = document.getElementById('mainScreen');

    // Consent elements
    const consentCheckbox = document.getElementById('consentCheckbox');
    const consentBtn = document.getElementById('consentBtn');

    // Navigation
    const steps = document.querySelectorAll('.step');
    const stepContents = document.querySelectorAll('.step-content');
    const nextBtns = document.querySelectorAll('.next-btn');
    const prevBtns = document.querySelectorAll('.prev-btn');

    // File upload
    const dropZone = document.getElementById('dropZone');
    const resumeInput = document.getElementById('resumeInput');
    const filePreview = document.getElementById('filePreview');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const removeFileBtn = document.getElementById('removeFile');

    // Action buttons
    const saveBtn = document.getElementById('saveBtn');
    const autofillBtn = document.getElementById('autofillBtn');
    const editDataBtn = document.getElementById('editDataBtn');
    const viewDataBtn = document.getElementById('viewDataBtn');
    const settingsBtn = document.getElementById('settingsBtn');

    let currentStep = 1;
    let resumeFile = null;

    // Initialize
    await initialize();

    async function initialize() {
        const hasConsented = await Storage.hasConsented();
        const hasSetup = await Storage.hasCompletedSetup();

        if (!hasConsented) {
            showScreen('consent');
        } else if (!hasSetup) {
            showScreen('setup');
        } else {
            showScreen('main');
            await loadUserGreeting();
        }
    }

    function showScreen(screen) {
        consentScreen.classList.add('hidden');
        setupScreen.classList.add('hidden');
        mainScreen.classList.add('hidden');

        switch (screen) {
            case 'consent':
                consentScreen.classList.remove('hidden');
                break;
            case 'setup':
                setupScreen.classList.remove('hidden');
                break;
            case 'main':
                mainScreen.classList.remove('hidden');
                break;
        }
    }

    // Consent handling
    consentCheckbox.addEventListener('change', () => {
        consentBtn.disabled = !consentCheckbox.checked;
    });

    consentBtn.addEventListener('click', async () => {
        await Storage.saveConsent(true);
        showScreen('setup');
    });

    // Step navigation
    function updateSteps(step) {
        currentStep = step;

        steps.forEach((s, index) => {
            const stepNum = index + 1;
            s.classList.remove('active', 'completed');
            if (stepNum === currentStep) {
                s.classList.add('active');
            } else if (stepNum < currentStep) {
                s.classList.add('completed');
            }
        });

        stepContents.forEach((content, index) => {
            const stepNum = index + 1;
            content.classList.toggle('active', stepNum === currentStep);
        });
    }

    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const nextStep = parseInt(btn.dataset.next);
            if (validateCurrentStep()) {
                updateSteps(nextStep);
            }
        });
    });

    prevBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const prevStep = parseInt(btn.dataset.prev);
            updateSteps(prevStep);
        });
    });

    function validateCurrentStep() {
        clearErrors();

        switch (currentStep) {
            case 1:
                return validateStep1();
            case 2:
                return validateStep2();
            default:
                return true;
        }
    }

    function validateStep1() {
        let valid = true;

        const fullName = document.getElementById('fullName');
        const email = document.getElementById('email');
        const phone = document.getElementById('phone');
        const linkedin = document.getElementById('linkedin');
        const city = document.getElementById('city');
        const state = document.getElementById('state');

        if (!Validation.isNotEmpty(fullName.value)) {
            showError(fullName, 'Full name is required');
            valid = false;
        }

        if (!Validation.isNotEmpty(email.value)) {
            showError(email, 'Email is required');
            valid = false;
        } else if (!Validation.isValidEmail(email.value)) {
            showError(email, 'Please enter a valid email address');
            valid = false;
        }

        if (phone.value && !Validation.isValidPhone(phone.value)) {
            showError(phone, 'Please enter a valid phone number');
            valid = false;
        }

        if (linkedin.value && !Validation.isValidLinkedInUrl(linkedin.value)) {
            showError(linkedin, 'Please enter a valid LinkedIn URL');
            valid = false;
        }

        if (!Validation.isNotEmpty(city.value)) {
            showError(city, 'City is required');
            valid = false;
        }

        if (!Validation.isNotEmpty(state.value)) {
            showError(state, 'State is required');
            valid = false;
        }

        return valid;
    }

    function validateStep2() {
        const workAuth = document.querySelector('input[name="workAuth"]:checked');
        const sponsorship = document.querySelector('input[name="sponsorship"]:checked');
        const startAvailability = document.querySelector('input[name="startAvailability"]:checked');

        if (!workAuth || !sponsorship || !startAvailability) {
            alert('Please answer all work authorization questions.');
            return false;
        }

        return true;
    }

    function showError(input, message) {
        const formGroup = input.closest('.form-group');
        formGroup.classList.add('has-error');
        input.classList.add('error');
        const errorText = formGroup.querySelector('.error-text');
        if (errorText) {
            errorText.textContent = message;
        }
    }

    function clearErrors() {
        document.querySelectorAll('.form-group').forEach(group => {
            group.classList.remove('has-error');
        });
        document.querySelectorAll('input.error, select.error').forEach(input => {
            input.classList.remove('error');
        });
    }

    // File upload handling
    dropZone.addEventListener('click', () => resumeInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    resumeInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    function handleFile(file) {
        // Validate file type
        if (!Validation.isValidResumeType(file)) {
            alert('Please upload a PDF, DOC, or DOCX file.');
            return;
        }

        // Validate file size
        if (!Validation.isValidFileSize(file)) {
            alert('File size must be less than 5MB.');
            return;
        }

        resumeFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        dropZone.classList.add('hidden');
        filePreview.classList.remove('hidden');
    }

    removeFileBtn.addEventListener('click', () => {
        resumeFile = null;
        resumeInput.value = '';
        dropZone.classList.remove('hidden');
        filePreview.classList.add('hidden');
    });

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Save user data
    saveBtn.addEventListener('click', async () => {
        try {
            if (!validateCurrentStep()) {
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            const userData = Validation.normalizeUserData({
                fullName: document.getElementById('fullName').value.trim(),
                email: document.getElementById('email').value.trim(),
                phone: document.getElementById('phone').value.trim(),
                linkedin: Validation.normalizeLinkedInUrl(document.getElementById('linkedin').value),
                city: document.getElementById('city').value.trim(),
                state: document.getElementById('state').value.trim(),
                workAuth: document.querySelector('input[name="workAuth"]:checked')?.value || '',
                sponsorship: document.querySelector('input[name="sponsorship"]:checked')?.value || '',
                startAvailability: document.querySelector('input[name="startAvailability"]:checked')?.value || '',
                transgender: document.querySelector('input[name="transgender"]:checked')?.value || '',
                sexualOrientation: document.getElementById('sexualOrientation').value,
                pronouns: document.getElementById('pronouns').value,
                gender: document.getElementById('gender').value,
                race: document.getElementById('race').value,
                veteran: document.getElementById('veteran').value,
                disability: document.getElementById('disability').value
            });

            const validation = Validation.validateUserData(userData);
            if (!validation.valid) {
                alert(validation.errors.join('\n'));
                return;
            }

            await Storage.saveUserData(validation.normalizedData);

            if (resumeFile) {
                await Storage.saveResume(resumeFile);
            }

            showScreen('main');
            await loadUserGreeting();
        } catch (error) {
            console.error('Failed to save data:', error);
            alert('Failed to save data. Please try again.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & Finish';
        }
    });

    async function loadUserGreeting() {
        const userData = await Storage.getUserData();
        const greeting = document.getElementById('userGreeting');
        if (userData && userData.fullName) {
            const firstName = userData.fullName.split(' ')[0];
            greeting.textContent = `Hello, ${firstName}!`;
        }
    }

    // Autofill trigger
    autofillBtn.addEventListener('click', async () => {
        autofillBtn.disabled = true;
        autofillBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" class="spin">
        <path d="M12 4V1L8 5L12 9V6C15.31 6 18 8.69 18 12C18 13.01 17.75 13.97 17.3 14.8L18.76 16.26C19.54 15.03 20 13.57 20 12C20 7.58 16.42 4 12 4ZM12 18C8.69 18 6 15.31 6 12C6 10.99 6.25 10.03 6.7 9.2L5.24 7.74C4.46 8.97 4 10.43 4 12C4 16.42 7.58 20 12 20V23L16 19L12 15V18Z" fill="currentColor"/>
      </svg>
      Filling...
    `;

        try {
            // Send message to content script via background
            const response = await chrome.runtime.sendMessage({
                action: 'triggerAutofillFromPopup'
            });

            showFillResult(response);
        } catch (error) {
            showFillResult({
                success: false,
                error: 'Could not connect to the page. Make sure you\'re on a job application page.'
            });
        } finally {
            autofillBtn.disabled = false;
            autofillBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M19 3H5C3.89 3 3 3.89 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.89 20.1 3 19 3ZM19 19H5V5H19V19Z" fill="currentColor"/>
          <path d="M7 12L10 15L17 8L15.59 6.59L10 12.17L8.41 10.59L7 12Z" fill="currentColor"/>
        </svg>
        Fill Application Form
      `;
        }
    });

    function showFillResult(result) {
        const fillResult = document.getElementById('fillResult');
        const resultIcon = document.getElementById('resultIcon');
        const resultText = document.getElementById('resultText');
        const resultDetails = document.getElementById('resultDetails');

        fillResult.classList.remove('hidden', 'success', 'error');

        if (result.success) {
            fillResult.classList.add('success');
            resultIcon.innerHTML = '✓';
            resultText.textContent = `Filled ${result.filledCount || 0} fields`;
            resultDetails.textContent = result.message || 'Form filled successfully!';
        } else {
            fillResult.classList.add('error');
            resultIcon.innerHTML = '✗';
            resultText.textContent = 'Fill failed';
            resultDetails.textContent = result.error || 'An error occurred';
        }

        // Hide after 5 seconds
        setTimeout(() => {
            fillResult.classList.add('hidden');
        }, 5000);
    }

    // Edit and view data
    editDataBtn.addEventListener('click', async () => {
        await loadExistingData();
        showScreen('setup');
        updateSteps(1);
    });

    viewDataBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    async function loadExistingData() {
        const userData = await Storage.getUserData();
        if (!userData) return;

        document.getElementById('fullName').value = userData.fullName || '';
        document.getElementById('email').value = userData.email || '';
        document.getElementById('phone').value = userData.phone || '';
        document.getElementById('linkedin').value = userData.linkedin || '';
        document.getElementById('city').value = userData.city || '';
        document.getElementById('state').value = userData.state || '';

        if (userData.workAuth) {
            const workAuthRadio = document.querySelector(`input[name="workAuth"][value="${userData.workAuth}"]`);
            if (workAuthRadio) workAuthRadio.checked = true;
        }

        if (userData.sponsorship) {
            const sponsorshipRadio = document.querySelector(`input[name="sponsorship"][value="${userData.sponsorship}"]`);
            if (sponsorshipRadio) sponsorshipRadio.checked = true;
        }

        if (userData.startAvailability) {
            const startAvailabilityRadio = document.querySelector(`input[name="startAvailability"][value="${userData.startAvailability}"]`);
            if (startAvailabilityRadio) startAvailabilityRadio.checked = true;
        }

        if (userData.transgender) {
            const transgenderRadio = document.querySelector(`input[name="transgender"][value="${userData.transgender}"]`);
            if (transgenderRadio) transgenderRadio.checked = true;
        }

        document.getElementById('sexualOrientation').value = userData.sexualOrientation || '';
        document.getElementById('pronouns').value = userData.pronouns || '';
        document.getElementById('gender').value = userData.gender || '';
        document.getElementById('race').value = userData.race || '';
        document.getElementById('veteran').value = userData.veteran || '';
        document.getElementById('disability').value = userData.disability || '';

        // Load resume info
        const resume = await Storage.getResume();
        if (resume) {
            fileName.textContent = resume.name;
            fileSize.textContent = formatFileSize(resume.size);
            dropZone.classList.add('hidden');
            filePreview.classList.remove('hidden');
        }
    }

    // Privacy link
    document.getElementById('privacyLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL('docs/PRIVACY_POLICY.html') });
    });

    // Help link
    document.getElementById('helpLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL('docs/USER_GUIDE.html') });
    });
});

// Add spinning animation for loading state
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .spin {
    animation: spin 1s linear infinite;
  }
`;
document.head.appendChild(style);
