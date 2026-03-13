# Job Application Autofill - Chrome Extension

A Chrome extension that automates the completion of job application forms by securely storing your personal information locally and intelligently filling form fields on major job sites.

## Features

- **One-Click Autofill**: Fill job application forms instantly with your saved information
- **Smart Field Detection**: Intelligently matches form fields using multiple detection methods
- **Local-First Storage**: All data is stored on your device by default
- **Resume Upload**: Automatically attach your resume to file input fields
- **Keyboard Shortcuts**: Quick access with ⌘+Shift+F (Mac) or Ctrl+Shift+F (Windows)
- **Import/Export**: Backup and restore your data as JSON
- **Optional AI Answers**: Use your own Mistral API key to draft answers for open-ended screening questions

## Supported Data Fields

### Personal Information
- Full Name (with automatic first/last name parsing)
- Email Address
- Phone Number
- LinkedIn Profile URL
- Location (City, State)

### Work Authorization
- US Work Authorization (Yes/No)
- Visa Sponsorship Requirement (Yes/No)

### Demographics (EEOC)
- Gender
- Race/Ethnicity
- Veteran Status
- Disability Status

### Documents
- Resume (PDF, DOC, DOCX up to 5MB)

## Supported Job Sites

- LinkedIn Jobs
- Indeed
- Glassdoor
- Lever (jobs.lever.co)
- Greenhouse (boards.greenhouse.io)
- Workday
- iCIMS
- Taleo
- SmartRecruiters
- Jobvite
- ZipRecruiter
- Monster
- CareerBuilder
- Dice
- And any site with "careers", "jobs", or "apply" in the URL

## Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select the `JobApplier` folder
6. The extension icon will appear in your toolbar

Chrome will not auto-install GitHub updates for an unpacked extension. This project now checks the repository's `manifest.json` version from GitHub and surfaces an update prompt in the popup, but you still need to download the latest source and reload the extension manually from `chrome://extensions`.

### Initial Setup

1. Click the extension icon
2. Accept the privacy terms
3. Complete the 4-step setup wizard
4. Start applying to jobs!

## Usage

### Method 1: Toolbar Button
1. Go to any job application page
2. Click the extension icon
3. Click "Fill Application Form"

### Method 2: Floating Button
A floating "Autofill" button appears on detected job pages - just click it!

### Method 3: Keyboard Shortcut
- **Mac**: ⌘ + Shift + F
- **Windows/Linux**: Ctrl + Shift + F

### Optional AI Answers
1. Open Settings in the extension
2. Enable AI answers
3. Paste your Mistral API key
4. Optionally add extra resume context such as achievements or a short professional summary
5. Run autofill on a job application page with open-ended text questions

The extension continues filling structured fields locally. When AI answers are enabled, it also sends the manual question, relevant job-posting text, your saved profile fields, and any extra context you provided to Mistral to draft a short answer.

## File Structure

```
JobApplier/
├── manifest.json           # Extension configuration
├── README.md               # This file
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Popup styles
│   └── popup.js            # Popup logic
├── options/
│   ├── options.html        # Settings page
│   ├── options.css         # Settings styles
│   └── options.js          # Settings logic
├── content/
│   ├── content.js          # Autofill logic
│   ├── fieldDetector.js    # Field detection algorithms
│   └── content.css         # Injected styles
├── background/
│   └── service-worker.js   # Background service
├── shared/
│   ├── storage.js          # Storage utilities
│   └── validation.js       # Validation helpers
├── icons/
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
└── docs/
    ├── PRIVACY_POLICY.html
    └── USER_GUIDE.html
```

## Privacy & Security

- **Local First**: All profile data is stored using Chrome's local storage API
- **Optional AI Transmission**: If you enable AI answers, the extension sends only the prompt context needed to generate an answer to Mistral using your API key
- **User Control**: View, edit, export, or delete your data anytime
- **No Tracking**: No analytics or user behavior tracking

See [PRIVACY_POLICY.html](docs/PRIVACY_POLICY.html) for full details.

## Development

### Requirements
- Chrome 88+ (Manifest V3 support)

### Testing
1. Load the extension in developer mode
2. Navigate to a job application page
3. Click the autofill button or use the keyboard shortcut
4. Verify fields are filled correctly

### Debugging
- Open Chrome DevTools on the popup (right-click popup → Inspect)
- Check console for content script logs on job pages
- View background service worker at `chrome://extensions` → Details → Service Worker

## Known Limitations

- Some highly customized forms may require manual field filling
- File upload may not work on all sites due to security restrictions
- Multi-page forms require triggering autofill on each page
- Resume PDF/DOCX content is not parsed directly for AI answers; use the AI extra-context field for resume highlights you want the model to reference

## License

MIT License - See LICENSE file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Changelog

### v1.0.0
- Initial release
- Support for major job platforms
- 4-step setup wizard
- Import/export functionality
- Keyboard shortcuts
