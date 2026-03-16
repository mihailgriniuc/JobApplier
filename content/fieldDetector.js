/**
 * Field Detector for Job Application Autofill
 * Intelligently identifies form fields on job application pages
 */

const FieldDetector = {
    // Field type patterns for detection
    patterns: {
        preferredFirstName: {
            labels: ['preferred first name', 'preferred given name', 'chosen first name', 'first name you go by', 'name you go by', 'preferred name'],
            names: ['preferredfirstname', 'preferred_first_name', 'preferredgivenname', 'preferredname', 'chosenname', 'nameyougoby'],
            placeholders: ['preferred first name', 'name you go by', 'chosen name']
        },
        firstName: {
            labels: ['first name', 'first-name', 'firstname', 'given name', 'forename'],
            names: ['firstname', 'first_name', 'first-name', 'fname', 'givenname', 'given_name'],
            placeholders: ['first name', 'john', 'given name']
        },
        lastName: {
            labels: ['last name', 'last-name', 'lastname', 'surname', 'family name'],
            names: ['lastname', 'last_name', 'last-name', 'lname', 'surname', 'familyname', 'family_name'],
            placeholders: ['last name', 'doe', 'surname', 'family name']
        },
        fullName: {
            labels: ['full name', 'name', 'your name', 'legal name'],
            names: ['fullname', 'full_name', 'name', 'candidatename', 'applicantname'],
            placeholders: ['full name', 'john doe', 'your name', 'enter name']
        },
        email: {
            labels: ['email', 'e-mail', 'email address'],
            names: ['email', 'e-mail', 'emailaddress', 'email_address', 'useremail'],
            placeholders: ['email', 'e-mail', 'your@email.com', 'example@email.com'],
            types: ['email']
        },
        phone: {
            labels: ['phone', 'telephone', 'mobile', 'cell', 'contact number'],
            names: ['phone', 'telephone', 'mobile', 'cell', 'phonenumber', 'phone_number', 'tel'],
            placeholders: ['phone', 'telephone', 'mobile', '(555)', '123-4567'],
            types: ['tel']
        },
        phoneCountryCode: {
            labels: ['country code for phone number', 'phone country code', 'country code', 'dial code', 'calling code'],
            names: ['countrycode', 'country_code', 'phonecountrycode', 'phone_country_code', 'dialcode', 'callingcode'],
            placeholders: ['+1', 'country code', 'dial code'],
            options: {
                us: ['+1', '1', 'united states (+1)', 'us (+1)', 'usa (+1)', 'united states']
            }
        },
        linkedin: {
            labels: ['linkedin', 'linkedin profile', 'linkedin url'],
            names: ['linkedin', 'linkedinurl', 'linkedin_url', 'linkedinprofile'],
            placeholders: ['linkedin.com', 'linkedin profile', 'linkedin url']
        },
        city: {
            labels: ['city', 'town'],
            names: ['city', 'town', 'locality'],
            placeholders: ['city', 'new york', 'san francisco']
        },
        state: {
            labels: ['state', 'province', 'region'],
            names: ['state', 'province', 'region', 'administrativearea'],
            placeholders: ['state', 'ca', 'ny', 'province']
        },
        location: {
            labels: ['location', 'city, state', 'city and state', 'city/state', 'address', 'city and state/province', 'city, state/province', 'list city and state', 'please list city'],
            names: ['location', 'address', 'currentlocation', 'citystate', 'city_state'],
            placeholders: ['city, state', 'location', 'new york, ny', 'san francisco, california', 'toronto, ontario']
        },
        workAuth: {
            labels: ['authorized to work', 'work authorization', 'legally authorized', 'eligible to work', 'work in the u.s', 'work in the us', 'legally eligible', 'unrestricted authorization', 'unrestricted work authorization', 'authorized to work in the united states without', 'legally authorized to work in the united states without', 'authorized to work in the united states', 'legally authorized to work in the united states', 'authorized to work in the us', 'legally authorized to work in the us', 'authorized to work in the u s', 'legally authorized to work in the u s', 'authorized to work in the usa', 'legally authorized to work in the usa', 'employment authorization', 'authorized to reside and work', 'authorized to live and work', 'authorized to work in the country where this role is based', 'authorized to reside and work in the country where this role is based', 'right to work in the country where this role is based', 'currently authorized to reside and work', 'currently authorized to work in the country'],
            names: ['workauth', 'work_auth', 'authorized', 'workauthorization', 'usworking', 'eligibility', 'righttowork', 'resideandwork', 'workpermit'],
            questions: ['authorized to work', 'legally authorized', 'eligib', 'unrestricted authorization', 'without sponsorship', 'without the need for visa sponsorship', 'authorized to work in the united states', 'legally authorized to work in the united states', 'authorized to work in the us', 'legally authorized to work in the us', 'employment authorization', 'authorized to reside and work', 'authorized to live and work', 'country where this role is based', 'right to work in the country', 'currently authorized to reside and work'],
            options: {
                yes: ['yes', 'authorized', 'eligible', 'true'],
                no: ['no', 'not authorized', 'not eligible', 'false']
            }
        },
        sponsorship: {
            labels: ['sponsorship', 'visa sponsorship', 'require sponsorship', 'need sponsorship', 'immigration sponsorship', 'will you now or in the future require', 'will you now, or in the future, require', 'require visa', 'need visa', 'continue working in the United States', 'employment visa status', 'visa status', 'work visa', 'employment sponsorship', 'current or future sponsorship', 'need work authorization sponsorship', 'need immigration support', 'require sponsorship to work in the country where this role is based', 'require sponsorship to continue working in the country where this role is based', 'require employer sponsorship to work in the country where this role is based'],
            names: ['sponsorship', 'visasponsorship', 'visa_sponsorship', 'requiresponsorship', 'futuresponsor', 'visa'],
            questions: ['require sponsorship', 'need sponsorship', 'visa', 'immigration', 'will you now or in the future', 'will you now, or in the future', 'sponsor', 'employment visa', 'employment visa status', 'visa status', 'work visa', 'continue working', 'employment sponsorship', 'current or future sponsorship', 'require employer sponsorship', 'employment-based immigration', 'need immigration support', 'dependent on visa', 'continue working in the country where this role is based', 'require sponsorship to work in the country where this role is based'],
            options: {
                yes: ['yes', 'true', 'will require', 'sponsorship'],
                no: ['no', 'false', 'will not require', 'do not require']
            }
        },
        startAvailability: {
            labels: ['start date', 'start time', 'available to start', 'availability', 'when can you start', 'when would you be able to start', 'notice period', 'earliest start', 'start immediately'],
            names: ['startdate', 'start_date', 'availability', 'startavailability', 'noticeperiod', 'notice_period', 'earlieststart'],
            questions: ['when can you start', 'when would you be able to start', 'available to start', 'start date', 'notice period', 'earliest start'],
            options: {
                immediately: ['immediately', 'asap', 'right away', 'now'],
                '1_week': ['1 week', 'one week', '7 days'],
                '2_weeks': ['2 weeks', 'two weeks', '14 days'],
                '3_weeks': ['3 weeks', 'three weeks', '21 days'],
                '4_weeks': ['4 weeks', 'four weeks', '28 days', '1 month', 'one month']
            }
        },
        onsiteComfort: {
            labels: ['comfortable working', 'comfortable commuting', 'comfortable with an onsite', 'comfortable with a hybrid', 'comfortable coming into the office', 'comfortable working for this role', 'comfortable working in', 'in office', 'in-office', 'onsite', 'on-site'],
            names: ['onsite', 'on_site', 'inoffice', 'in_office', 'hybrid', 'commute'],
            questions: ['comfortable working', 'comfortable commuting', 'comfortable coming into the office', 'comfortable with an onsite', 'comfortable with a hybrid', '5x a week', '5 days a week', 'five days a week', 'work in office', 'work from office'],
            options: {
                yes: ['yes', 'comfortable', 'can commute', 'can work onsite'],
                no: ['no', 'not comfortable', 'cannot commute', 'cannot work onsite']
            }
        },
        relocationWillingness: {
            labels: ['willing to relocate', 'open to relocation', 'relocate', 'move to the required location', 'willing to work from the required location'],
            names: ['relocation', 'relocate', 'willingtorelocate', 'relocationwillingness', 'move_location'],
            questions: ['willing to relocate', 'open to relocation', 'willing to work from the required location', 'move to the required location', 'relocate for this role', 'able to relocate'],
            options: {
                yes: ['yes', 'willing', 'open to relocate'],
                no: ['no', 'not willing', 'cannot relocate']
            }
        },
        internshipStatus: {
            labels: ['seeking an internship', 'seeking internship', 'currently employed as an intern', 'internship', 'intern role', 'intern program'],
            names: ['internship', 'intern', 'internshipstatus', 'seekinginternship', 'currentintern'],
            questions: ['currently employed as an intern', 'seeking an internship', 'seeking internship', 'interested in an internship', 'internship position', 'intern role'],
            options: {
                yes: ['yes', 'intern', 'internship'],
                no: ['no', 'full time', 'not internship']
            }
        },
        over18: {
            labels: ['18 years old', '18 or older', 'at least 18', 'over the age of 18', 'legal working age'],
            names: ['over18', 'age18', 'atleast18', 'legalage'],
            questions: ['at least 18 years old', '18 years old or older', 'over the age of 18', 'legal working age'],
            options: {
                yes: ['yes', '18', 'older'],
                no: ['no', 'under 18']
            }
        },
        formerEmployee: {
            labels: ['previously worked for', 'formerly employed by', 'former employee', 'worked for this company', 'worked for us before', 'previous employee'],
            names: ['formeremployee', 'previousemployee', 'workedherebefore', 'prioremployment', 'rehire'],
            questions: ['previously worked for this company', 'worked for this company', 'worked for us before', 'formerly employed by', 'former employee', 'past employee'],
            options: {
                yes: ['yes', 'former employee', 'previously employed'],
                no: ['no', 'never employed']
            }
        },
        gender: {
            labels: ['gender', 'sex', 'gender identity', 'gender identification', 'identify your gender', 'how do you identify'],
            names: ['gender', 'sex'],
            questions: ['gender identity', 'gender identification', 'identify your gender', 'how do you identify', 'gender'],
            options: {
                male: ['male', 'm', 'man'],
                female: ['female', 'f', 'woman'],
                decline: ['decline', 'prefer not', 'do not wish', 'choose not']
            }
        },
        transgender: {
            labels: ['transgender', 'trans gender', 'identify as transgender', 'transgender status'],
            names: ['transgender', 'transgenderstatus', 'transgender_status', 'trans_status'],
            options: {
                yes: ['yes', 'transgender', 'trans'],
                no: ['no', 'not transgender']
            }
        },
        sexualOrientation: {
            labels: ['sexual orientation', 'sexuality', 'orientation', 'sexual identity'],
            names: ['sexualorientation', 'sexual_orientation', 'sexuality', 'orientation', 'sexualidentity'],
            options: {
                asexual: ['asexual'],
                bisexual: ['bisexual'],
                gay: ['gay'],
                no_answer: ['do not wish', 'prefer not', 'decline', "don't wish"],
                lesbian: ['lesbian'],
                lgbtqia: ['lgbtqia', 'lgbtqia+', 'lgbtq'],
                pansexual: ['pansexual'],
                self_describe: ['self describe', 'self-describe', 'self describe as'],
                queer: ['queer'],
                questioning: ['questioning', 'unsure'],
                straight: ['straight', 'heterosexual']
            }
        },
        pronouns: {
            labels: ['pronouns', 'pronoun', 'preferred pronouns'],
            names: ['pronouns', 'pronoun', 'preferredpronouns', 'preferred_pronouns'],
            options: {
                she_her: ['she/her', 'she her', 'she/her/hers'],
                he_him: ['he/him', 'he him', 'he/him/his'],
                they_them: ['they/them', 'they them', 'they/them/theirs'],
                self_describe: ['self describe', 'self-describe', 'self describe as']
            }
        },
        hispanicLatino: {
            labels: ['hispanic', 'latino', 'latina', 'latinx', 'hispanic/latino', 'hispanic or latino', 'are you hispanic', 'are you hispanic/latino'],
            names: ['hispanic', 'latino', 'hispaniclatino', 'hispanic_latino', 'ethnicity'],
            questions: ['are you hispanic', 'are you hispanic latino', 'hispanic or latino', 'hispanic latino identification'],
            options: {
                yes: ['yes', 'hispanic', 'latino', 'latina', 'latinx'],
                no: ['no', 'not hispanic', 'not latino'],
                decline: ['decline', 'prefer not', 'do not wish', 'choose not']
            }
        },
        race: {
            labels: ['race', 'ethnicity', 'race/ethnicity', 'ethnic', 'racial'],
            names: ['race', 'ethnicity', 'raceethnicity', 'race_ethnicity'],
            options: {
                american_indian: ['american indian', 'alaska native', 'native american'],
                asian: ['asian'],
                black: ['black', 'african american'],
                hispanic: ['hispanic', 'latino', 'latina', 'latinx'],
                native_hawaiian: ['native hawaiian', 'pacific islander'],
                white: ['white', 'caucasian'],
                two_or_more: ['two or more', 'multiracial', 'mixed'],
                decline: ['decline', 'prefer not', 'do not wish', 'choose not']
            }
        },
        veteran: {
            labels: ['veteran', 'veteran status', 'military', 'protected veteran', 'protected veteran status', 'military service'],
            names: ['veteran', 'veteranstatus', 'veteran_status', 'protectedveteran'],
            questions: ['veteran status', 'protected veteran', 'military service', 'served in the military'],
            options: {
                not_veteran: ['not a protected veteran', 'not a veteran', 'no'],
                disabled_veteran: ['disabled veteran'],
                recently_separated: ['recently separated'],
                active_wartime: ['active duty', 'wartime', 'campaign badge'],
                armed_forces: ['armed forces service medal'],
                decline: ['decline', 'prefer not', 'do not wish', 'choose not']
            }
        },
        disability: {
            labels: ['disability', 'disabled', 'disability status', 'self identify disability', 'voluntary self identification of disability'],
            names: ['disability', 'disabilitystatus', 'disability_status'],
            questions: ['have a disability', 'disability status', 'self identify disability', 'voluntary self identification of disability'],
            options: {
                yes: ['yes', 'have a disability'],
                no: ['no', 'do not have'],
                decline: ['decline', 'prefer not', 'do not wish', 'choose not']
            }
        }
    },

    normalizeText(text) {
        return (text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\bu\s+s\b/g, 'us')
            .replace(/\bu\s+s\s+a\b/g, 'usa')
            .trim();
    },

    containsNormalizedPhrase(text, pattern) {
        const normalizedText = this.normalizeText(text);
        const normalizedPattern = this.normalizeText(pattern);

        if (!normalizedText || !normalizedPattern) {
            return false;
        }

        return ` ${normalizedText} `.includes(` ${normalizedPattern} `);
    },

    getElementDebugDescriptor(input) {
        if (!input) {
            return '';
        }

        const tagName = (input.tagName || '').toLowerCase();
        const type = (input.type || '').toLowerCase();
        const name = input.name ? `[name="${input.name}"]` : '';
        const id = input.id ? `#${input.id}` : '';

        return `${tagName}${type ? `(${type})` : ''}${id}${name}`;
    },

    getFieldDebugContext(input) {
        const labelText = this.getLabelText(input);
        const questionText = this.getQuestionText(input);
        const inputName = input.name || '';
        const inputId = input.id || '';
        const placeholder = input.placeholder || '';
        const inputType = input.type || '';
        const ariaLabel = input.getAttribute('aria-label') || '';
        const role = input.getAttribute('role') || '';
        const ariaRequired = input.getAttribute('aria-required') || '';
        const ariaLabelledBy = this.getAriaLabelledByText(input);
        const containerText = (input.closest('div, fieldset, section, article')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        const allText = `${labelText} ${questionText} ${inputName} ${inputId} ${placeholder} ${ariaLabel} ${ariaLabelledBy} ${containerText}`;
        const hasValue = typeof input.value === 'string' && input.value.trim().length > 0;

        return {
            descriptor: this.getElementDebugDescriptor(input),
            tagName: (input.tagName || '').toLowerCase(),
            inputType: inputType.toLowerCase(),
            name: inputName,
            id: inputId,
            placeholder,
            labelText,
            questionText,
            ariaLabel,
            role,
            ariaRequired,
            ariaLabelledBy,
            containerText,
            currentValue: hasValue ? input.value.trim().slice(0, 120) : '',
            hasValue,
            isRequired: Boolean(input.required || ariaRequired === 'true'),
            controlKind: this.isCustomComboboxInput(input) ? 'custom-combobox' : (input.tagName || '').toLowerCase(),
            isVisible: Boolean(input.offsetParent || input.getClientRects?.().length),
            normalizedAllText: this.normalizeText(allText)
        };
    },

    isCustomComboboxInput(input) {
        if (!input || (input.tagName || '').toLowerCase() !== 'input') {
            return false;
        }

        return Boolean(
            input.closest('[role="combobox"]') ||
            input.closest('[aria-haspopup="listbox"]') ||
            input.closest('.select__control') ||
            input.closest('.select__value-container') ||
            input.classList.contains('select__input') ||
            input.getAttribute('aria-autocomplete') === 'list' ||
            input.getAttribute('role') === 'combobox'
        );
    },

    getFieldSkipReason(input) {
        if (!input) {
            return 'missing-element';
        }

        if (input.type === 'hidden') return 'hidden-input';
        if (input.type === 'submit') return 'submit-input';
        if (input.type === 'button') return 'button-input';
        if (input.type === 'file') return 'file-input';
        if (this.isCustomComboboxInput(input)) return 'custom-combobox-input';

        return null;
    },

    buildFieldDetectionResult(fieldType, reason, matchedBy, matchedValue, context) {
        const confidence = fieldType
            ? this.getDetectionConfidence(fieldType, matchedBy, matchedValue, context)
            : 0;

        return {
            fieldType,
            reason,
            matchedBy,
            matchedValue,
            confidence,
            confidenceLabel: this.getConfidenceLabel(confidence),
            context
        };
    },

    getDetectionConfidence(fieldType, matchedBy, matchedValue, context = {}) {
        const baseScores = {
            heuristic: 96,
            type: 93,
            label: 90,
            name: 76,
            placeholder: 68,
            question: 72,
            exclusion: 0
        };

        let score = baseScores[matchedBy] ?? 55;
        const normalizedMatch = this.normalizeText(matchedValue);
        const normalizedLabel = this.normalizeText(context.labelText);
        const normalizedQuestion = this.normalizeText(context.questionText);
        const normalizedName = this.normalizeText(`${context.name} ${context.id}`);

        if (matchedBy === 'label' && normalizedMatch && normalizedLabel === normalizedMatch) {
            score += 6;
        }

        if (matchedBy === 'question' && normalizedMatch && normalizedQuestion === normalizedMatch) {
            score += 5;
        }

        if (matchedBy === 'name' && normalizedMatch && normalizedName.includes(normalizedMatch)) {
            score += 4;
        }

        if (context.controlKind === 'custom-combobox') {
            score -= 6;
        }

        if (fieldType === 'fullName' && matchedBy === 'name' && normalizedMatch === 'name') {
            score -= 12;
        }

        if (fieldType === 'location' && matchedBy === 'placeholder') {
            score -= 6;
        }

        if (context.isRequired) {
            score += 1;
        }

        return Math.max(0, Math.min(100, score));
    },

    getConfidenceLabel(confidence) {
        if (confidence >= 85) {
            return 'high';
        }

        if (confidence >= 65) {
            return 'medium';
        }

        if (confidence > 0) {
            return 'low';
        }

        return 'none';
    },

    classifyBinaryQuestionType(questionText) {
        const normalizedQuestion = this.normalizeText(questionText);
        if (!normalizedQuestion) {
            return null;
        }

        const isAuthWithoutSponsorship =
            ((normalizedQuestion.includes('authorized') || normalizedQuestion.includes('eligible') || normalizedQuestion.includes('authorization')) &&
                normalizedQuestion.includes('without') &&
                (normalizedQuestion.includes('sponsorship') || normalizedQuestion.includes('visa'))) ||
            normalizedQuestion.includes('unrestricted authorization') ||
            normalizedQuestion.includes('unrestricted work authorization');

        const isSponsorshipQuestion =
            normalizedQuestion.includes('sponsor an immigration case') ||
            normalizedQuestion.includes('require the company to sponsor') ||
            normalizedQuestion.includes('require sponsorship') ||
            normalizedQuestion.includes('need sponsorship') ||
            normalizedQuestion.includes('employment sponsorship') ||
            normalizedQuestion.includes('current or future sponsorship') ||
            normalizedQuestion.includes('require employer sponsorship') ||
            normalizedQuestion.includes('need immigration support') ||
            normalizedQuestion.includes('dependent on visa') ||
            normalizedQuestion.includes('visa sponsorship') ||
            normalizedQuestion.includes('immigration sponsorship') ||
            normalizedQuestion.includes('employment based immigration case') ||
            normalizedQuestion.includes('employment based immigration') ||
            normalizedQuestion.includes('h 1b') ||
            normalizedQuestion.includes('stem opt') ||
            normalizedQuestion.includes('work visa') ||
            normalizedQuestion.includes('employment visa') ||
            normalizedQuestion.includes('visa status') ||
            normalizedQuestion.includes('require sponsorship to work in the country where this role is based') ||
            normalizedQuestion.includes('require sponsorship to continue working in the country where this role is based') ||
            normalizedQuestion.includes('will you now or in the future require');

        const isWorkAuthQuestion =
            normalizedQuestion.includes('authorized to work') ||
            normalizedQuestion.includes('legally authorized') ||
            normalizedQuestion.includes('lawfully in the united states') ||
            normalizedQuestion.includes('lawfully in the us') ||
            normalizedQuestion.includes('eligible to work') ||
            normalizedQuestion.includes('right to work') ||
            normalizedQuestion.includes('employment authorization') ||
            normalizedQuestion.includes('authorized to work lawfully') ||
            normalizedQuestion.includes('authorized to reside and work') ||
            normalizedQuestion.includes('authorized to live and work') ||
            normalizedQuestion.includes('currently authorized to reside and work') ||
            normalizedQuestion.includes('authorized to work in the country where this role is based') ||
            normalizedQuestion.includes('right to work in the country where this role is based') ||
            (normalizedQuestion.includes('country where this role is based') &&
                (normalizedQuestion.includes('authorized') || normalizedQuestion.includes('eligible') || normalizedQuestion.includes('right to work')));

        const isOnsiteComfortQuestion =
            normalizedQuestion.includes('comfortable working') ||
            normalizedQuestion.includes('comfortable commuting') ||
            normalizedQuestion.includes('comfortable coming into the office') ||
            normalizedQuestion.includes('comfortable with an onsite') ||
            normalizedQuestion.includes('comfortable with a hybrid') ||
            normalizedQuestion.includes('comfortable working for this role') ||
            normalizedQuestion.includes('5x a week') ||
            normalizedQuestion.includes('5 days a week') ||
            normalizedQuestion.includes('five days a week') ||
            (normalizedQuestion.includes('onsite') && normalizedQuestion.includes('comfortable')) ||
            (normalizedQuestion.includes('in office') && normalizedQuestion.includes('comfortable'));

        const isRelocationQuestion =
            normalizedQuestion.includes('willing to relocate') ||
            normalizedQuestion.includes('open to relocation') ||
            normalizedQuestion.includes('able to relocate') ||
            normalizedQuestion.includes('relocate for this role') ||
            normalizedQuestion.includes('move to the required location') ||
            normalizedQuestion.includes('willing to work from the required location');

        const isInternshipQuestion =
            normalizedQuestion.includes('currently employed as an intern') ||
            normalizedQuestion.includes('seeking an internship') ||
            normalizedQuestion.includes('seeking internship') ||
            normalizedQuestion.includes('interested in an internship') ||
            normalizedQuestion.includes('internship position') ||
            normalizedQuestion.includes('intern role');

        const isOver18Question =
            normalizedQuestion.includes('at least 18 years old') ||
            normalizedQuestion.includes('18 years old or older') ||
            normalizedQuestion.includes('over the age of 18') ||
            normalizedQuestion.includes('legal working age');

        const isFormerEmployeeQuestion =
            normalizedQuestion.includes('previously worked for this company') ||
            normalizedQuestion.includes('worked for this company') ||
            normalizedQuestion.includes('worked for us before') ||
            normalizedQuestion.includes('formerly employed by') ||
            normalizedQuestion.includes('former employee') ||
            normalizedQuestion.includes('past employee');

        if (isAuthWithoutSponsorship) {
            return 'workAuth';
        }

        if (isSponsorshipQuestion) {
            return 'sponsorship';
        }

        if (isWorkAuthQuestion) {
            return 'workAuth';
        }

        if (isOnsiteComfortQuestion) {
            return 'onsiteComfort';
        }

        if (isRelocationQuestion) {
            return 'relocationWillingness';
        }

        if (isInternshipQuestion) {
            return 'internshipStatus';
        }

        if (isOver18Question) {
            return 'over18';
        }

        if (isFormerEmployeeQuestion) {
            return 'formerEmployee';
        }

        return null;
    },

    detectFields(options = {}) {
        const detectedFields = {};
        const diagnostics = {
            detected: [],
            unmatched: [],
            skipped: []
        };
        const queryRoot = options.root && typeof options.root.querySelectorAll === 'function'
            ? options.root
            : document;
        const inputs = queryRoot.querySelectorAll('input, select, textarea');

        inputs.forEach(input => {
            // Skip hidden, submit, button, checkbox (for individual checkboxes), file inputs
            const skipReason = this.getFieldSkipReason(input);
            if (skipReason) {
                if (options.includeDiagnostics && skipReason === 'custom-combobox-input') {
                    const customResult = this.identifyFieldType(input, { includeMeta: true });
                    if (customResult.fieldType) {
                        diagnostics.detected.push({
                            status: 'detected',
                            fieldType: customResult.fieldType,
                            reason: customResult.reason,
                            matchedBy: customResult.matchedBy,
                            matchedValue: customResult.matchedValue,
                            confidence: customResult.confidence,
                            confidenceLabel: customResult.confidenceLabel,
                            context: {
                                ...customResult.context,
                                controlKind: 'custom-combobox'
                            },
                            diagnosticOnly: true,
                            skipReason
                        });
                        return;
                    }
                }

                if (options.includeDiagnostics) {
                    diagnostics.skipped.push({
                        status: 'skipped',
                        reason: skipReason,
                        context: this.getFieldDebugContext(input)
                    });
                }
                return;
            }

            const result = this.identifyFieldType(input, { includeMeta: true });
            if (result.fieldType) {
                if (!detectedFields[result.fieldType]) {
                    detectedFields[result.fieldType] = [];
                }
                detectedFields[result.fieldType].push(input);

                if (options.includeDiagnostics) {
                    diagnostics.detected.push({
                        status: 'detected',
                        fieldType: result.fieldType,
                        reason: result.reason,
                        matchedBy: result.matchedBy,
                        matchedValue: result.matchedValue,
                        confidence: result.confidence,
                        confidenceLabel: result.confidenceLabel,
                        context: result.context
                    });
                }
            } else if (options.includeDiagnostics) {
                diagnostics.unmatched.push({
                    status: 'unmatched',
                    reason: result.reason,
                    context: result.context
                });
            }
        });

        if (options.includeDiagnostics) {
            return {
                detectedFields,
                detected: diagnostics.detected,
                unmatched: diagnostics.unmatched,
                skipped: diagnostics.skipped,
                summary: {
                    totalInputs: inputs.length,
                    detectedCount: diagnostics.detected.length,
                    unmatchedCount: diagnostics.unmatched.length,
                    skippedCount: diagnostics.skipped.length,
                    detectedTypes: Object.fromEntries(
                        Object.entries(
                            diagnostics.detected.reduce((counts, item) => {
                                const fieldType = item.fieldType || 'unknown';
                                counts[fieldType] = (counts[fieldType] || 0) + 1;
                                return counts;
                            }, {})
                        )
                    )
                }
            };
        }

        return detectedFields;
    },

    /**
     * Identify the type of a form field
     * @param {HTMLElement} input 
     * @returns {string|null} Field type or null if not recognized
     */
    identifyFieldType(input, options = {}) {
        const context = this.getFieldDebugContext(input);
        const labelText = context.labelText.toLowerCase();
        const questionText = context.questionText.toLowerCase();
        const inputName = context.name.toLowerCase();
        const inputId = context.id.toLowerCase();
        const placeholder = context.placeholder.toLowerCase();
        const inputType = context.inputType;
        const ariaLabel = context.ariaLabel.toLowerCase();
        const ariaLabelledBy = context.ariaLabelledBy.toLowerCase();
        const containerText = context.containerText.toLowerCase();
        const normalizedAllText = context.normalizedAllText;
        const normalizedLocalText = this.normalizeText([
            context.labelText,
            context.questionText,
            context.name,
            context.id,
            context.placeholder,
            context.ariaLabel,
            context.ariaLabelledBy
        ].filter(Boolean).join(' '));

        const isPreferredFirstNameField =
            normalizedLocalText.includes('preferred') &&
            (normalizedLocalText.includes('first') || normalizedLocalText.includes('given') || normalizedLocalText.includes('go by') || normalizedLocalText.includes('chosen'));

        if (isPreferredFirstNameField) {
            const result = this.buildFieldDetectionResult(
                'preferredFirstName',
                'matched preferred first-name heuristic',
                'heuristic',
                'preferred first name',
                context
            );
            return options.includeMeta ? result : result.fieldType;
        }

        const isExcludedNameField =
            normalizedAllText.includes('nickname') ||
            normalizedAllText.includes('name pronunciation') ||
            normalizedAllText.includes('pronunciation') ||
            normalizedAllText.includes('pronounciation') ||
            normalizedAllText.includes('phonetic') ||
            normalizedAllText.includes('how to pronounce');

        if (isExcludedNameField) {
            const result = this.buildFieldDetectionResult(
                null,
                'excluded pronunciation or nickname field',
                'exclusion',
                'nickname/pronunciation',
                context
            );
            return options.includeMeta ? result : result.fieldType;
        }

        // Check each field type
        for (const [fieldType, patterns] of Object.entries(this.patterns)) {
            // Check type attribute
            if (patterns.types && patterns.types.includes(inputType)) {
                const result = this.buildFieldDetectionResult(
                    fieldType,
                    'matched input type',
                    'type',
                    inputType,
                    context
                );
                return options.includeMeta ? result : result.fieldType;
            }

            // Check labels
            if (patterns.labels) {
                for (const label of patterns.labels) {
                    if (
                        this.containsNormalizedPhrase(labelText, label) ||
                        this.containsNormalizedPhrase(ariaLabel, label) ||
                        this.containsNormalizedPhrase(ariaLabelledBy, label)
                    ) {
                        const result = this.buildFieldDetectionResult(
                            fieldType,
                            'matched label text',
                            'label',
                            label,
                            context
                        );
                        return options.includeMeta ? result : result.fieldType;
                    }
                }
            }

            // Check name/id patterns
            if (patterns.names) {
                for (const name of patterns.names) {
                    if (inputName.includes(name) || inputId.includes(name)) {
                        const result = this.buildFieldDetectionResult(
                            fieldType,
                            'matched name or id',
                            'name',
                            name,
                            context
                        );
                        return options.includeMeta ? result : result.fieldType;
                    }
                }
            }

            // Check placeholders
            if (patterns.placeholders) {
                for (const ph of patterns.placeholders) {
                    if (this.containsNormalizedPhrase(placeholder, ph)) {
                        const result = this.buildFieldDetectionResult(
                            fieldType,
                            'matched placeholder text',
                            'placeholder',
                            ph,
                            context
                        );
                        return options.includeMeta ? result : result.fieldType;
                    }
                }
            }

            // Check questions (for work auth, sponsorship)
            if (patterns.questions) {
                for (const q of patterns.questions) {
                    if (this.containsNormalizedPhrase(normalizedAllText, q)) {
                        const result = this.buildFieldDetectionResult(
                            fieldType,
                            'matched question or container text',
                            'question',
                            q,
                            context
                        );
                        return options.includeMeta ? result : result.fieldType;
                    }
                }
            }
        }

        const result = this.buildFieldDetectionResult(
            null,
            'no matching field pattern',
            null,
            null,
            context
        );
        return options.includeMeta ? result : result.fieldType;
    },

    /**
     * Get label text for an input
     * @param {HTMLElement} input 
     * @returns {string}
     */
    getLabelText(input) {
        // Try associated label via for attribute
        if (input.id) {
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label) return label.textContent.trim();
        }

        // Try parent label
        const parentLabel = input.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();

        // Try preceding sibling or nearby text
        const parent = input.parentElement;
        if (parent) {
            const prevSibling = input.previousElementSibling;
            if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN')) {
                return prevSibling.textContent.trim();
            }

            const siblings = Array.from(parent.children);
            const inputIndex = siblings.indexOf(input);
            if (inputIndex > 0) {
                const nearbySibling = siblings
                    .slice(Math.max(0, inputIndex - 3), inputIndex)
                    .reverse()
                    .find(sibling => {
                        if (!sibling || sibling.querySelector?.('input, select, textarea, button')) {
                            return false;
                        }

                        return ['LABEL', 'SPAN', 'DIV', 'P', 'STRONG'].includes(sibling.tagName)
                            && (sibling.textContent || '').trim().length <= 120;
                    });

                if (nearbySibling) {
                    return nearbySibling.textContent.trim();
                }
            }
        }

        // Try legend for fieldset
        const fieldset = input.closest('fieldset');
        if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend) return legend.textContent.trim();
        }

        return '';
    },

    /**
     * Get aria-labelledby text
     * @param {HTMLElement} input 
     * @returns {string}
     */
    getAriaLabelledByText(input) {
        const labelledBy = input.getAttribute('aria-labelledby');
        if (!labelledBy) return '';

        const ids = labelledBy.split(' ');
        return ids.map(id => {
            const el = document.getElementById(id);
            return el ? el.textContent.trim() : '';
        }).join(' ');
    },

    /**
     * Get the question text for radio/checkbox groups
     * @param {HTMLElement} input 
     * @returns {string}
     */
    getQuestionText(input) {
        // For radio buttons, look for the fieldset legend or parent container text
        const fieldset = input.closest('fieldset');
        if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend) return legend.textContent.trim();
        }

        // Look for heading or label in parent container
        const container = input.closest('[class*="question"], [class*="field"], [class*="form-group"]');
        if (container) {
            const visibleControls = Array.from(container.querySelectorAll('input, select, textarea'))
                .filter(control => control.type !== 'hidden');
            const isGroupedChoiceInput = input instanceof HTMLInputElement && ['radio', 'checkbox'].includes((input.type || '').toLowerCase());
            const shouldUseContainerHeading = isGroupedChoiceInput || visibleControls.length <= 1;
            const heading = shouldUseContainerHeading
                ? container.querySelector('h1, h2, h3, h4, h5, h6, label, .label, [class*="question"]')
                : null;

            if (heading && heading !== input.closest('label')) {
                return heading.textContent.trim();
            }
        }

        return this.getLabelText(input);
    },

    /**
     * Find radio buttons for yes/no questions
     * @param {string} fieldType 
     * @returns {Object} { yesRadio, noRadio }
     */
    findYesNoRadios(fieldType, options = {}) {
        const queryRoot = options.root && typeof options.root.querySelectorAll === 'function'
            ? options.root
            : document;
        const allRadios = queryRoot.querySelectorAll('input[type="radio"]');
        const groups = new Map();

        for (const radio of allRadios) {
            const groupKey = radio.name || this.normalizeText(this.getQuestionText(radio)) || `radio-${groups.size}`;
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(radio);
        }

        for (const radios of groups.values()) {
            const questionText = radios
                .map(radio => this.getQuestionText(radio))
                .find(Boolean) || '';

            if (this.classifyBinaryQuestionType(questionText) !== fieldType) {
                continue;
            }

            let yesRadio = null;
            let noRadio = null;

            for (const radio of radios) {
                const choiceText = this.normalizeText(this.getChoiceLabelText(radio));
                const radioValue = this.normalizeText(radio.value || '');

                if (choiceText === 'yes' || radioValue === 'yes' || radioValue === 'true') {
                    yesRadio = radio;
                } else if (choiceText === 'no' || radioValue === 'no' || radioValue === 'false') {
                    noRadio = radio;
                }
            }

            if (yesRadio && noRadio) {
                return { yesRadio, noRadio };
            }
        }

        return null;
    },

    getChoiceLabelText(input) {
        const labelledByText = this.getAriaLabelledByText(input);
        if (labelledByText) {
            return labelledByText;
        }

        const labelText = this.getLabelText(input);
        if (labelText) {
            return labelText;
        }

        const siblingText = Array.from(input.parentElement?.childNodes || [])
            .filter(node => node !== input)
            .map(node => node.textContent || '')
            .join(' ')
            .trim();

        return siblingText || input.value || '';
    },

    /**
     * Find select option that matches a value
     * @param {HTMLSelectElement} select 
     * @param {string} userValue 
     * @param {Object} optionPatterns 
     * @returns {HTMLOptionElement|null}
     */
    findMatchingOption(select, userValue, optionPatterns) {
        const options = Array.from(select.options);
        const patterns = optionPatterns[userValue] || [];

        for (const option of options) {
            const optionText = option.textContent.toLowerCase().trim();
            const optionValue = option.value.toLowerCase().trim();

            // Direct match
            if (optionValue === userValue || optionText === userValue) {
                return option;
            }

            // Pattern match
            for (const pattern of patterns) {
                if (optionText.includes(pattern) || optionValue.includes(pattern)) {
                    return option;
                }
            }
        }

        return null;
    }
};

// Export for use in content script
if (typeof window !== 'undefined') {
    window.FieldDetector = FieldDetector;
}
